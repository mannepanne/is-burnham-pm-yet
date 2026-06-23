# Is Andy Burnham the UK Prime Minister yet?

A one-page satirical site that answers a single binary question, then sets that
answer against the froth of the UK political press. The whole point is the
contrast: one calm, authoritative **Yes / Not yet**, dwarfing a panel of
breathless commentary that is busy fixating on details instead of the picture.

This document is a starting specification for an agentic build (Mistral Vibe
CLI). It defines the end state, the architecture, the data contracts, and the
design direction. Treat the acceptance criteria as the contract; everything
else is guidance.

> Project context (June 2026): Keir Starmer has announced his resignation and
> remains in office pending a Labour leadership contest. Andy Burnham, now an
> MP again after a by-election, is the frontrunner but has **not** got the job.
> So at launch the honest answer is "Not yet" — which is exactly the joke.

Suggested repo name: `is-burnham-pm-yet`

---

## 1. The end state (work backwards from here)

When someone loads the page, they see:

1. **The hero answer.** A single huge word/phrase that dominates the viewport:
   - `Yes.` if the current UK head of government is Andy Burnham.
   - `Not yet.` otherwise — with the subtitle quip **"(but ask again in a month)"**.
   This answer is the source of truth and must render even if everything else
   on the page fails.

2. **A probability readout.** A large percentage with a one-line caption — the
   estimated chance Burnham is PM within the next three months. Clearly framed
   as a vibe, not a forecast.

3. **"Meanwhile, the papers are…"** — a panel of one to three recent articles
   (always at least one), curated from a wider pool to fairly mirror how the press
   is actually covering the question. Each card shows the outlet, the date, the
   headline, and a tagline reflecting how the piece treats the subject:
   - **"Fixating on:"** (scathing, tongue-in-cheek) for froth — clothes, food,
     security-detail optics, helicopter-without-an-election process theatre.
   - **"Probing:"** (serious) for substance — what Burnham intends to do, the
     mechanics or legitimacy of the transition, a genuinely new angle.
   - **"Noted:"** (neutral) for the merely unremarkable — a straight update,
     listed with a plain neutral few words, no jab and no false praise.
   The panel reflects reality rather than hunting for the worst: it leans toward
   scorn because the press often does, but a genuine `Probing:` appears whenever
   the coverage earns it, and a dull week is just `Noted:` — that honesty is what
   makes the scorn land. If nothing stands out, one article is still listed,
   plainly.

4. **A running count** in the footer — "Prime Ministers since the 2016
   referendum: N" — as a dry punchline. `N` is a hardcoded constant (6 today) and
   ticks to 7 the moment the hero flips to `Yes.` (Burnham being the new one). Not
   a live data feed; just a constant plus one on the success state.

The realised concept (per the design handoff) is a satirical newspaper front
page — *The Daily Non-Forecast* — with a masthead, dateline, mock weather, the
probability as "The Odds Desk," and the commentary under "Meanwhile, the papers
are…". The visual hierarchy *is* the thesis: the binary truth is enormous and
certain; the commentary is small, busy, and slightly absurd beneath it. The
handoff is the source of truth for layout, type, and colour; this spec governs
behaviour and data.

---

## 2. Architecture at a glance

**One Cloudflare Worker with a static-assets binding.** No Pages, no Sites, no
separate frontend dev server. The same Worker serves the page and the API, runs
under a single `wrangler dev` (one origin, one port), and ships with one
`wrangler deploy`.

How it routes — Cloudflare's default behaviour when a Worker has both an `assets`
directory and a script:

- A request that **matches a file** in the assets directory is served directly
  from that file (the Worker script isn't even invoked). So `GET /` serves
  `public/index.html`.
- A request that **matches no asset** is handed to the Worker script. So
  `GET /api/commentary` runs the Worker and returns the Perplexity-backed JSON.

This is the key point for local dev: `wrangler dev` serves both the static page
and the `/api/*` route from a single server (e.g. `localhost:8787`). There is no
second process to start — `fetch('/api/commentary')` from the page is a
same-origin call to the same dev server. This is the "one server, everything
runs" outcome.

The page's client JS then drives two data calls:

| Path | Source | Who calls it | Why |
|---|---|---|---|
| **The answer** | Wikidata SPARQL | Browser, directly | Anonymous, CORS-friendly, no secret. The page resolves the answer itself. |
| **The noise** | Perplexity Sonar API | The same Worker, at `/api/commentary` | Needs an API key. The key lives in the Worker as a secret and never reaches the browser. |

Because the page and `/api/commentary` are the **same origin** (same Worker), the
commentary endpoint needs **no CORS headers**. The browser's only cross-origin
request is to Wikidata, which already allows calls from anywhere.

Key principle: **graceful degradation.** The Wikidata answer is the core and
must work standalone. The Perplexity panel is enhancement — if `/api/commentary`
errors or times out, the page still shows the hero answer, the probability falls
back to a `—%` placeholder, and the panel fills with the built-in "From the
archive" canned trio (see §4) so it never looks broken. Never let the binary
answer depend on the commentary route.

```
                         one origin (wrangler dev / deployed Worker)
┌──────────────────────────────────────────────┐
│   Cloudflare Worker + assets binding           │
│                                                │
│   GET /              → served from public/     │──────────┐ the page
│   GET /api/commentary → Worker script → JSON   │          │
│        │  Bearer key (secret)                  │          ▼
│        ▼                                       │   ┌──────────────┐
│   api.perplexity.ai                            │   │   Browser    │
└──────────────────────────────────────────────┘   │  (the page)  │
                                                    └──────┬───────┘
                                                           │ SPARQL (CORS, no key)
                                                           ▼
                                                  ┌────────────────────┐
                                                  │  query.wikidata.org │
                                                  └────────────────────┘
```

Stack: a single Cloudflare Worker with an `assets` directory, run locally with
`wrangler dev` and shipped with `wrangler deploy`. No database, no email, no
auth. Secret via `wrangler secret`.

---

## 3. The answer (Wikidata)

Wikidata models "head of government" as property **P6** on the United Kingdom
entity **Q145**. The SPARQL endpoint allows cross-origin requests, so the
browser can resolve the current PM's name in one call.

```sparql
SELECT ?pmLabel WHERE {
  wd:Q145 wdt:P6 ?pm .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

Call it with:

```
https://query.wikidata.org/sparql?format=json&query=<url-encoded query above>
```

Parse `results.bindings[*].pmLabel.value`.

### Answer logic

- If **any** returned label contains the string `"Burnham"` (case-insensitive)
  → render `Yes.`
- Otherwise → render `Not yet.` with subtitle `(but ask again in a month)`.

Match on the substring `Burnham`, **not** a full name, so middle names, honorific
prefixes ("The Rt Hon"), or formatting changes in the label don't break it.

### Notes & edge cases

- During a transition the property may carry more than one value or lag the news
  by hours/days. Iterate all bindings; the "Yes" wins if any match. Lag is fine
  — arguably on-brand.
- If the query fails entirely, show `Not yet.` with a muted note that the
  scoreboard is being checked, rather than an error. The default answer is "No",
  which is almost always correct anyway.

---

## 4. The noise (Perplexity finds, Claude judges)

The `/api/commentary` route runs a **two-stage pipeline**, then returns clean
JSON to the frontend:

1. **Perplexity Sonar retrieves a pool.** It gathers a *representative* sample of
   roughly nine recent articles on the question — raw data only (`title`, `url`,
   `outlet`, `date`, `snippet`). It is purpose-built for fresh-news retrieval with
   citations; that's all it does here. No verdicts, no captions, and crucially no
   pre-selection for slant or quality — just a fair cross-section of what's being
   published.
2. **Claude judges and curates.** A single batched call to the Anthropic API
   receives the whole pool, judges each piece honestly, then selects one to three
   for the panel (always at least one) and captions them:
   - substance → `verdict: "probing"` + a serious, few-word caption;
   - froth → `verdict: "fixating"` + a scathing, tongue-in-cheek caption;
   - merely unremarkable → `verdict: "noting"` + a plain, neutral descriptor (or
     none). This is the honest home for forgettable coverage — and the fallback
     when nothing in the pool is good: list one piece plainly rather than mock it.

Why split the work: Sonar (Llama-derived, tuned for retrieval/QA) is the right
tool for *finding* current coverage; the editorial judgement, curation, and voice
— the charm of the feature — are what a frontier model does well. Keeping each
tool to its strength is the whole point.

**Why a pool, not three?** Sonar's retrieval is a *relevance-and-recency ranker*:
it formulates its own query from the prompt, ranks hits, and returns the top
ones. "Most relevant" is the only axis it optimises — it has no concept of an
editorial spread, and the citation count is emergent, not a hard knob. So if you
ask for three you get that week's three most-relevant pieces, which might be
three near-identical news wraps. Over-fetching a varied pool and letting Claude
curate fixes this — and curation is essentially free, because Claude already
reads every candidate to judge it. No extra API call.

Two sequential calls, not more: Perplexity returns the pool in one response,
Claude judges and curates it in one batched call. The hero answer has already
rendered from Wikidata by the time either runs, so this never blocks the thing
people came for.

### Stage 1 — Perplexity (retrieve a representative pool)

- Endpoint: `https://api.perplexity.ai/chat/completions`
- Model: `sonar-pro` (richer citation metadata — titles + dates — which the
  cards need). `sonar` is cheaper and fine while prototyping.
- Use `search_recency_filter: "week"` so the articles are actually recent.
- The prompt asks for a *varied, representative* pool (~9) spanning hard
  news/analysis, opinion, and lighter colour pieces, across different outlets —
  explicitly **not** pre-filtered for slant or mockability. Variety in the pool
  is what makes honest curation possible downstream.
- Auth: `Authorization: Bearer <PERPLEXITY_API_KEY>` — Worker secret, never
  shipped to the client.

### Stage 2 — Claude (judge, curate, caption)

- Endpoint: `https://api.anthropic.com/v1/messages`
- Model: a single constant, `JUDGE_MODEL`, so it's a one-line switch (see
  "Choosing the judge model" below).
- Auth: `x-api-key: <ANTHROPIC_API_KEY>` — a second Worker secret.
- Receives the whole pool and returns one to three *selected* articles (always
  at least one when the pool is non-empty), each with `{ i, verdict, caption }`.
  The Worker maps each `i` back to the pooled article for its
  `title`/`url`/`outlet`/`date`; the frontend derives the tag label and styling
  from `verdict`.

### Worker reference implementation

The Worker script only handles `/api/commentary`. The page is served from the
assets directory automatically, so the script needs no `/` route. No CORS
headers are needed because the page and the API share an origin.

```js
// The page is served automatically from the assets directory (see "How the
// page is served" below). The Worker script only handles the API route; any
// request that matches a static asset never reaches this code.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/commentary") {
      return handleCommentary(env);
    }

    // Non-asset, non-API path (rare): "/" and everything in public/ are
    // already handled by the assets layer before the Worker runs.
    return new Response("Not found", { status: 404 });
  },
};

// One-line switch for cost vs. wit. See "Choosing the judge model".
const JUDGE_MODEL = "claude-haiku-4-5";
const POOL_TARGET = 9;   // candidates Perplexity is asked for (soft; see note)
const PANEL_SIZE = 3;    // cards shown, at most
// Neutral caption used for "noting" cards on fallback paths, so a "Noted:" label
// is never left bare. The judge supplies its own neutral few words normally.
const NEUTRAL_CAPTION = "A recent update on the question.";

async function handleCommentary(env) {
  const empty = { probability_pct: null, one_line: "", articles: [] };

  try {
    // ---- Stage 1: Perplexity retrieves a representative pool (~9) --------
    const found = await retrievePool(env);   // { probability_pct, one_line, pool: [{title,url,outlet,date,snippet}] }
    const meta = { probability_pct: found.probability_pct ?? null, one_line: found.one_line ?? "" };
    if (!found.pool?.length) return Response.json({ ...empty, ...meta });

    // ---- Stage 2: Claude judges the pool and curates up to 3 ------------
    const selected = await judgeAndCurate(env, found.pool); // [{ i, verdict, caption }] in display order

    const articles = selected
      .map((s) => {
        const a = found.pool[s.i];
        return a && { title: a.title, url: a.url, outlet: a.outlet, date: a.date, verdict: s.verdict, caption: s.caption };
      })
      .filter(Boolean)
      .slice(0, PANEL_SIZE);

    return Response.json({ ...meta, articles });
  } catch (e) {
    return Response.json(empty); // status 200 — degrade quietly
  }
}

async function retrievePool(env) {
  const sys = `You answer ONLY with minified JSON, no prose, no markdown fences.
Schema: {"probability_pct": number, "one_line": string,
"pool": [{"title": string, "url": string, "outlet": string,
"date": string, "snippet": string}]}
Return up to ${POOL_TARGET} recent articles that TOGETHER form a fair,
representative sample of how the UK media is currently covering whether Andy
Burnham is or will become Prime Minister. Aim for a spread across hard news and
analysis, opinion/comment, and lighter colour or sketch pieces, and across
different outlets. Do NOT pre-select for any slant, quality, or how mockable a
piece is — just report what is actually being published. "snippet" is 1-2
sentences on what each article actually says, in neutral terms.
"probability_pct" (0-100) is your best estimate Burnham is PM within 3 months;
"one_line" is a dry one-sentence state of play.`;

  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      search_recency_filter: "week",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: "How is the UK press currently covering whether Andy Burnham is or will become Prime Minister? Give a representative range of recent articles and estimate the probability." },
      ],
    }),
  });

  const data = await r.json();
  let payload = data.choices?.[0]?.message?.content ?? "{}";
  payload = payload.replace(/```json|```/g, "").trim();
  try { return JSON.parse(payload); }
  catch { return { probability_pct: null, one_line: "", pool: [] }; }
}

async function judgeAndCurate(env, pool) {
  // Send only what judgement needs, tagged with the pool index `i`.
  const candidates = pool.map((a, i) => ({
    i, title: a.title, outlet: a.outlet, snippet: a.snippet ?? "",
  }));

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 600,
      system: JUDGE_PROMPT,                         // see below
      messages: [
        { role: "user", content: JSON.stringify({ candidates }) },
      ],
    }),
  });

  const data = await r.json();
  let text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .replace(/```json|```/g, "")
    .trim();

  const VERDICTS = new Set(["probing", "fixating", "noting"]);

  try {
    const parsed = JSON.parse(text);                // { selected: [{ i, verdict, caption }] }
    const selected = (parsed.selected ?? [])
      .filter((s) => Number.isInteger(s.i) && pool[s.i])           // valid index
      .map((s) => ({ i: s.i, verdict: VERDICTS.has(s.verdict) ? s.verdict : "noting", caption: s.caption ?? "" }))
      .slice(0, PANEL_SIZE);

    // Always show at least one when the pool has anything: list it neutrally.
    if (!selected.length && pool.length) return [{ i: 0, verdict: "noting", caption: NEUTRAL_CAPTION }];
    return selected;
  } catch {
    // Judge failed: list the first candidate plainly — never a manufactured jab.
    return pool.length ? [{ i: 0, verdict: "noting", caption: NEUTRAL_CAPTION }] : [];
  }
}
```

### The judge prompt (Claude)

This is the heart of the feature — judgement, curation, and voice all live here.
Use it as `JUDGE_PROMPT` (the `system` value in Stage 2). The load-bearing
design choices: judge *treatment* not topic; curate for a faithful *reflection*
of the pool rather than a caricature; keep the rough 2:1 froth-to-substance lean
as an *observation, not a quota*; never hunt for bad articles; and when a piece
is merely unremarkable, list it plainly rather than forcing a jab or false
praise. Always surface at least one article.

```text
You are the editor of a dry, sardonic site that tracks whether Andy Burnham has
become UK Prime Minister. You are honest about the British press: where coverage
is substantive you say so plainly; where it fixates on trivia you point that out
with a raised eyebrow; and where it is simply unremarkable you just note it,
without forcing a verdict either way. You will receive a JSON array of candidate
articles, each with an index `i`, a title, an outlet, and a short neutral snippet
— a representative sample of the week's coverage.

STEP 1 — Judge how each candidate TREATS the subject. One of three verdicts:
- "probing": engages with what actually matters — what Burnham intends to do in
  office, the mechanics or legitimacy of a mid-term transition, the political or
  policy stakes, or a genuinely new angle or argument.
- "fixating": dwells on froth — clothes, food, haircut, who he travels with,
  security-detail optics, "swept in by helicopter without an election" process
  theatre, personality colour, or recycled trivia dressed up as analysis.
- "noting": neither clearly substantive nor clearly trivial — a straight,
  unremarkable update. Use this honestly; it is the correct home for forgettable
  coverage, and you must NOT promote such a piece to "fixating" just to get a joke
  or to "probing" just to seem balanced.
Judge the treatment, not merely the topic: a thoughtful piece on whether it is
legitimate to take office mid-term is "probing"; a snide jab about the helicopter
is "fixating", even though both touch the same event.

STEP 2 — Select 1 to 3 candidates for the panel (ALWAYS at least one), optimising
for:
- a faithful reflection of the pool — the panel should mirror the real character
  of the coverage, not an exaggerated version of it;
- outlet diversity — avoid multiple pieces from the same publication;
- no near-duplicates — if several cover the same angle, keep the strongest one;
- the clearest example of each type you include.
If nothing in the pool is good or interesting, still pick the single most
representative piece and give it the "noting" verdict — list it, don't mock it.

PRINCIPLES — read carefully, they define the site's integrity:
- Reflect, don't hunt. You are NOT looking for the worst or silliest articles.
  Report what is being said; only when what is being said is trivial do you say
  so. Never inflate, exaggerate, or invent froth, and never twist a snippet to
  make a piece look more foolish than it is.
- Honest over rigid. The press often fixates more than it probes, so the panel
  will frequently lean that way — commonly around two "fixating" to one
  "probing". That is an observation about the coverage, NOT a target to hit. If a
  week is mostly substantive, show more "probing"; if it is dull, "noting" is
  fine; if it is all froth, show "fixating". Mirror the pool you were given.
- "probing" must genuinely appear when a piece earns it; reflexive cynicism is a
  failure. Equally, never award "probing" to a weak piece just to balance the
  panel.
- Judge only what each snippet supports. Invent nothing.

STEP 3 — For each SELECTED article, write a caption of at most 8 words:
- "probing": serious and precise — name the substantive thing it engages with.
- "fixating": tongue-in-cheek — name the trivial thing it obsesses over. Dry wit,
  not cruelty; the humour is in the accuracy.
- "noting": a plain, neutral few words describing what the piece is — no wit, no
  scorn, no praise. Always write a short factual descriptor (e.g. "Routine
  conference-season profile."); never leave it blank.

Respond with ONLY minified JSON, no prose, no markdown fences:
{"selected":[{"i":number,"verdict":"probing"|"fixating"|"noting","caption":string}]}
1 to 3 entries, in the order they should appear; each `i` must reference an
input candidate.
```

### Choosing the judge model

`JUDGE_MODEL` is a single constant, so switching is a one-line edit (and could be
promoted to a Worker `var` in `wrangler.toml` if you want to flip it without a
code change).

- **`claude-haiku-4-5` (default).** Fast and cheap. The task is bounded — read
  ~9 short snippets, label each, pick up to three, write ≤8-word captions — which
  Haiku handles well. Recommended for normal running; the per-request cost is
  negligible and it keeps the panel snappy.
- **`claude-sonnet-4-6` (upgrade).** Noticeably sharper wit and finer judgement
  on borderline pieces where substance and froth are tangled. Costs more per
  call and is a little slower, but still trivial at this volume. Switch to it if
  the captions feel flat or the probing/fixating calls feel coarse.

Because the judgement is hidden behind the already-async commentary panel,
neither choice affects time-to-first-answer. Start on Haiku; reach for Sonnet
only if the editorial voice isn't landing.

### Upgrade path: judge the full article, not just the snippet

The verdict is currently based only on the `snippet` Sonar returns, so a piece
can be richer (or thinner) than its summary suggests. If the calls start to feel
shallow, add a full-text pass *after* curation: curate on snippets as now, then
in the Worker `fetch()` only the up-to-three selected URLs, extract the readable
text (a light HTML-to-text pass), truncate it, and make a second short Claude
call to confirm or refine each `verdict` and `caption` from the real article.
Doing it after curation keeps it to three fetches, not nine.

Trade-offs to weigh before turning this dial:

- More latency and a little more cost — up to three extra fetches plus a second
  (small) judge call.
- Paywalls, bot-blocks, and redirects: some outlets won't return usable text.
  Fall back to the snippet verdict whenever a fetch fails or the extracted text
  is too short, so a card never ends up unjudged.
- HTML parsing: strip nav/boilerplate so the judge sees the article, not the
  page chrome, and cap the text (e.g. first ~1,500 words) to control tokens.

For a satirical site the snippet is usually enough to tell froth from substance —
treat full-text judging as a quality lever to pull only if the verdicts
disappoint, not a default.

### Secrets

```
npx wrangler secret put PERPLEXITY_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

For local dev, put both in a gitignored `.dev.vars` file so `wrangler dev` picks
them up without touching production secrets.

### How the page is served (chosen approach + why)

**Decision: the page is a plain `public/index.html`, served by the Worker's
static-assets binding. It is not an inline template literal, and not imported
into the Worker bundle.**

Why this is the simplest path to "one local dev server, everything runs":

- A single Worker with an `assets` directory plus a script gives Cloudflare's
  default routing: requests matching a file in the assets directory are served
  directly (the script isn't invoked); everything else hits the Worker. So `/`
  serves `public/index.html` and `/api/commentary` runs the Worker — one origin,
  one process. `wrangler dev` serves both; there is no separate frontend server.
- **vs. importing the HTML into the bundle** (Text module rule + `import`): that
  also yields one server, but it's more moving parts for no benefit here — a
  module rule, a manual `Content-Type`, a `/` route in code, and a rebuild on
  every HTML edit. The assets binding removes all of that and adds edge caching.
  The import approach only wins if you need to *generate* the HTML server-side,
  which this client-rendered page does not.
- **vs. inline template literal**: putting the whole page in a JS backtick
  string forces escaping of every `${...}`/backtick in the client script — an
  invisible-until-runtime bug class. Avoided entirely by using a real file.

`wrangler.toml`:

```toml
name = "is-burnham-pm-yet"
main = "src/worker.js"
compatibility_date = "2026-06-01"

[assets]
directory = "./public"
# No `binding` needed: we rely on automatic asset serving, not env.ASSETS.fetch().
# No `not_found_handling`: this is a single real page at "/", not an SPA.

# Cache for the two paid API calls — see "Caching" in §4.
[[kv_namespaces]]
binding = "COMMENTARY_CACHE"
id = "<run: npx wrangler kv namespace create COMMENTARY_CACHE>"
```

File layout:

```
public/
  index.html     # the full page: markup + <style> + client <script>
src/
  worker.js      # the API handler above (/api/commentary only)
wrangler.toml
```

Run it locally with a single server:

```
npx wrangler dev          # serves index.html AND /api/commentary on one origin
# set PERPLEXITY_API_KEY and ANTHROPIC_API_KEY (see §4 Secrets / .dev.vars)
npx wrangler deploy       # one Worker, one deploy
```

Author the client-side logic inside `index.html`'s `<script>` as ordinary JS:
fetch Wikidata directly (cross-origin, allowed) to set the hero answer, then
fetch `/api/commentary` (same-origin) to fill the probability and cards. It's a
real file, so normal template literals and `${...}` in that script are fine.

> Local secrets: `wrangler dev` reads a gitignored `.dev.vars` file for
> `PERPLEXITY_API_KEY` and `ANTHROPIC_API_KEY` (see Secrets above), so the
> commentary route works locally without touching production secrets.

### Response contract (Worker → frontend)

```json
{
  "probability_pct": 22,
  "one_line": "Burnham is the frontrunner but the contest hasn't been run yet.",
  "articles": [
    {
      "title": "string — the headline",
      "url": "string — link to the piece",
      "outlet": "string — publication name",
      "date": "string — ISO or human date",
      "verdict": "probing | fixating | noting",
      "caption": "string — serious if probing, scathing if fixating, neutral few words if noting"
    }
  ]
}
```

`articles` holds 1 to 3 entries whenever Stage 1 returned any candidates — there
is always at least one card, listed neutrally (`noting`) if nothing's good. It is
empty (`[]`) only when retrieval itself returned nothing. The frontend derives the
tag and styling from `verdict`: `"probing"` → a `Probing:` label in the calm
accent; `"fixating"` → a `Fixating on:` label in the scathing accent; `"noting"` →
a `Noted:` label in a muted neutral style, always followed by the neutral caption.
Every card has a label — there is no no-label state. The `caption` is the text
after the label.

If `articles` is empty, **or** the `/api/commentary` request itself fails or
times out, the frontend renders the built-in canned trio (see below) rather than
hiding the panel — an empty panel reads as broken on a joke site. If Stage 2 fails
but Stage 1 succeeded, the Worker still returns one `noting` card, so that path
shows a single real `Noted:` card, not the canned trio.

### Offline / empty fallback — the canned "From the archive" trio

When there's no live commentary to show (empty result or an unreachable Worker),
the page fills the panel from a small hardcoded set of evergreen satirical
articles baked into `index.html`, under a clear **"From the archive"** heading.
The hero answer and its "the verdict above stands regardless" framing are
unaffected; the probability shows its `—%` placeholder.

Guardrail (this is the integrity line we drew for the live judge, applied here):
the canned items are *invented* froth, so they must be unmistakably **not-live** —
shown only under the "From the archive" heading, never stamped with today's date
or presented as current coverage. The live pipeline never fabricates or inflates
real coverage; the fallback is openly a bit from the archive, and the newspaper
register (*The Daily Non-Forecast*) makes the comedy obvious. Marked that way, it
keeps the gag alive through an outage without claiming to mirror real press.

(The simpler alternative — hide the panel entirely on failure — is *not* what we
build; it's noted only as the thing we chose against.)

### Caching (so you don't pay per page load)

Without caching, every visit fires both paid calls. But the hero answer comes
from Wikidata client-side and isn't part of this — it stays live regardless — so
only the commentary needs caching, and it barely changes within a day. Cache the
**final combined `/api/commentary` result** and serve it to everyone for a TTL
window; credits are then spent once per window, not once per visit.

**Recommended: Workers KV, read-through.** The `COMMENTARY_CACHE` binding is
already in `wrangler.toml` above; create the namespace with
`npx wrangler kv namespace create COMMENTARY_CACHE` and paste the id. Then wrap
the pipeline in `handleCommentary`:

```js
const CACHE_KEY = "commentary:v1";
const TTL_SECONDS = 6 * 60 * 60; // 6h — this question moves slowly

// Serve from cache if present. KV auto-deletes the key when the TTL elapses,
// so a miss means "expired or never built" → regenerate.
const hit = await env.COMMENTARY_CACHE.get(CACHE_KEY, "json");
if (hit) return Response.json(hit);

// ... run Stage 1 + Stage 2 into `result` ...

// Cache real results only. Caching the empty fallback at the long TTL would
// freeze the panel blank for hours after a transient blip.
if (result.articles?.length) {
  await env.COMMENTARY_CACHE.put(CACHE_KEY, JSON.stringify(result), {
    expirationTtl: TTL_SECONDS,
  });
}
return Response.json(result);
```

Notes:

- KV is global but eventually consistent, so for a few seconds after expiry a
  handful of visitors may each regenerate before the new value propagates —
  harmless at this scale. (Minimum `expirationTtl` is 60s.)
- Bump `v1` in the key whenever you change the schema or the judge prompt, to
  bust stale entries.

**Upgrade — fully traffic-independent cost, no stampede: a Cron Trigger.** Run
the pipeline on a schedule and let the request path *only* read KV, never call
the APIs:

```toml
[triggers]
crons = ["0 */6 * * *"]   # rebuild every 6 hours
```

```js
export default {
  async fetch(req, env) { /* reads COMMENTARY_CACHE only; never calls the APIs */ },
  async scheduled(event, env, ctx) {
    const result = await runPipeline(env);            // Stage 1 + Stage 2
    if (result.articles?.length) {
      await env.COMMENTARY_CACHE.put("commentary:v1", JSON.stringify(result));
    }
  },
};
```

Now the APIs are hit exactly on the cron cadence no matter the traffic (even
zero), the request path can't block on a model call, and a traffic spike can't
trigger duplicate regenerations. Most predictable on cost; slightly more setup.
(Keep a lazy build-on-miss in `fetch` as a cold-start fallback so the very first
request before the first cron run isn't empty.)

**Simplest, no binding: the Cache API** (`caches.default`) keyed by the request,
with a `Cache-Control: s-maxage=…` header on the cached response. It caches at
the edge but *per data-centre*, so a global audience pays a bit more than KV
(once per colo per window). Fine for zero-config; KV or cron is better value.

### Robustness upgrade (optional)

The "respond only with JSON" instruction is pragmatic but not bulletproof for
either model. For Perplexity, if the tier supports it, a `response_format` JSON
schema removes the fence-stripping guesswork. For the Claude judge stage, the
sturdier option is a tool / `tool_choice` definition so the verdicts come back as
structured tool input rather than free-text JSON — worth doing if you ever see
the parse fall back to defaults.

---

## 5. Design direction

The design handoff (`design-andy-burnham-yet-handoff.html`) is the **visual
source of truth**: a satirical newspaper front page, *The Daily Non-Forecast*.
This section records the agreed tokens and the behavioural/build notes that the
implementation must honour; layout and styling otherwise follow the handoff.

Agreed tokens (from the handoff):

- **Palette:** paper `#F2EEE4`, ink `#17130D`, amber `#DB8E1A` (NOT YET / Fixating),
  green `#2F7D33` (YES / Probing), muted `#7a6f5d` (Noted).
- **Type:** Libre Caslon Display (hero), Georgia (body serif), Space Mono
  (labels / data).

Behaviour the visuals depend on:

- **Hero** dominates; `Not yet.` (amber) with `(but ask again in a month)`, or
  `Yes.` (green) with its own quip. The accent flips with the hero state.
- **Card colour is verdict-driven, independent of the hero state.** A `fixating`
  card stays amber even on the green `Yes` page. `Probing:` green, `Noted:` muted.
  All three are label-plus-caption; `Noted:` is the quietest, never scornful.
- **Probability** is "The Odds Desk": the number plus a dry caption, `—%`
  placeholder when unavailable.
- **Counter** in the footer ("Prime Ministers since the 2016 referendum: N") is a
  hardcoded constant that ticks from 6 to 7 when the hero flips to `Yes`.
- **States to build (all six in the handoff):** loading; NOT YET default; YES
  success; judge-failed (single neutral `Noted:` card); offline fallback (the
  built-in "From the archive" canned trio); and the empty-panel variant, which we
  are *not* shipping (we use the canned trio instead).

Build notes / things to get right:

- **Dynamic dates.** The handoff's dateline ("Sunday 21 June 2026") and card
  dates are mock. In the build the masthead dateline is today's date, and card
  dates come from the data. The canned-trio items must *not* be stamped with
  today's date (see the "From the archive" guardrail in §4).
- **Motion.** The handoff gives `fixating` cards a subtle jitter (froth can't sit
  still); `probing`/`noting` stay still. This is a touch more than "minimal," and
  it's good — just gate it behind `prefers-reduced-motion: reduce`.
- **Contrast.** Check amber `#DB8E1A` on paper `#F2EEE4` for *small* Space Mono
  labels; large hero type is fine, but small amber-on-cream may fall short of
  WCAG AA — darken the label or thicken the weight if so.
- **Fonts.** Libre Caslon Display and Space Mono load fine via a Google Fonts
  `<link>`; optionally self-host into `public/` to drop the external dependency.

---

## 6. Acceptance criteria (definition of done)

1. Page loads and, using only the Wikidata call, renders the correct hero
   answer — `Not yet.` today — with the `(but ask again in a month)` subtitle.
2. The hero answer renders even with the Worker disabled or failing.
3. The Worker proxies both Perplexity and Claude without ever exposing either
   API key to the client (verify: nothing sensitive in the network tab or
   `public/`).
4. When the pipeline succeeds, Stage 1 returns a varied pool (~9) and the page
   shows a probability figure and one to three curated commentary cards — always
   at least one when the pool is non-empty — each with outlet, date, headline, a
   verdict (`Probing:`, `Fixating on:`, or neutral `Noted:`), and a caption.
   Outlets are not all identical and obvious near-duplicates are dropped.
5. **Fairness check:** the judge is not reflexively cynical. Given a substantive
   article (e.g. a serious piece on Burnham's policy intentions or the legitimacy
   of a mid-term handover) in the pool, it returns `verdict: "probing"` with a
   serious caption — `Probing:` genuinely appears when earned, not only
   `Fixating on:`.
6. **Honesty check:** the panel reflects the pool rather than caricaturing it.
   The ~2:1 froth-to-substance lean is not forced — a substance-heavy pool yields
   more `Probing:`, a dull pool yields neutral `noting` cards, an all-froth pool
   yields `Fixating on:`. A merely unremarkable article is listed neutrally, not
   given a manufactured scathing caption, and an empty/weak pool still yields one
   neutrally-listed card rather than nothing.
7. Graceful degradation at each stage: if Stage 1 (Perplexity) fails or
   `/api/commentary` is unreachable, the hero answer is intact, the probability
   shows a `—%` placeholder, and the panel fills with the built-in "From the
   archive" canned trio (clearly marked not-live, never dated to today) rather
   than hiding. If Stage 2 (Claude) fails but Stage 1 succeeded, one candidate is
   listed as a real `Noted:` card with the neutral fallback caption — never a jab
   being invented.
8. The footer counter reads "Prime Ministers since the 2016 referendum: 6" and
   becomes 7 on the `Yes.` state.
9. The `JUDGE_MODEL` constant switches Haiku↔Sonnet in one edit, with no other
   code change required.
10. The "Yes" path is verifiable: temporarily forcing the matched label to
    contain "Burnham" flips the hero to `Yes.` with the success styling.
11. Mobile layout: hero answer is legible and dominant on a narrow viewport.
12. Runs as a **single** Worker with an `assets` directory: one `wrangler dev`
    serves both `public/index.html` and `/api/commentary` from one origin (no
    separate frontend server), and one `wrangler deploy` ships it. No Pages,
    Sites, or bundled-in HTML.
13. Caching works: repeated page loads within the TTL serve the commentary from
    KV without re-calling Perplexity or Claude (verify the paid calls fire on a
    cache miss, not on every request). The empty fallback is not cached at the
    long TTL.

---

## 7. Out of scope / explicit non-goals

- No accounts, email collection, database, or analytics beyond the basics.
- No frontend build step. `public/index.html` is plain HTML/CSS/JS served
  directly by the assets binding; only the Worker script is bundled by Wrangler.
- Not a real prediction engine — the percentage is illustrative.
- The footer PM counter is a hardcoded constant (6, → 7 on `Yes`), not a live
  data feed. Bump it by hand on the rare occasion it changes.
- The "From the archive" canned trio is intentional evergreen fiction for the
  offline state, not real coverage. It is the one place invented froth is allowed,
  because it is openly marked not-live (see §4); the live pipeline never does this.

## 8. Stretch goals (only if trivial)

- Swap the model's vibe-estimate for a **real** market probability (Polymarket /
  Metaculus "next UK PM" contract) and display both side by side — the genuine
  number against the press's hand-wringing. This sharpens the thesis.
- A tiny "last checked" timestamp under the answer.
- Auto-refresh the answer every few minutes so the page flips live on the day it
  finally becomes `Yes.`
