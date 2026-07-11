# Archive type filter

**Status:** Reviewed (`/review-spec` — APPROVED WITH CONDITIONS; conditions folded in below)
**Date:** 2026-07-11
**Branch:** `feature/archive-filter`
**Dependencies:** None — extends the existing archive endpoint and page.

## Problem

Magnus asked, in the same breath as the caption-voice work, for a way to look at
the archive one verdict type at a time: *"On the Archive page I'd like a filter to
show all archived articles (default), or only articles of one of the three types:
Probing, Noted, Fixating."* Today the archive is an undifferentiated newest-first
list — there's no way to read just the froth ("Fixating") or just the substance
("Probing"), and no at-a-glance sense of the balance between them, which is the
whole editorial point of the site. This adds both: a per-type filter and a visible
count of the mix.

**Brief description:**
A per-verdict filter for the archive — **All** (default), **Probing**, **Noted**,
**Fixating** — rendered as chips that each also show their count, so the same
control both filters the list and shows the mix (e.g. `All 55 · Probing 12 ·
Noted 9 · Fixating 34`). Filtering is a server-side query param mirroring the
existing pagination pattern, so counts, paging and empty-states all stay correct.

---

## Scope and deliverables

### In scope
- [ ] `/api/archive` accepts an optional `verdict` query param (`probing` | `fixating` | `noting`); filters the full archive **before** paginating.
- [ ] Server lower-cases and validates `verdict` against an allowlist; anything else is treated as "no filter" (All).
- [ ] Response echoes the effective (normalised) `verdict` (or `null` for All), and a `counts` object with per-verdict totals over the **whole** archive.
- [ ] Consolidate the verdict allowlist into a single shared `VALID_VERDICTS` constant, replacing the two existing inline `VERDICTS` sets (`worker.js:459`, `:647`).
- [ ] Archive page gains a filter control: chips for **All · Probing · Noted · Fixating**, each showing its count, reusing the existing per-verdict colours.
- [ ] Filter chips are anchors driving a server round-trip (`/archive?verdict=fixating`), like pagination links today — no reactive client state.
- [ ] Pagination links preserve the active `verdict` param.
- [ ] The "N clippings filed" count reflects the **filtered** total; the chip counts always reflect the whole archive.
- [ ] A filtered empty-state ("Nothing filed under Fixating yet.").
- [ ] Active filter chip is visually marked and exposes `aria-current`; the **All** chip is active when no filter is set.
- [ ] Both `<nav>` landmarks (filter + pagination) get distinguishing `aria-label`s.
- [ ] Tests for the worker filter/counts logic and the front-end param/render handling; coverage stays above threshold (CI-enforced).

### Out of scope
- Multi-select / combined filters (one verdict at a time).
- Free-text search, outlet or date-range filtering.
- Persisting the last-used filter (each visit starts at All).
- Any change to how verdicts are assigned or captions written.

### Acceptance criteria
- [ ] `GET /api/archive?verdict=fixating` returns only fixating items, newest-first, with `total`/`totalPages` reflecting the filtered set.
- [ ] `GET /api/archive?verdict=Fixating` (any case) behaves identically — normalised server-side.
- [ ] `GET /api/archive?verdict=bogus` (or missing) returns the full archive (All), with `verdict` echoed as `null`.
- [ ] Every response includes `counts` = `{probing, fixating, noting}` over the whole archive, unaffected by the active filter.
- [ ] `GET /api/archive?verdict=fixating&page=2` pages **within** the filtered set.
- [ ] On the page, choosing a type shows only that type; choosing All restores the full list; each chip shows its whole-archive count.
- [ ] Paging while filtered keeps the filter; the count and "Page X of Y" match the filtered set.
- [ ] Filtering to a type with no entries shows the filtered empty-state, not the generic one.
- [ ] The active chip (including **All** for the default view) carries the active class + `aria-current`.
- [ ] All tests pass; coverage ≥ 95% lines/functions/statements, 90% branches.

---

## Technical approach

### Architecture decisions

**Decision 1: Server-side filter, not client-side.**
- Choice: filter in `handleArchive` before `paginate`, driven by a `verdict` query param.
- Rationale: pagination is server-driven (page size 20). A client-side filter would only filter the current 20-item page, so a page could show zero of a type while later pages hold matches — broken counts and paging. Filtering server-side keeps `total`, `totalPages` and the empty-state honest.
- Alternatives considered: (a) client filters current page — rejected, wrong UX; (b) client fetches the entire archive and filters locally — rejected, ships up to `MAX_ARCHIVE` (1000) records and duplicates server logic.

**Decision 2: URL param + server round-trip, not reactive client state.**
- Choice: filter chips are ordinary anchors (`/archive?verdict=fixating`), the same mechanism pagination already uses.
- Rationale: KISS and consistency. Reuses the existing per-page reload, keeps deep links shareable, no client-side view state.

**Decision 3: Validate the param against an allowlist (untrusted input).**
- Choice: one shared `VALID_VERDICTS` constant; incoming param is lower-cased then checked; unknown/absent → All (no filter), echoed as `verdict: null`.
- Rationale: the query param is untrusted. It is only ever compared for equality against stored `verdict` values, never interpolated, so blast radius is nil — allowlisting keeps it that way and makes the "All" fallback deterministic.

**Decision 4: The server-echoed `verdict` is the single source of truth for rendering.** *(resolves review blocking-gap 2)*
- Choice: the client uses `data.verdict` (echoed by the server) to drive the active-chip highlight and the empty-state label. `requestedVerdict()` is used **only** to build the outbound fetch URL.
- Rationale: this is exactly the precedent `page` already follows — pagination links are built from the server's echoed clamped `page`, not the raw URL (`archive.js:9,:77`). Without it, a normalised `?verdict=Fixating` (Decision 3) would filter correctly server-side but leave the client's exact-match `requestedVerdict()` returning `null` → nothing highlighted, wrong empty-state. Single render source dissolves the coupling.

**Decision 5: A dedicated short-label map, not `getVerdictLabel`.** *(resolves review blocking-gap 1)*
- Choice: a small `FILTER_LABELS` map (`probing`→"Probing", `noting`→"Noted", `fixating`→"Fixating") drives **both** the chip text and the empty-state.
- Rationale: `getVerdictLabel('fixating')` returns `"Fixating on:"`, so reusing it for the empty-state yields the broken "Nothing filed under Fixating on: yet." and a chip/empty-state mismatch. The filter needs its own concise labels.

**Decision 6: Counts computed over the whole archive, always.**
- Choice: `handleArchive` tallies per-verdict counts across the full archive (before filtering) and returns them in every response; the active filter never changes the counts.
- Rationale: the chips show the *mix of the archive*, which is filter-independent. Computing once server-side keeps the client dumb and the numbers consistent across filtered views.

### Key files and components

**Files to modify:**
```
- src/worker.js       — handleArchive: compute `verdict` (outside the try, so the
                        catch can echo verdict:null) + `counts` over the full
                        archive; filter before paginate; echo both. Extract the
                        shared VALID_VERDICTS constant and replace the two inline
                        VERDICTS sets (worker.js:459, :647).
- public/archive.html — add the filter nav (static anchors) + styling; aria-label
                        both navs.
- public/archive.js   — requestedVerdict() (validate, for fetch URL only); thread
                        verdict through fetchArchive; render chips + counts from
                        data.counts; mark active chip from data.verdict (null→All);
                        preserve verdict in pagination hrefs via data.verdict;
                        FILTER_LABELS-driven filtered empty-state.
- test/worker.test.js — handleArchive filtering + counts cases.
- test/archive.test.js— front-end verdict/counts/render cases.
```

No new files, no KV schema change — `verdict` is already stored on every archived
record (`appendToArchive`, `worker.js:738`; stored values are lower-case). No new
dependencies.

### Server sketch (`handleArchive`)

```
// module scope — single source of truth, replaces the inline sets at :459 and :647
const VALID_VERDICTS = new Set(["probing", "fixating", "noting"]);

async function handleArchive(env, req) {
  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page");
  const raw = (url.searchParams.get("verdict") || "").toLowerCase();
  const verdict = VALID_VERDICTS.has(raw) ? raw : null;   // null = All
  try {
    const kv = env.COMMENTARY_CACHE;
    const archive = (kv ? await kv.get(ARCHIVE_KEY, "json") : null) ?? [];
    const counts = { probing: 0, fixating: 0, noting: 0 };
    for (const a of archive) if (counts[a?.verdict] !== undefined) counts[a.verdict]++;
    const filtered = verdict ? archive.filter(a => a?.verdict === verdict) : archive;
    return Response.json({ ...paginate(filtered, pageParam), verdict, counts });
  } catch (e) {
    console.error("Archive error:", e);
    return Response.json({ page: 1, pageSize: ARCHIVE_PAGE_SIZE, total: 0,
      totalPages: 0, items: [], verdict, counts: { probing: 0, fixating: 0, noting: 0 } });
  }
}
```

- `paginate` is unchanged — it operates on whatever list it's handed, so filtered
  `total`/`totalPages`/`items` come out correct for free.
- `verdict` is computed **outside** the `try` so the catch path can echo it.
- Records lacking a `verdict` (none in current data) are excluded from every
  filtered view and from `counts` — intentional; asserted by a test.

### Front-end behaviour (`archive.js`)

- `requestedVerdict()` — read `verdict` from the query string, return it only if in
  the allowlist (lower-cased), else `null`. **Used only to build the fetch URL.**
- `fetchArchive(page, verdict)` — append `&verdict=…` **only when set** (this
  conditional is load-bearing: an unconditional `&verdict=` dirties All's URLs and
  breaks the existing `href === '/archive?page=1'` pagination tests).
- Chips + counts — render the four chips from `FILTER_LABELS` + `data.counts`
  (All shows `data.total` for the unfiltered whole = sum of counts).
- Active chip — driven by `data.verdict`; `null` → the **All** chip. Adds
  `is-active` + `aria-current="page"`.
- `renderPagination` — read `data.verdict` (no new argument) and build hrefs as
  `/archive?verdict=<v>&page=<n>`, adding the verdict param only when set.
- Empty-state — filtered-empty shows `Nothing filed under <FILTER_LABELS[v]> yet.`;
  the generic "Nothing filed yet" stays for the All view.

### Front-end markup (`archive.html`)

A `<nav id="archive-filter" aria-label="Filter by verdict">` above `#archive-status`,
containing four anchors (All, Probing, Noted, Fixating). Anchors are **static HTML
with fixed hrefs** (no server-side templating in this project); the count text and
active-highlight are applied purely client-side by `archive.js`. The existing
`<nav id="archive-pagination">` gains `aria-label="Archive pages"`. Styling reuses
the verdict colour variables already in the file (`--green`, `--amber-dark`,
`--muted`) plus a `page-link`-style affordance; the row wraps on ≤700px.

---

## Testing strategy

### Worker (`test/worker.test.js`)
- [ ] `verdict=fixating` returns only fixating items, newest-first.
- [ ] Each of the three types filters correctly.
- [ ] `verdict=Fixating` (mixed case) normalises and filters as `fixating`.
- [ ] Missing / invalid `verdict` → full archive, `verdict: null`.
- [ ] `counts` reflects whole-archive per-verdict totals and is identical across filtered and unfiltered requests.
- [ ] `verdict=fixating&page=2` pages within the filtered set (`total`/`totalPages` reflect the filtered count).
- [ ] Filtering to a type with no entries → `total: 0`, `items: []`, but `counts` still populated.
- [ ] A record with no/unknown `verdict` is excluded from every filtered view and from `counts` (intentional).
- [ ] Error path returns the 200 empty shape with `verdict` echoed and zeroed `counts`.
- [ ] The consolidated `VALID_VERDICTS` still satisfies the two call sites that used the inline `VERDICTS` sets (behaviour unchanged at `:459`/`:647`).

### Front-end (`test/archive.test.js`)
- [ ] `requestedVerdict()` returns a valid verdict, and `null` for invalid/absent.
- [ ] `fetchArchive` includes the verdict param only when set.
- [ ] Chips render with counts from `data.counts`.
- [ ] Active chip is driven by `data.verdict`; `null` activates **All**.
- [ ] Pagination links preserve the verdict param (and All links stay `/archive?page=N`).
- [ ] Filtered empty list renders the type-specific empty-state; All renders the generic one.

### Manual checklist
- [ ] All / Probing / Noted / Fixating each show the right subset and correct chip counts.
- [ ] Paging within a filter keeps the filter and shows correct counts.
- [ ] A deep link (`/archive?verdict=noting&page=1`) loads filtered directly with All-relative counts.
- [ ] Keyboard navigation reaches and activates each chip; active state is announced; both navs announce distinct labels.
- [ ] Mobile layout (≤700px) — the chip row wraps acceptably.

---

## Edge cases and considerations

### Known risks
- **Empty filtered result vs. genuinely empty archive:** distinct copy for each so the page never looks broken. Covered by tests. (Per-type empty views will be common early while the archive is small and froth-leaning — a routine path, not an edge case.)
- **Stale `page` after switching filter:** filter chips carry no `page`, so switching resets to page 1; `paginate` also clamps an over-range hand-edited `?verdict=noting&page=99` down to the last filtered page.
- **Filtered totals don't sum to All** if any record lacks a verdict — intentional and asserted; a non-issue in current data.

### Security considerations
- `verdict` is untrusted input, lower-cased, allowlisted, and only used for equality comparison against stored values — never interpolated into KV keys, HTML, or logs. No injection surface.
- Chip labels are static developer-authored strings; article fields still render via the tested `textContent` path in `createArticleCard`. Counts are numbers rendered via `textContent`. No new XSS surface.

### Accessibility considerations
- Chips are real anchors — keyboard-navigable by default; active chip carries `aria-current="page"`.
- Both `<nav>` landmarks have distinguishing `aria-label`s.
- Colour is not the only signal — the active chip also has a non-colour affordance (border/weight), surviving colour-blindness and the existing reduced-motion rules.

### Backward compatibility
- No `verdict` param → identical list behaviour to today. The new `verdict` and `counts` response fields are additive; the current client ignores unknown fields.

---

## Documentation
- Update `ARCHITECTURE.md` archive section to mention the type filter and the counts breakdown.
- Note the `/api/archive` `verdict` param and the `verdict`/`counts` response fields wherever the endpoint is described.

---

## Resolved open questions (from review)
1. **Normalise incoming `verdict` case?** → **Yes**, lower-case server-side (pairs with Decision 4, server-echo as render truth).
2. **Name the type in the "N clippings filed" count?** → **No** — the count stays plain; the active chip (and its count) carries the type. The chips subsume the "name the mix" need.
3. **`aria-current` token?** → **`page`** (more idiomatic for a nav) rather than `true`.
