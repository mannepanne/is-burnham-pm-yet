# Phase 3: Polish

**Phase number:** 3
**Phase name:** Polish
**Estimated timeframe:** Week 3 (2-3 days)
**Dependencies:** Phase 2 (Commentary API) must be complete

**Brief description:**
Add caching to reduce API costs, implement final polish items (animations, contrast fixes), and ensure the site is production-ready. This phase focuses on optimisation and refinement rather than new functionality.

---

## Scope and deliverables

### In scope
- [ ] KV namespace created and configured in `wrangler.toml`
- [ ] Cron trigger implemented for commentary cache regeneration
- [ ] Read-through cache fallback (for first request before cron runs)
- [ ] Cache TTL: 6 hours (matching spec recommendation)
- [ ] Cache key versioning (bump on schema/prompt changes)
- [ ] Caching only for successful results (not empty/fallback responses)
- [ ] Darkened amber color for small Space Mono labels (WCAG AA compliance)
- [ ] Jitter animation for fixating cards implemented and tested
- [ ] Responsive design refinements (mobile layout tweaks)
- [ ] Client-side tests for rendering logic
- [ ] Load testing for Worker (simulate traffic spikes)
- [ ] Performance optimisation (minify CSS, optimise JS)

### Out of scope
- New features (all core functionality in Phase 1-2)
- Deployment automation (Phase 4)
- GitHub Actions setup (Phase 4)
- Stretch goals (Polymarket probability, auto-refresh)

### Acceptance criteria
- [ ] KV namespace created and bound in Worker
- [ ] Cron trigger runs every 6 hours
- [ ] Cache hit: repeated requests within 6h serve from KV without API calls
- [ ] Cache miss: first request after expiry regenerates cache
- [ ] Cache invalidation: version bump clears stale entries
- [ ] Small amber text passes WCAG AA contrast check
- [ ] Jitter animation works for fixating cards
- [ ] Jitter animation respects `prefers-reduced-motion: reduce`
- [ ] Mobile layout: hero legible, cards readable, no horizontal overflow
- [ ] All client-side tests pass
- [ ] Load test: 100 concurrent requests handled without errors

---

## Technical approach

### Architecture decisions

**Cron Trigger over Read-Through:**
- Choice: Scheduled Cron trigger that rebuilds cache on a timer
- Rationale: Most predictable cost (APIs hit exactly on schedule, not per traffic), no stampede risk, traffic-independent. Simpler to reason about.
- Alternatives considered: Read-through cache (works but traffic-dependent cost); Cache API (per-colo caching, more expensive)

**Cache Key Versioning:**
- Choice: Include version in cache key (e.g., `commentary:v1`)
- Rationale: Allows busting stale cache when schema or judge prompt changes
- Alternatives considered: Cache bust on every deploy (overkill); no versioning (risk of stale data after changes)

**6-Hour TTL:**
- Choice: Cache commentary for 6 hours
- Rationale: Question moves slowly; 6h balances freshness with cost savings
- Alternatives considered: 1h (too frequent), 12h (too stale), 24h (too stale)

**Darkened Amber:**
- Choice: Use a slightly darker amber for small text elements
- Rationale: WCAG AA compliance for small Space Mono labels on paper background
- Implementation: Define a separate CSS variable or use a darkening function

### Technology choices

**Cloudflare Workers KV:**
- Purpose: Persistent key-value storage for commentary cache
- Documentation: https://developers.cloudflare.com/workers/platform/kv/

**Cloudflare Cron Triggers:**
- Purpose: Scheduled cache regeneration
- Documentation: https://developers.cloudflare.com/workers/platform/cron-triggers/

**Contrast Checking:**
- Purpose: Verify WCAG AA compliance
- Tool: Use browser dev tools or online contrast checker
- Target: Amber on paper for small text (12px Space Mono)

### Key files and components

**New files to create:**
```
is-burnham-pm-yet/
├── src/
│   └── test/
│       └── client.test.js    # Client-side rendering tests
└── .github/
    └── workflows/
        └── deploy.yml        # Will be created in Phase 4, but structure planned here
```

**Files to modify:**
```
- src/worker.js - Add KV binding, Cron trigger handler, cache read/write logic
- wrangler.toml - Add KV namespace binding and Cron trigger configuration
- public/index.html - Darken amber for small labels, ensure jitter animation CSS
```

---

## Testing strategy

### Unit tests

**Coverage targets:**
- Lines: 90%+
- Functions: 90%+
- Branches: 85%+

**Test scenarios:**
- [ ] Cache hit returns cached data
- [ ] Cache miss triggers regeneration
- [ ] Cache key versioning works
- [ ] Stale cache is not served after expiry

### Client-side tests

**Test scenarios:**
- [ ] All five states render correctly
- [ ] Verdict styling applied correctly (amber/green/muted)
- [ ] Canned trio shows when API fails
- [ ] Loading state shows during Wikidata fetch
- [ ] Jitter animation applies to fixating cards only
- [ ] Reduced motion preference disables jitter

### Manual testing checklist

- [ ] Cache works: first load hits APIs, second load within 6h uses cache
- [ ] Cache expires: after 6h, next load regenerates
- [ ] Small amber text is readable and passes contrast check
- [ ] Jitter animation is subtle and works on fixating cards
- [ ] Reduced motion: jitter disabled when prefers-reduced-motion is reduce
- [ ] Mobile: test on iPhone SE (375px) and iPad (768px) viewports

---

## Pre-commit checklist

Before creating PR, verify:

- [ ] All unit tests passing
- [ ] All client-side tests passing
- [ ] Coverage meets targets
- [ ] No console.log or debug code left in
- [ ] No secrets or sensitive data in code
- [ ] KV namespace is referenced correctly in wrangler.toml
- [ ] All manual tests pass

---

## PR workflow

### Branch naming
```
feature/phase-3-polish
```

### PR title
```
Phase 3: Polish
```

### Review requirements
- Use `/review-pr` — this phase involves caching logic and production readiness

### Deployment Notes
- Requires KV namespace to be created:
  ```bash
  npx wrangler kv namespace create COMMENTARY_CACHE
  ```
- Paste the namespace ID into `wrangler.toml`
- Cron trigger will be activated on deploy

---

## Edge cases and considerations

### Known risks
- **KV namespace limits:** Free tier has 1GB storage and 100k reads/day. Mitigation: our usage is well within limits (cache is small JSON, ~100 reads/day max).
- **Cron trigger drift:** Cron may fire slightly off-schedule. Mitigation: read-through fallback ensures cache is always available.
- **Cache stampede:** Multiple requests hitting cache miss simultaneously. Mitigation: Cron trigger prevents this; read-through fallback as backup.

### Performance considerations
- KV read is fast (edge-local)
- Cron trigger runs regardless of traffic (predictable cost)
- Cache size is minimal (single JSON response, ~2-4KB)

### Security considerations
- KV namespace is bound to Worker, not publicly accessible
- Cache contains no sensitive data (only article metadata and captions)

### Accessibility considerations
- Darkened amber ensures small text meets WCAG AA
- Jitter animation respects user preferences

### Future optimisation opportunities
- Service worker for offline caching (PWA-like experience)
- Preload Google Fonts for faster rendering
- Implement auto-refresh for answer every few minutes

---

## Technical debt introduced

None for this phase - all decisions are production-ready.

---

## Related documentation

- [project-outline.md](./ORIGINAL_IDEA/project-outline.md) - Master specification
- [idea-spec-andy-burnham-yet.md](./ORIGINAL_IDEA/idea-spec-andy-burnham-yet.md) - Original detailed spec (see §4 Caching)
- [01-foundation.md](./01-foundation.md) - Phase 1
- [02-commentary-api.md](./02-commentary-api.md) - Phase 2

---

## Notes

This phase is about making the site production-ready. The caching implementation is critical for cost control, and the polish items (contrast, animations) ensure the site meets quality standards. By the end of this phase, the site should be fully functional and ready for deployment.
