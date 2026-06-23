# Project Outline: Is Andy Burnham the UK Prime Minister yet?

> **Last updated:** 2026-06-23
> **Source of truth:** This document captures all decisions made during the orientation conversation. It references `idea-spec-andy-burnham-yet.md` (the primary specification) and `design-andy-burnham-yet-handoff.html` (visual source of truth).

---

## What this is

A **satirical one-page website** that answers a single binary question — *Is Andy Burnham the UK Prime Minister yet?* — and contrasts that calm, authoritative truth against the frothy, detail-obsessed UK political press coverage. The visual hierarchy is the thesis: the binary answer dominates the viewport, while the commentary panel is small, busy, and slightly absurd beneath it.

The site is styled as a satirical newspaper front page, *The Daily Non-Forecast*, with a masthead, dateline, mock weather, probability readout ("The Odds Desk"), and curated commentary under "Meanwhile, the papers are…".

---

## Why this exists

- **Satirical commentary**: Highlights the contrast between simple truth and media froth
- **Technical demonstration**: Showcases Cloudflare Workers with static assets, API routing, and external API integration (Perplexity, Anthropic)
- **Cloudflare-first**: Demonstrates Magnus's preferred architecture — single Worker, no Pages/Sites, no separate frontend server
- **Graceful degradation**: Core answer (Wikidata) works standalone; commentary (Perplexity + Claude) is enhancement

---

## Who it's for

- **Primary**: Magnus Hultberg (personal project, evaluation of Vibe workflow)
- **Secondary**: Demonstrating the template's effectiveness for AI-assisted development

---

## Core features (in scope)

*Derived from `idea-spec-andy-burnham-yet.md` with decisions from orientation conversation.*

### 1. Hero Answer
- Single huge word/phrase dominating the viewport
- `Yes.` (green, with quip "(finally. you may sit down.)") if Wikidata P6 for Q145 contains "Burnham"
- `Not yet.` (amber, with subtitle "(but ask again in a month)") otherwise
- **Source of truth**: Must render even if everything else on the page fails

### 2. Probability Readout
- Large percentage with one-line caption from Perplexity
- Clearly framed as a vibe, not a forecast
- Fallback to `—%` placeholder if unavailable

### 3. "Meanwhile, the papers are…" Panel
- 1-3 curated articles from a pool of ~9 retrieved by Perplexity Sonar
- Each card judged by Claude and assigned a verdict:
  - **Fixating on:** (froth) — scathing, tongue-in-cheek caption; amber styling; subtle jitter animation
  - **Probing:** (substance) — serious caption; green styling; still
  - **Noted:** (neutral) — plain, neutral caption; muted styling; still
- Cards reflect the actual character of coverage, not a caricature
- Outlets are diverse; near-duplicates are dropped

### 4. Footer Counter
- "Prime Ministers since the 2016 referendum: N"
- Hardcoded constant: 6 today, ticks to 7 when hero flips to `Yes.`
- Dry punchline; not a live data feed

### 5. Fallback States
- **Judge failed (State 4)**: Single neutral `Noted:` card with fallback caption
- **Offline (State 5)**: Built-in "From the archive" canned trio (clearly marked not-live, never dated to today)
- **Loading (State 1)**: "Checking the scoreboard…" with pulsing dots

### 6. Design Fidelity
- Follow `design-andy-burnham-yet-handoff.html` exactly
- Palette: paper `#F2EEE4`, ink `#17130D`, amber `#DB8E1A` (darkened for small text), green `#2F7D33`, muted `#7a6f5d`
- Type: Libre Caslon Display (hero), Georgia (body serif), Space Mono (labels/data)
- All five required states from handoff to be built (loading, NOT YET, YES, judge-failed, offline fallback)
- Dynamic dates: masthead uses today's date in "Sunday 21 June 2026" format; card dates from data

---

## Explicitly out of scope

- State 6 (empty panel) — we are building State 5 (canned trio) instead
- Real prediction engine (the percentage is illustrative, from Perplexity)
- Accounts, email collection, database, or analytics
- Live PM counter feed (hardcoded constant only)
- Real articles in the canned trio (intentional evergreen fiction, openly marked not-live)

---

## Constraints and assumptions

| Constraint | Decision |
|-----------|----------|
| **Architecture** | Single Cloudflare Worker with static-assets binding. No Pages, no Sites, no separate frontend dev server. |
| **Routing** | `GET /` serves `public/index.html`; `GET /api/commentary` runs Worker script. Same origin, one `wrangler dev` server. |
| **API Keys** | Perplexity and Anthropic keys required; provided by Magnus; stored as Worker secrets. |
| **Data sources** | Wikidata SPARQL (client-side, CORS-friendly); Perplexity Sonar API; Anthropic Messages API. |
| **Model choice** | Start with `claude-haiku-4-5`; one-line switch to `claude-sonnet-4-6` if needed. |
| **Caching** | Cron trigger for traffic-independent cost; KV namespace for commentary cache. |
| **Worker name** | `andy-burnham-yet` |
| **Deployment** | First deploy via `wrangler`; then GitHub Actions auto-deploy on merge to main. |

### Assumptions that could be wrong
- Perplexity Sonar API remains available and returns representative article pools
- Wikidata P6 property for UK head of government remains stable
- Claude models continue to accept the structured JSON response format
- Cloudflare Workers KV remains the recommended caching mechanism

---

## Decisions from orientation conversation

### Architecture Decisions
1. **JUDGE_MODEL default**: `claude-haiku-4-5` (fast, cheap; switch to Sonnet if wit feels flat)
2. **Caching strategy**: Cron trigger (most predictable cost, traffic-independent, no stampede)
3. **YES state testing**: Query param `?force=yes` to simulate Burnham being PM
4. **Worker name**: `andy-burnham-yet`

### Design Decisions
5. **Date format**: Match mockup exactly — "Sunday 21 June 2026" style
6. **Jitter animation**: Exactly as shown in handoff; respect `prefers-reduced-motion: reduce`
7. **Canned trio**: Use the three exact examples from the design handoff:
   - "Inside Burnham's anorak: what the zip tells us about the soul of Labour" (Fixating on: the coat)
   - "Mood in the tearoom 'fizzy', says man who was not in the tearoom" (Fixating on: one source's choice of adjective)
   - "Could the 07:42 tram to Altrincham hold the key to Number 10?" (Fixating on: a tram timetable)
8. **Empty panel**: Skip entirely; only build State 5 (canned trio fallback)
9. **Contrast**: Darken amber for small Space Mono labels to meet WCAG AA

### Process Decisions
10. **Phasing**: 4 phases — Foundation, Commentary API, Polish, Deployment & Testing
11. **Testing**: Write tests for both Worker logic and client-side rendering

---

## What "good" looks like

*Success criteria for this project.*

- The page loads and correctly renders `Not yet.` (with amber styling) using only the Wikidata call
- The hero answer renders even with the Worker disabled or failing
- The Worker never exposes Perplexity or Anthropic API keys to the client
- When the pipeline succeeds, the page shows a probability figure and 1-3 curated commentary cards
- The judge is not reflexively cynical: `Probing:` genuinely appears when earned
- The panel reflects the pool rather than caricaturing it (honest curation)
- Graceful degradation: hero intact, probability placeholder, canned trio on failure
- Footer counter reads "6" and becomes "7" on `Yes.` state
- `JUDGE_MODEL` constant can be switched Haiku<>Sonnet in one edit
- The "Yes" path is verifiable via `?force=yes`
- Mobile layout: hero answer is legible and dominant on narrow viewports
- Single Worker with assets binding: one `wrangler dev`, one `wrangler deploy`
- Caching works: repeated loads within TTL serve from KV without re-calling APIs
- All five required states from the handoff are built and functional

---

## Open questions

*To be resolved during implementation.*

- What TTL should we use for the commentary cache? (Spec suggests 6 hours)
- Should the Cron trigger run every 6 hours to match the cache TTL?
- How should we handle the transition state where Wikidata might lag behind reality?
- Should we add a "last checked" timestamp under the answer?
- Should we implement auto-refresh of the answer every few minutes?

---

## Technology stack

| Component | Technology |
|-----------|------------|
| **Hosting** | Cloudflare Workers (single Worker with assets binding) |
| **Static assets** | Worker static-assets binding (serves `public/index.html`) |
| **Backend** | Cloudflare Workers (ES modules) |
| **API routing** | Worker script handles `/api/commentary` |
| **Data sources** | Wikidata SPARQL, Perplexity Sonar API, Anthropic Messages API |
| **Caching** | Cloudflare Workers KV (Cron trigger pattern) |
| **Secrets** | `wrangler secret` (PERPLEXITY_API_KEY, ANTHROPIC_API_KEY) |
| **Frontend** | Plain HTML/CSS/JS in `public/index.html` (no build step) |
| **Type** | Libre Caslon Display, Georgia, Space Mono (Google Fonts) |
| **Deployment** | `wrangler deploy`; GitHub Actions for auto-deploy on merge to main |

---

## File structure

```
is-burnham-pm-yet/
├── public/
│   └── index.html          # Full page: markup + <style> + client <script>
├── src/
│   └── worker.js            # API handler for /api/commentary
├── wrangler.toml           # Worker config with KV namespace
├── package.json            # Dependencies (if any)
└── .dev.vars               # Local dev secrets (gitignored)
```

---

## Naming and inspiration

- **Repo name**: `is-burnham-pm-yet` (suggested in spec)
- **Worker name**: `andy-burnham-yet` (Magnus's preference)
- **Concept**: Satirical newspaper front page contrasting truth with froth
- **Inspiration**: The absurdity of political media fixating on trivia while missing the big picture

---

## Next steps

1. ✅ Orientation conversation complete
2. ✅ `.dev.vars` created with placeholders
3. ✅ Project outline written (this document)
4. **Next**: Break into phased deliverables in `SPECIFICATIONS/`
5. **Then**: Begin Phase 1 implementation

---

*Ready to proceed to phased planning.*
