# Spec: Press archive + broader outlet coverage

**Status:** Completed (merged via PR #24)
**Branch:** `feature/archive-and-outlet-coverage`
**Date:** 2026-07-07

## Problem

Two related complaints from Magnus:

1. **Coverage gaps.** The Perplexity retrieval reliably surfaces the big mainstream
   mastheads (BBC, Guardian, Times) but structurally misses the partisan/broadcast
   end of the spectrum — GB News being the clearest example. The "representative
   sample" is therefore skewed toward the sober middle and under-reflects the froth.
2. **The front page goes stale.** Across 6-hour cron cycles the same three cards
   keep appearing. Root cause: the site has **no memory**. Each cron overwrites a
   single cache slot (`commentary:v1`) with no record of what was shown before, so
   Perplexity's repeated top stories → the same curated panel → no visible change.

Both are the same underlying gap: nothing is remembered between cycles. Fixing that
unlocks (a) rotation on the front page and (b) the requested archive.

## Decisions (confirmed with Magnus)

- **Editorial stance: broaden the net, keep the principle.** We name the outlet
  spectrum the sample *should span* (including GB News and broadcast/partisan
  outlets) so froth appears when it is genuinely part of the picture. We do **not**
  reverse the "Reflect, don't hunt" integrity principle — no cherry-picking the
  silliest takes. This is a prompt tweak; no ADR, no ARCHITECTURE.md philosophy edit.
- **Sources: press only.** Broaden *which news/broadcast outlets* we span; do **not**
  pull social/commentary (Bluesky, X, blogs). Keeps the panel true to "the papers
  say" and adds no new article-fetch/SSRF surface.
- **Archive = shown articles.** The archive lists articles that appeared on the front
  panel (each carries a verdict + caption), newest-first. Not the raw Perplexity
  pool (those are un-judged and caption-less).
- **Storage: KV append-only list.** No D1. A few articles per cycle for a niche
  topic stays comfortably within KV limits for years.

## Design

### 1. Perplexity prompt (`retrievePool`)

Replace the vague "across different outlets" instruction with an explicit, *named*
outlet spectrum so the model reaches beyond the high-authority mastheads it defaults
to. The named outlets are "e.g." nudges pointing at regions of the spectrum — **not**
a checklist/quota to fill.

**Slant balance (review fix).** The named examples must be balanced left/centre/right
so the list itself doesn't smuggle in the very slant the "don't pre-select for slant"
clause forbids. The independent/commentary bucket in particular pairs left outlets
(Novara Media, Zeteo UK, The Nerve, New Statesman) with right/heterodox counterweights
(Spectator, The Critic, UnHerd, Guido Fawkes) and the nonpartisan Private Eye. Final
wording:

> Aim for a spread across the political and editorial spectrum, not just the sober
> centre, and balanced across left, centre and right. Deliberately span: national
> broadsheets and mid-market/tabloid papers (e.g. Guardian, Mirror, i, Times, Sunday
> Times, Telegraph, Mail, Express); broadcast and opinion-broadcast outlets including
> partisan ones (e.g. BBC, Sky, GB News, TalkTV, LBC); comment, satirical and
> independent outlets from across the spectrum (e.g. Spectator, The Critic, UnHerd,
> Guido Fawkes, New Statesman, Novara Media, Zeteo UK, The Nerve, Private Eye); and
> regional coverage close to Burnham (e.g. Manchester Evening News). The louder,
> outrage-driven end of the press is part of the real picture and should not be left
> out when genuinely present — but include an outlet only where it has genuinely
> published on the topic. Never invent an article, headline or outlet, and never
> attribute a piece to an outlet that has not run one. Do not pre-select for slant,
> quality, or how mockable a piece is — report what is actually being published,
> right across the spectrum.

The "include only where genuinely published / never invent / never attribute" clause
is the critical guardrail: naming outlets risks inducing hallucinated articles, and
this holds the line. "should not be left out **when genuinely present**" softens the
earlier "must not be left out" so it reads as a reflection instruction, not a quota.
The anti-cherry-picking clause is retained, so "Reflect, don't hunt" is unchanged — we
widen *where we look*, not *what we favour*.

**Hallucination residual risk (monitored, not unit-testable):** prompt efficacy depends
on live Perplexity behaviour and cannot be asserted in Vitest. `refineWithFullText`
keeps the snippet-based card when a full-text fetch fails (`worker.js:331`), so a
fabricated URL could still surface. Acceptable for this site; watched, not tested.

### 2. Memory + rotation

New KV key `archive:v1` in the existing `COMMENTARY_CACHE` namespace — a JSON array
of archived article objects, **newest-first** (index 0 = most recent):

```
{ title, url, outlet, date, verdict, caption, shown_at }   // shown_at = ISO 8601 UTC string
```

Dedup key: **normalised URL** — `normalizeUrl(u)`: lowercase host, strip query + hash,
strip a trailing slash from the path. Must return `null` (never throw) for junk /
absent input.

#### 2a. Structure: keep `runPipeline` KV-free; the cron path owns the archive

`runPipeline` currently touches no KV — KV lives only in the handlers. We keep it that
way (review finding: a KV read-modify-write inside `runPipeline` would open a
concurrent-writer race *and* break the KV-less `handleRefresh` test). Therefore:

- `runPipeline(env, { seen })` accepts a **`seen` Set of normalised URLs** (the caller
  reads the archive and passes it in) and returns `{ ...meta, articles }` as today.
  When `seen` is absent/empty it behaves exactly as now.
- **Only the cron `scheduled()` path** reads `archive:v1`, passes `seen` in, and — after
  a successful run — appends the shown articles back. Single writer ⇒ no race.
- `handleCommentary` (on-demand, cache-miss fallback) and `handleRefresh` call
  `runPipeline` **without** `seen` (or with an empty set) and do **not** write the
  archive. They still serve fresh commentary from `commentary:v1`; they just don't
  accumulate history. This keeps the front page correct on a cold miss and keeps the
  archive single-writer.

#### 2b. Selection bias (inside `runPipeline`, after `retrievePool`, before judging)

```
const seenSet   = seen ?? new Set()
const unseen    = pool.filter(a => a.url && !seenSet.has(normalizeUrl(a.url)))
const seenItems = pool.filter(a => !(a.url) || !unseen.includes(a))
const judgePool =
  unseen.length >= PANEL_SIZE
    ? unseen                                          // ≥3 fresh URL-bearing → judge fresh only
    : [...unseen, ...seenItems].slice(0, POOL_TARGET) // thin week → top up for context, never empty
```

**CRITICAL — index-base pairing (blocking review finding).** `judgeAndCurate` tags
candidates and validates by index *relative to the array it is given*. So the judge
call **and** the post-judge resolve must both use `judgePool`, as a matched pair:

```
const selected = await judgeAndCurate(env, judgePool)   // was: found.pool
...
const a = judgePool[s.i]                                 // was: found.pool[s.i]
```

Changing one without the other silently dereferences the wrong article. Extract the
selection logic as a pure, exported `computeJudgePool(pool, seenSet, PANEL_SIZE,
POOL_TARGET)` so it is unit-testable in isolation and the pairing is obvious.

- **≥3 fresh URL-bearing articles:** judge only the fresh ones → the panel rotates.
- **Thin week (<3 fresh):** top up with already-seen items so the judge still sees a
  representative pool and the panel is never empty. Some cards may repeat — an honest
  reflection that little new was published. Trade-off accepted.
- **URL-less articles** are treated as *seen* (never counted as fresh, never a dedup
  key), so they can't drive rotation or corrupt the archive.
- Rotation is guaranteed **only when ≥3 fresh URL-bearing articles exist** — not an
  absolute guarantee. (Wording softened from the earlier draft.)
- Front-page caching unchanged (same `commentary:v1`, same TTL). Never blank: with no
  fresh articles we still show the best of the full pool (today's behaviour).

#### 2c. Appending to the archive (cron path only)

After `scheduled()` gets a non-empty result, append the **post-refine** articles (the
final `refinedArticles` actually shown — not the pre-refine set) via a pure, exported
`appendToArchive(existing, shown, MAX_ARCHIVE)`:

- **Prepend** newest → `[...newShown, ...existing]` so index 0 is most recent.
- **Dedup by normalised URL, keep-existing** — if a URL is already archived, do not
  re-add or mutate its stored title/verdict/caption (the archive is a record of what
  was shown *when first shown*). Drop URL-less shown articles (no dedup key).
- **`shown_at`** = `new Date().toISOString()` (Date is available in the Workers
  runtime; UTC is fine) stamped only on genuinely new entries.
- **Trim to `MAX_ARCHIVE = 1000`**: since newest is at the front, keep `slice(0, MAX)`.
  Note: trimming drops the oldest URLs out of `seen` too, so a very old article could
  theoretically resurface — acceptable at 1000 entries.
- Guard: if `env.COMMENTARY_CACHE` is absent (local dev), skip silently. A `null`
  archive read is treated as `[]`.

**Concurrency note (corrected from the earlier draft):** dedup makes appends
*idempotent*, not *merge-safe* — it does not heal a lost read-modify-write. The
single-writer (cron-only) design in 2a is what actually removes the race; the earlier
"self-healing" justification was wrong.

**Observability:** `scheduled()` logs the fresh-article count each cycle
(`console.log`) so we can confirm in production how often ≥3-fresh rotation actually
fires — validating the core assumption against real Perplexity output rather than
guessing.

### 3. Archive API (`/api/archive`)

New route in `fetch`; JSON response. `GET /api/archive?page=N`:

```
{ page, pageSize: 20, total, totalPages, items: [ …article… ] }
```

- Newest-first, 20 per page. `page` in the response is the **clamped effective page**
  (so `archive.js` builds correct Prev/Next links).
- Clamping via a pure, exported `paginate(items, page, pageSize)`: non-numeric / 0 /
  negative → page 1; beyond last → last page; empty archive → `{ items: [], total: 0,
  totalPages: 0, page: 1 }`.
- `null` archive read (first deploy / KV-less dev) is treated as `[]`.
- **Consistent with `/api/commentary`:** JSON endpoints get **no** security headers
  (those attach only on the static-asset branch, `worker.js:151-152`) and **no**
  `Cache-Control`. Stated so it isn't "fixed" inconsistently later. On error, degrade
  to a 200 empty archive (mirrors `handleCommentary`, `worker.js:452`).
- Add named export `handleArchive` (+ `normalizeUrl`, `computeJudgePool`,
  `appendToArchive`, `paginate`) for the tests.

### 4. Front page (`public/index.html`)

Add an **"Archive"** link, right-aligned on the "Meanwhile, the papers say…" heading
row (`margin-left:auto` inside the existing flex `<h2>`). Links to `/archive.html`.
Leaves the existing `archive-badge` ("From the archive" fallback text) intact.

### 5. Archive page (`public/archive.html` + `public/archive.js`)

- Newspaper-styled header consistent with the masthead ("The Archive" / subtitle) and
  a link back to the front page.
- Two-column list, 10 entries per column (grid; collapses to one column on mobile).
- **Reuses `createArticleCard` from `app.js`** — inherits the tested XSS-escaping
  guard (confirmed: same-origin ESM import is allowed by `script-src 'self'`, and the
  app.js bootstrap is guarded so importing it runs no side effects). Disable the
  fixating jitter animation for the list (CSS override) so 20 cards don't wobble.
- **Show `shown_at`** on each archive card (as a readable date, e.g. "Filed 3 Jul
  2026") — the year-less `date` field is ambiguous across a months-long archive, so
  the archive card surfaces the unambiguous `shown_at`. (Small render tweak on the
  archive page; front-page cards unchanged.)
- **Empty state:** when `items` is `[]` (first deploy, before any cron has run), show
  a friendly "Nothing filed yet — check back after the next edition" message, not a
  blank grid.
- **Error state:** if `/api/archive` fails/times out, show a short "The archive is
  briefly unavailable" note rather than a broken page.
- Simple Prev / page-N-of-M / Next pagination via `?page=` links, using the clamped
  `page` from the response.

## Testing (TDD, 95%+)

Tests target the extracted **pure helpers** (trivial to test in isolation; the reason
for extracting them). `vitest.config.js` scopes coverage to `src/**/*.js` with no
enforced CI threshold — 95% is a policy aim; write the tests regardless.

New/extended Worker tests:
- `normalizeUrl` — host case, query/hash/trailing-slash stripping, junk/absent input
  returns `null` without throwing.
- `computeJudgePool(pool, seenSet, PANEL_SIZE, POOL_TARGET)` — fresh-only when ≥3
  unseen URL-bearing; tops up when thin; URL-less treated as seen; never empty when
  pool non-empty. Guards the index-base pairing indirectly (indices are into the
  returned array).
- `appendToArchive(existing, shown, MAX_ARCHIVE)` — prepends newest-first, dedups by
  normalised URL keeping the existing entry, drops URL-less shown items, caps at
  `MAX_ARCHIVE` keeping the newest, treats `null` existing as `[]`.
- `handleArchive` / `paginate` — page 0 / negative / non-numeric / beyond-last /
  empty archive / normal slice / `totalPages` maths / clamped `page` echoed back.
- Existing `handleRefresh`/`handleCommentary` tests must still pass unchanged
  (confirms `runPipeline` stayed KV-free on those paths).

Front-end: `createArticleCard` XSS guard already covers archive card rendering. Add a
small test for archive pagination-link building and the empty/error render only if the
logic warrants.

**Note on "shown articles":** the archive records **`runPipeline` output only** (the
curated, refined panel). The client-side canned trio and judge-fail cards render on
the panel but never reach the archive, since they never pass through the cron path.

## Out of scope

- Social/commentary sources.
- Reversing the "Reflect, don't hunt" principle / actively hunting froth.
- D1 or any new storage backend.
- Search/filter on the archive (YAGNI; paginated list only).
