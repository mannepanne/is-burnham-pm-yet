# Is Andy Burnham the UK Prime Minister yet?

> **Note:** This project is mainly really just a test of using Magnus's AI-assisted development template (originally built for Claude Code) with Mistral Vibe CLI.

---

A one-page website that answers a single binary question and contrasts the calm, authoritative truth with the frothy, detail-obsessed UK political press coverage.

---

## Features

- **Hero answer** — a fixed "Yes": Andy Burnham is Prime Minister, so the question is settled and the live Wikidata SPARQL check has been retired (a `?force=no` override still previews the "Not yet" state)
- **Probability readout** from Perplexity Sonar API via Worker
- **Press panel** with articles judged and curated by Claude, sampled across the political spectrum
- **Archive** sub-page — a paginated, newest-first record of every article shown, which also rotates the front page away from repeats
- **States**: loading, YES (default), NOT YET (via override)
- **Caching** via Workers KV with cron trigger

---

## Testing

Tests run with [Vitest](https://vitest.dev/) (happy-dom for the front-end render guard):

```bash
npm test            # run the suite once
npm run test:watch  # watch mode
npm run test:coverage  # with coverage (HTML report in coverage/)
```

The suite covers the Worker handlers (judge/curate, the `/api/refresh` auth
gate, cache reads), the archive helpers (URL normalisation, selection/rotation,
append/dedup, pagination), the `/api/archive` endpoint, and the front-end
XSS-escaping guarantee (including the archive page's card rendering). See
[`REFERENCE/testing-strategy.md`](./REFERENCE/testing-strategy.md) for the
approach.
