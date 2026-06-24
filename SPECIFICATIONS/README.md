# Project Specifications

This directory contains all specifications for the "Is Andy Burnham the UK Prime Minister yet?" project.

**Note:** Completed phases (1-3) have been archived to `SPECIFICATIONS/ARCHIVE/2026-06-24-Phase-1-3/` with full implementation details and completion summaries.

---

## Document Hierarchy

```
SPECIFICATIONS/
├── ORIGINAL_IDEA/
│   ├── idea-spec-andy-burnham-yet.md      # Primary technical specification
│   ├── design-andy-burnham-yet-handoff.html # Visual source of truth
│   └── project-outline.md                 # Project outline with all decisions
│
├── ARCHIVE/
│   └── 2026-06-24-Phase-1-3/             # Completed phases 1-3 (see below)
│       ├── PHASE-1-foundation.md         # ✅ Phase 1: Project Setup & Static Page
│       ├── PHASE-2-wikidata.md           # ✅ Phase 2: Wikidata Integration
│       └── PHASE-3-worker-api.md         # ✅ Phase 3: Worker API & Commentary Pipeline
│
├── PHASE-4-caching.md                    # Phase 4: Caching with Cron Trigger
└── PHASE-5-deployment.md                 # Phase 5: Testing, Polish & Deployment
```

---

## Implementation Order

1. **Phase 1: Foundation** - Project structure, static page, all visual states
2. **Phase 2: Wikidata Integration** - Hero answer from SPARQL
3. **Phase 3: Worker API** - Perplexity + Claude pipeline
4. **Phase 4: Caching** - KV + Cron trigger
5. **Phase 5: Deployment** - Testing, polish, GitHub Actions, production

---

## Quick Reference

### Source of Truth
- **Technical:** `ORIGINAL_IDEA/idea-spec-andy-burnham-yet.md`
- **Visual:** `ORIGINAL_IDEA/design-andy-burnham-yet-handoff.html`
- **Decisions:** `ORIGINAL_IDEA/project-outline.md`

### Key Decisions
| Decision | Value | Reference |
|----------|-------|-----------|
| Worker name | `andy-burnham-yet` | project-outline.md §109 |
| Judge model | `claude-haiku-4-5` (start) | project-outline.md §109 |
| Caching strategy | Cron trigger | project-outline.md §110 |
| YES test param | `?force=yes` | project-outline.md §111 |
| Date format | Match mockup exactly | project-outline.md §115 |
| Canned trio | Exact 3 from handoff | project-outline.md §117-120 |
| WCAG fix | Darken amber for small text | project-outline.md §122 |

---

## Status Tracking

Use the todo list or update this file to track phase completion:

- [x] Phase 1: Foundation (Completed 2026-06-24 - archived)
- [x] Phase 2: Wikidata Integration (Completed 2026-06-24 - archived)
- [x] Phase 3: Worker API (Completed 2026-06-24 - archived)
- [ ] Phase 4: Caching
- [ ] Phase 5: Deployment

---

## Links

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Wikidata SPARQL](https://query.wikidata.org/)
- [Perplexity API Docs](https://docs.perplexity.ai/)
- [Anthropic API Docs](https://docs.anthropic.com/)
