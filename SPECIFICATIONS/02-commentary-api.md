# Phase 2: Commentary API

**Phase number:** 2
**Phase name:** Commentary API
**Estimated timeframe:** Week 2 (3-5 days)
**Dependencies:** Phase 1 (Foundation) must be complete

**Brief description:**
Implement the `/api/commentary` endpoint in the Cloudflare Worker, integrating Perplexity Sonar for article retrieval and Claude for judging/curating. This phase connects the static page to live data, enabling the "Meanwhile, the papers are…" panel to show real, curated commentary cards. All API keys remain server-side; the browser only sees the final curated JSON.

---

## Scope and deliverables

### In scope
- [ ] Worker script fully implemented for `/api/commentary` route
- [ ] Perplexity Sonar integration (Stage 1: retrieve ~9 article pool)
- [ ] Claude integration (Stage 2: judge, curate, caption)
- [ ] Response contract implemented (probability_pct, one_line, articles array)
- [ ] Verdict-driven card styling (fixating=amber, probing=green, noted=muted)
- [ ] Graceful degradation logic:
  - If Stage 1 fails: return empty with probability/one_line if available
  - If Stage 2 fails but Stage 1 succeeded: return single Noted card with neutral caption
  - If `/api/commentary` unreachable: client falls back to canned trio
- [ ] Worker secrets configured (PERPLEXITY_API_KEY, ANTHROPIC_API_KEY)
- [ ] Judge model constant: `claude-haiku-4-5` with one-line switch capability
- [ ] Error handling for both API calls (Perplexity and Claude)
- [ ] JSON parsing with fallback to defaults
- [ ] Unit tests for Worker logic (commentary pipeline)
- [ ] Integration test for `/api/commentary` endpoint

### Out of scope
- KV caching (Phase 3)
- Cron trigger (Phase 3)
- Full-text judging (upgrade path mentioned in spec, not required)
- Polymarket/Metaculus probability (stretch goal, not in scope)
- Auto-refresh (stretch goal, not in scope)
- GitHub Actions deployment (Phase 4)

### Acceptance criteria
- [ ] `/api/commentary` returns valid JSON with probability, one_line, and articles
- [ ] Stage 1 (Perplexity) returns varied pool of ~9 articles
- [ ] Stage 2 (Claude) curates 1-3 cards with correct verdicts and captions
- [ ] Verdicts are honest: Probing appears when earned, not reflexively cynical
- [ ] Panel reflects pool character, not caricature
- [ ] If Stage 1 fails: client shows hero + placeholder % + canned trio
- [ ] If Stage 2 fails but Stage 1 succeeded: client shows hero + probability + single Noted card
- [ ] API keys never exposed to client (verify network tab)
- [ ] JUDGE_MODEL switch works (Haiku to Sonnet) with no other code change
- [ ] All Worker unit tests pass
- [ ] Integration test passes (mocked APIs)

---

## Technical approach

### Architecture decisions

**Two-Stage Pipeline:**
- Choice: Perplexity Sonar (retrieve) + Claude (judge/curate) in sequence
- Rationale: Each tool to its strength — Sonar for retrieval, Claude for editorial judgement. Sequential keeps it simple (2 calls, not more).
- Alternatives considered: Single model doing both (Sonar not good at judgement); parallel calls (complicates error handling)

**Server-Side Only:**
- Choice: All Perplexity/Claude calls happen in Worker; browser only sees final JSON
- Rationale: API keys never exposed to client; single origin means no CORS needed for `/api/commentary`
- Alternatives considered: Client-side Perplexity (exposes key); client-side Claude (exposes key, impossible)

**Model Choice:**
- Choice: Default to `claude-haiku-4-5` with constant for easy switching
- Rationale: Haiku is fast and cheap for this bounded task (read ~9 snippets, label, pick 1-3, write <=8-word captions). Sonnet available as upgrade for sharper wit.

### Technology choices

**Cloudflare Workers:**
- Purpose: API routing and external API integration
- Documentation: https://developers.cloudflare.com/workers/

**Perplexity Sonar API:**
- Purpose: Retrieve representative pool of recent articles
- Endpoint: `https://api.perplexity.ai/chat/completions`
- Model: `sonar-pro` (richer citation metadata)
- Parameters: `search_recency_filter: "week"`

**Anthropic Messages API:**
- Purpose: Judge and curate article pool
- Endpoint: `https://api.anthropic.com/v1/messages`
- Model: `claude-haiku-4-5` (default), switchable to `claude-sonnet-4-6`
- Response format: Structured JSON with selected articles, verdicts, captions

**Testing Framework:**
- Purpose: Unit and integration tests for Worker logic
- Choice: Vitest (fast, ESM-native, good for Workers)
- Alternatives considered: Jest (works but heavier)

### Key files and components

**New files to create:**
```
is-burnham-pm-yet/
├── src/
│   ├── worker.js            # Full API handler with Stage 1 + Stage 2
│   ├── worker.test.js       # Unit tests for Worker logic
│   └── test/
│       └── integration.test.js # Integration tests for /api/commentary
├── package.json            # Add vitest dependency
└── vitest.config.js         # Vitest configuration
```

**Files to modify:**
```
- public/index.html - Connect to /api/commentary; implement data rendering
- wrangler.toml - Ensure Worker script handles /api/commentary
```

---

## Testing strategy

### Unit tests

**Coverage targets:**
- Lines: 90%+
- Functions: 90%+
- Branches: 85%+

**Key test files:**
- `worker.test.js` - Test Stage 1 retrieval, Stage 2 judging, error handling, response contract

**Test scenarios:**
- [ ] Stage 1 returns valid pool, Stage 2 curates correctly
- [ ] Stage 1 returns empty pool, Stage 2 returns empty
- [ ] Stage 1 fails, Stage 2 not called, error handled
- [ ] Stage 2 fails after Stage 1 success, single Noted card returned
- [ ] JSON parsing fails, defaults returned
- [ ] JUDGE_MODEL constant switch works
- [ ] Response contract matches specification

### Integration tests

**Test scenarios:**
- [ ] `/api/commentary` returns 200 with valid JSON
- [ ] Response includes probability_pct, one_line, articles array
- [ ] Articles have correct structure (title, url, outlet, date, verdict, caption)
- [ ] Verdicts are valid (probing, fixating, noting)

### Manual testing checklist

- [ ] `/api/commentary` returns data when Worker is running
- [ ] Client renders probability and cards from API response
- [ ] Cards show correct verdict styling (amber/green/muted)
- [ ] No API keys visible in network tab
- [ ] Error states handled gracefully (test by killing Worker)
- [ ] `?force=yes` still works with API active

---

## Pre-commit checklist

Before creating PR, verify:

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Coverage meets targets
- [ ] No console.log or debug code left in
- [ ] No secrets or sensitive data in code
- [ ] No mocked API keys committed
- [ ] All manual tests pass

---

## PR workflow

### Branch naming
```
feature/phase-2-commentary-api
```

### PR title
```
Phase 2: Commentary API
```

### Review requirements
- Use `/review-pr` — this phase involves API integration and external service calls, so team review is appropriate

### Deployment Notes
- Requires Worker secrets to be set:
  ```bash
  npx wrangler secret put PERPLEXITY_API_KEY
  npx wrangler secret put ANTHROPIC_API_KEY
  ```
- For local dev, use `.dev.vars` (already created with placeholders)

---

## Edge cases and considerations

### Known risks
- **Perplexity API changes:** Sonar API format or availability could change. Mitigation: structured JSON parsing with fallback to defaults.
- **Claude API changes:** Messages API format could change. Mitigation: same as above.
- **Rate limiting:** Both APIs have rate limits. Mitigation: caching in Phase 3; for now, graceful degradation.
- **Model latency:** Haiku/Sonnet could be slow. Mitigation: timeouts with graceful fallback.

### Performance considerations
- Two sequential external API calls (Perplexity + Claude)
- No caching in this phase (added in Phase 3)
- Consider adding timeouts to prevent hanging

### Security considerations
- API keys stored as Worker secrets (never in code)
- `.dev.vars` is gitignored for local development
- No client-side exposure of keys or internal URLs
- JSON response does not include any sensitive data

### Accessibility considerations
- Verdict styling uses color AND label text (not color-only)
- Cards maintain sufficient contrast for all text sizes

### Future optimisation opportunities
- Full-text judging (fetch article content after curation for more accurate verdicts)
- Real probability from Polymarket/Metaculus (stretch goal)
- Auto-refresh every few minutes

---

## Technical debt introduced

**TD-001: No caching in Phase 2**
- **Location:** `src/worker.js` - commentary pipeline
- **Issue:** Every request to `/api/commentary` makes live Perplexity + Claude calls
- **Why accepted:** Caching is explicitly deferred to Phase 3 per our phasing
- **Risk:** Medium (cost could spike with traffic)
- **Future fix:** Add KV caching with Cron trigger in Phase 3

---

## Related documentation

- [project-outline.md](./ORIGINAL_IDEA/project-outline.md) - Master specification
- [idea-spec-andy-burnham-yet.md](./ORIGINAL_IDEA/idea-spec-andy-burnham-yet.md) - Original detailed spec (see §4 for pipeline details)
- [design-andy-burnham-yet-handoff.html](./ORIGINAL_IDEA/design-andy-burnham-yet-handoff.html) - Visual source of truth
- [01-foundation.md](./01-foundation.md) - Previous phase

---

## Notes

This phase transforms the static page into a live, data-driven experience. The commentary panel will now show real articles curated by Claude from Perplexity's pool. The reference implementation in the spec (§4) provides excellent guidance for the Worker code structure.

Key principle: **Never let the binary answer depend on the commentary route.** The Wikidata hero must always work standalone.
