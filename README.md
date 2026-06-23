# Is Andy Burnham the UK Prime Minister yet?

> **Note:** This project is also a test of using Magnus's AI-assisted development template (originally built for Claude Code) with Mistral Vibe CLI.

---

A satirical one-page website that answers a single binary question and contrasts the calm, authoritative truth with the frothy, detail-obsessed UK political press coverage.

The site is styled as *The Daily Non-Forecast*, a newspaper front page where a huge "Yes." or "Not yet." dominates the viewport, while a panel of curated press articles below reveals the media's obsession with trivia (coats, zips, trams) rather than the actual question.

---

## Quick Start

```bash
# Install dependencies
npm install

# Local development
npx wrangler dev

# Open in browser: http://localhost:8787
```

---

## Features

- **Hero answer** from Wikidata SPARQL (client-side, no server dependency)
- **Probability readout** from Perplexity Sonar API via Worker
- **Press panel** with articles judged and curated by Claude
- **Six states**: loading, NOT YET, YES, judge-fallback, offline, empty
- **Caching** via Workers KV with cron trigger

---

## Architecture

Single Cloudflare Worker with static assets binding:
- `GET /` serves `public/index.html`
- `GET /api/commentary` Worker retrieves & curates press articles

No database, no Pages, no Sites — just one `wrangler dev` server.

---

## Query Param Testing

| Param | Effect |
|-------|--------|
| `?force=yes` | Simulate Burnham as PM (green "Yes.") |
| `?force=no` | Force "Not yet." state |
| `?simulate=offline` | Show canned trio fallback |
| `?simulate=judge-fail` | Show single neutral card |

---

## Configuration

Create `.dev.vars` for local development:
```
PERPLEXITY_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

Production secrets via `wrangler secret put`.

---

## License

MIT
