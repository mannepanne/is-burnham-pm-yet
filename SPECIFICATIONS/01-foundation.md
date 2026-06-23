# Phase 1: Foundation

**Phase number:** 1
**Phase name:** Foundation
**Estimated timeframe:** Week 1 (3-5 days)
**Dependencies:** None - starting phase

**Brief description:**
Establish the project structure, set up the Cloudflare Worker with static assets binding, and implement the core hero answer functionality using Wikidata SPARQL. This phase delivers a working page that answers the binary question, with all static styling in place. No API keys or external services required yet — the hero answer works standalone.

---

## Scope and deliverables

### In scope
- [ ] Project repo initialized (`is-burnham-pm-yet`)
- [ ] Cloudflare Worker project structure with `wrangler.toml`
- [ ] Static assets binding configured for `public/` directory
- [ ] `public/index.html` with complete page structure and static CSS
- [ ] Google Fonts integration (Libre Caslon Display, Georgia, Space Mono)
- [ ] All five visual states from handoff implemented in HTML/CSS (loading, NOT YET, YES, judge-failed, offline fallback)
- [ ] Client-side Wikidata SPARQL integration
- [ ] Hero answer logic: "Not yet." / "Yes." with correct styling and subtitles
- [ ] Footer counter: hardcoded "6" that ticks to "7" on Yes state
- [ ] Dynamic masthead dateline ("Sunday 21 June 2026" format)
- [ ] Graceful degradation: hero renders even if JS fails
- [ ] `?force=yes` query param for testing Yes state
- [ ] Darkened amber for small Space Mono labels (WCAG AA compliance)
- [ ] Jitter animation CSS for fixating cards (gated behind `prefers-reduced-motion`)
- [ ] Placeholder elements for probability and commentary panel
- [ ] Canned trio HTML baked into page (hidden by default)

### Out of scope
- Perplexity API integration (Phase 2)
- Claude API integration (Phase 2)
- Actual commentary panel data (Phase 2)
- KV caching (Phase 3)
- Cron trigger (Phase 3)
- GitHub Actions deployment (Phase 4)
- Tests (Phase 2+ will add tests; this phase focuses on core functionality)

### Acceptance criteria
- [ ] Page loads and renders `Not yet.` with amber styling and subtitle
- [ ] `?force=yes` renders `Yes.` with green styling and success subtitle
- [ ] Footer counter shows "6" on Not yet, "7" on Yes
- [ ] Masthead shows today's date in correct format
- [ ] All five visual states are present in the DOM (even if hidden/placeholder)
- [ ] Wikidata call succeeds and correctly parses P6 for Q145
- [ ] Hero renders even with Worker disabled (static fallback)
- [ ] Page is fully styled per design handoff
- [ ] Fonts load correctly from Google Fonts
- [ ] No console errors on page load
- [ ] Responsive: hero legible and dominant on mobile viewport

---

## Technical approach

### Architecture decisions

**Worker + Static Assets Binding:**
- Choice: Single Cloudflare Worker with `assets` directory binding
- Rationale: Achieves "one server, everything runs" for local dev with `wrangler dev`. Requests matching files in `public/` are served directly; `/api/commentary` hits the Worker script.
- Alternatives considered: Inline HTML in Worker bundle (more complex, escaping issues); separate frontend server (violates single-server requirement)

**Wikidata Client-Side:**
- Choice: Browser fetches Wikidata SPARQL directly (CORS-friendly, no API key needed)
- Rationale: Hero answer is source of truth and must work standalone without the Worker. Wikidata allows cross-origin requests.
- Alternatives considered: Proxy through Worker (adds unnecessary latency and dependency)

**No Build Step:**
- Choice: Plain HTML/CSS/JS in `public/index.html`
- Rationale: Matches Cloudflare-first philosophy; no need for bundling since it's a single-page site with minimal JS
- Alternatives considered: Vite/ESBuild (overkill for this simplicity)

### Technology choices

**Cloudflare Workers:**
- Purpose: Hosting and API routing
- Documentation: https://developers.cloudflare.com/workers/

**Wikidata SPARQL:**
- Purpose: Current UK PM data source
- Endpoint: `https://query.wikidata.org/sparql`
- Query: `SELECT ?pmLabel WHERE { wd:Q145 wdt:P6 ?pm. SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`

**Google Fonts:**
- Purpose: Typeface serving
- Fonts: Libre Caslon Display, Georgia (system fallback), Space Mono

### Key files and components

**New files to create:**
```
is-burnham-pm-yet/
├── public/
│   └── index.html          # Full page with markup, CSS, client JS
├── src/
│   └── worker.js            # Worker script (minimal for Phase 1: 404 for /api/commentary)
├── wrangler.toml           # Worker config with assets binding
└── .dev.vars               # Local dev secrets (already created with placeholders)
```

**Files to modify:**
- None (fresh project)

---

## Testing strategy

### Manual testing checklist

- [ ] Page loads without errors in browser
- [ ] `Not yet.` renders correctly with amber styling
- [ ] `?force=yes` renders `Yes.` with green styling
- [ ] Footer counter shows correct values
- [ ] Masthead date is today's date in correct format
- [ ] All fonts load (check network tab)
- [ ] Page is responsive on mobile (test at 375px viewport)
- [ ] Wikidata call succeeds (check network tab for SPARQL request)
- [ ] Hero renders if Worker is stopped (static HTML fallback)
- [ ] No console errors or warnings

---

## Pre-commit checklist

Before creating PR, verify:

- [ ] No console.log or debug code left in
- [ ] No secrets or sensitive data in code
- [ ] HTML is valid (no unclosed tags)
- [ ] CSS is valid (no syntax errors)
- [ ] JS is valid (no syntax errors)
- [ ] All manual tests pass

---

## PR workflow

### Branch naming
```
feature/phase-1-foundation
```

### PR title
```
Phase 1: Foundation
```

### Deployment Notes
- This phase does not require deployment to Cloudflare yet (Worker only serves static HTML, no API functionality)
- Can test locally with `npx wrangler dev`

---

## Edge cases and considerations

### Known risks
- **Wikidata lag:** Wikidata may lag behind reality by hours/days. This is acceptable and on-brand for the site's tone.
- **SPARQL query changes:** Wikidata query format or endpoint could change. Mitigation: use well-established P6 property which is unlikely to change.

### Performance considerations
- Single HTTP request (Wikidata SPARQL) for core functionality
- No external dependencies for hero answer
- Static assets served directly by Worker (no Worker invocation overhead)

### Security considerations
- No API keys exposed (Wikidata requires none)
- No user input processed in this phase

### Accessibility considerations
- Hero text is large and high-contrast
- Amber color for "Not yet" will be darkened for small text to meet WCAG AA
- Semantic HTML structure for screen readers

### Future optimisation opportunities
- Could add service worker for offline caching (Phase 3+)
- Could preload Google Fonts (Phase 3)

---

## Technical debt introduced

None for this phase - foundation is clean and minimal.

---

## Related documentation

- [project-outline.md](./ORIGINAL_IDEA/project-outline.md) - Master specification
- [idea-spec-andy-burnham-yet.md](./ORIGINAL_IDEA/idea-spec-andy-burnham-yet.md) - Original detailed spec
- [design-andy-burnham-yet-handoff.html](./ORIGINAL_IDEA/design-andy-burnham-yet-handoff.html) - Visual source of truth

---

## Notes

This phase establishes the visual foundation and core answer logic. The commentary panel will show placeholders that Phase 2 will populate with real data. All styling, animations, and structural HTML should be complete by the end of this phase so Phase 2 can focus purely on the API integration.
