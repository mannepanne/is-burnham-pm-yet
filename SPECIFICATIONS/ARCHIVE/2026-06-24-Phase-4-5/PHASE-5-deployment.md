# Phase 5: Testing, Polish & Deployment

> **Status:** ✅ Completed (2026-06-24)
> **Priority:** High  
> **Depends on:** Phases 1-4  
> **Estimated effort:** 1-2 sessions
> **Actual effort:** ~1 session

---

## Overview

**Goal:** Final testing, polish, and production deployment with GitHub Actions for continuous deployment.

This phase includes:
1. Comprehensive testing of all states and edge cases
2. Final design polish and accessibility checks
3. GitHub repository setup
4. GitHub Actions workflow for auto-deploy
5. Production deployment and verification

---

## Acceptance Criteria

By the end of this phase:

1. ✅ All acceptance criteria from previous phases verified
2. ✅ All six states tested and working:
   - Loading state
   - NOT YET default with live panel
   - YES success (via ?force=yes)
   - Judge fallback (single neutral Noted card)
   - Offline fallback (canned trio)
   - Empty panel behavior verified (canned trio used instead)
3. ✅ Graceful degradation verified at every stage
4. ✅ No API keys exposed in network tab or source code
5. ✅ WCAG AA contrast verified for all text
6. ✅ prefers-reduced-motion respected
7. ✅ Canned fallback trio uses exact examples from handoff with correct dates
8. ✅ Date formats match mockup exactly
9. ✅ Design matches handoff exactly
10. ✅ Site deployed to andy-burnham-yet.workers.dev
11. ✅ GitHub Actions configured for auto-deploy on merge to main

---

## Testing Plan

### Test Matrix

| Test | Method | Expected Result |
|------|--------|-----------------|
| Wikidata real call | Normal page load | Shows "Not yet." |
| Wikidata YES simulation | `?force=yes` | Shows "Yes." with green styling |
| Wikidata failure | Disable network | Shows "Not yet." (fallback) |
| Worker disabled | Stop wrangler dev | Hero still works, panel shows canned trio |
| API call | Check /api/commentary | Returns valid JSON |
| API with mock | USE_MOCK=true | Returns mock data |
| Cache hit | Second request within TTL | Returns cached data, no API call |
| Cache miss | First request after TTL | Runs pipeline, caches result |
| Perplexity failure | Break Stage 1 | Empty articles, probability null |
| Claude failure | Break Stage 2 | Single noting card |
| Outlet diversity | Check articles | No duplicate outlets |
| Verdict integrity | Check articles | Probing appears when earned |
| WCAG contrast | Check small amber text | Meets AA (4.5:1) |
| Reduced motion | Enable pref | No jitter animations |

### Manual Test Procedures

#### 1. Hero Answer Tests
```bash
# Test with real Wikidata (should show Not yet)
curl http://localhost:8787

# Test with forced YES
curl http://localhost:8787?force=yes

# Test with Worker disabled (kill wrangler dev)
# Then reload page → hero should still show, panel shows canned trio
```

#### 2. API Tests
```bash
# Test API endpoint
curl http://localhost:8787/api/commentary

# Test with mock mode
USE_MOCK=true npx wrangler dev
curl http://localhost:8787/api/commentary
```

#### 3. Cache Tests
```bash
# First request (cache miss)
curl http://localhost:8787/api/commentary

# Second request (cache hit)
curl http://localhost:8787/api/commentary

# Wait 6+ hours or bust cache
# Then request again (cache miss)
```

#### 4. Browser Tests
- Open Chrome DevTools
- Check Network tab for:
  - SPARQL request to query.wikidata.org
  - No requests to Perplexity/Anthropic (should go through Worker)
  - No API keys in request headers
- Check Console for errors
- Check Elements for correct HTML structure
- Check Styles for correct colors, fonts, spacing

---

## Polish Items

### Design Polish

1. **Final design review:**
   - [x] Compare every element with design-andy-burnham-yet-handoff.html
   - [x] Verify colors match exactly
   - [x] Verify fonts match exactly
   - [x] Verify spacing (padding, margins) match exactly
   - [x] Verify borders match exactly
   - [x] Verify typography (sizes, weights, line-heights) match exactly

2. **Responsive polish:**
   - [x] Test on mobile viewport (375px)
   - [x] Test on tablet viewport (768px)
   - [x] Test on desktop (1440px)
   - [x] Hero answer legible at all sizes
   - [x] Cards readable at all sizes
   - [x] No horizontal scrolling

3. **Animation polish:**
   - [x] Jitter animation smooth and subtle
   - [x] Animation respects prefers-reduced-motion
   - [x] Loading animations (pulse) work correctly
   - [x] No layout shift during animations

### Accessibility Polish

1. **Color contrast:**
   - [x] All text on paper (#F2EEE4) has 4.5:1 contrast minimum
   - [x] Amber (#DB8E1A) on paper: check and darken if needed
   - [x] Darkened amber (#B07A17 or similar) on paper: verify 4.5:1
   - [x] Green (#2F7D33) on paper: verify 4.5:1
   - [x] Ink (#17130D) on paper: verify 4.5:1
   - [x] White on ink (#17130D): verify 4.5:1
   - [x] Use [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

2. **Semantic HTML:**
   - [x] Proper heading hierarchy (h1, h2, h3)
   - [x] Proper use of semantic elements (header, section, footer, article)
   - [x] ARIA attributes where needed
   - [x] Alt text for any images (if added)

3. **Keyboard navigation:**
   - [x] All interactive elements keyboard-accessible
   - [x] Focus states visible
   - [x] Tab order logical

---

## Deployment Plan

### Step 1: GitHub Repository Setup

```bash
# Create repository (if not already created)
gh repo create is-burnham-pm-yet --public --push

# Or if already created
cd andy-burnham-yet
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:MagnusHultberg/is-burnham-pm-yet.git
git push -u origin main
```

### Step 2: Configure GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    name: Deploy
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm install
      
      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### Step 3: Configure GitHub Secrets

In GitHub repository Settings > Secrets > Actions:
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Worker permissions
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account ID

### Step 4: Production Secrets

```bash
# Set production secrets
npx wrangler secret put PERPLEXITY_API_KEY
# Enter the production Perplexity key

npx wrangler secret put ANTHROPIC_API_KEY
# Enter the production Anthropic key
```

### Step 5: First Manual Deploy

```bash
# Deploy to production
npx wrangler deploy

# This will output the Worker URL:
# https://andy-burnham-yet.<account>.workers.dev
```

### Step 6: Configure Custom Domain (Optional)

If desired, configure a custom domain in Cloudflare dashboard:
- e.g., isburnhampmyet.com
- Or a subdomain like burnham.andy-burnham-yet.com

---

## Post-Deployment Verification

### Production Tests

1. **Basic functionality:**
   - [x] Visit production URL
   - [x] Hero answer shows correctly
   - [x] Page loads without errors
   - [x] All states render correctly

2. **API tests:**
   - [x] Visit `/api/commentary` directly
   - [x] Verify valid JSON response
   - [x] Verify no API keys in response

3. **Cache tests:**
   - [x] First request runs pipeline
   - [x] Second request returns cached data
   - [x] Wait for cron to run (or test with shorter interval)
   - [x] Verify cache is rebuilt

4. **Monitoring:**
   - [x] Check Cloudflare Worker logs
   - [x] Verify no errors in production
   - [x] Monitor API call frequency (should be ~4/day)

---

## Rollback Plan

If deployment fails:

```bash
# Rollback to previous version
git revert HEAD
npx wrangler deploy

# Or deploy a specific commit
git checkout <good-commit>
npx wrangler deploy
```

### Emergency Procedure

If site is broken in production:
1. Check logs: `npx wrangler tail`
2. Check Worker dashboard in Cloudflare
3. If Worker is failing, disable it temporarily
4. Deploy fix
5. Re-enable Worker

---

## Documentation

### Create README.md

```markdown
# Is Andy Burnham the UK Prime Minister yet?

A satirical one-page site that answers a single binary question and contrasts it with the froth of UK political press coverage.

## Development

```bash
# Install dependencies
npm install

# Local development
npx wrangler dev

# Deploy to production
npx wrangler deploy
```

## Configuration

Create `.dev.vars` for local development:
```
PERPLEXITY_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

## Testing

- `?force=yes` - Simulate YES state
- `/api/commentary` - Test API endpoint
- Disable Worker - Test graceful degradation

## Architecture

- Single Cloudflare Worker with static assets
- Wikidata SPARQL (client-side) for hero answer
- Perplexity + Claude (server-side) for commentary
- Workers KV for caching
- Cron trigger for cache rebuild

## License

MIT
```

### Update AGENTS.md

Document any project-specific decisions or overrides in the root AGENTS.md.

---

## Final Checklist

- [x] All phases 1-4 complete and verified
- [x] GitHub repository created (mannepanne/is-burnham-pm-yet)
- [x] GitHub Actions configured
- [x] Production secrets set
- [x] Manual deployment successful
- [x] Production URL accessible (https://andyburnhamyet.hultberg.org/)
- [x] All acceptance criteria met
- [x] README created
- [x] No sensitive data in repository
- [x] All tests passing
- [x] Cloudflare Web Analytics configured

---

## Success!

The site is now live at `https://andy-burnham-yet.<account>.workers.dev` (or custom domain).

The project demonstrates:
- ✅ Single Worker architecture with static assets
- ✅ Client-side Wikidata integration
- ✅ Server-side Perplexity + Claude pipeline
- ✅ Traffic-independent caching with cron
- ✅ Graceful degradation at every level
- ✅ Faithful design implementation
- ✅ Editorial integrity in curation
- ✅ Production-ready deployment

---

## Next Steps (Optional)

1. **Monitor and iterate:**
   - Monitor error rates
   - Monitor API costs
   - Adjust judge model if needed (Haiku vs Sonnet)
   - Adjust caching strategy if needed

2. **Enhancements (future):**
   - Add full-text judging for articles
   - Add more sophisticated probability estimation
   - Add historical archive of past answers
   - Add sharing functionality

3. **Maintenance:**
   - Update canned fallback trio periodically
   - Monitor Wikidata for schema changes
   - Monitor Perplexity/Anthropic API for changes

---

## Completion Summary

**Completed:** 2026-06-24

All acceptance criteria met. Key deliverables:
- Comprehensive testing of all states and edge cases completed
- Final design polish verified against handoff
- Accessibility checks passed (WCAG AA contrast, prefers-reduced-motion)
- GitHub repository created: mannepanne/is-burnham-pm-yet
- GitHub Actions workflow configured for auto-deploy on merge to main
- Production deployment successful to andy-burnham-yet workers
- Custom domain configured: https://andyburnhamyet.hultberg.org/
- Cloudflare Web Analytics added (token: bc680bb039d14c7a885e8cbf226b19fa)
- All production tests passing
- No sensitive data in repository
- Site fully operational and monitored
