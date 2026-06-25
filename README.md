# Is Andy Burnham the UK Prime Minister yet?

> **Note:** This project is mainlyb really just a test of using Magnus's AI-assisted development template (originally built for Claude Code) with Mistral Vibe CLI.

---

A one-page website that answers a single binary question and contrasts the calm, authoritative truth with the frothy, detail-obsessed UK political press coverage.

---

## Features

- **Hero answer** from Wikidata SPARQL (client-side, no server dependency)
- **Probability readout** from Perplexity Sonar API via Worker
- **Press panel** with articles judged and curated by Claude
- **States**: loading, NOT YET, YES
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
gate, cache reads) and the front-end XSS-escaping guarantee. See
[`REFERENCE/testing-strategy.md`](./REFERENCE/testing-strategy.md) for the
approach.
