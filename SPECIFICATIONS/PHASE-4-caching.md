# Phase 4: Caching - Cron Trigger Implementation

> **Status:** Ready for implementation  
> **Priority:** High  
> **Depends on:** Phase 1, 2, 3  
> **Estimated effort:** 0.5-1 session

---

## Overview

**Goal:** Implement traffic-independent caching using Cloudflare Workers KV and Cron Triggers to ensure the commentary pipeline runs on a schedule rather than per-request, making costs predictable and preventing API stampedes.

This phase adds:
1. Workers KV namespace for storing cached commentary
2. Cron trigger to rebuild cache every 6 hours
3. Read-through cache in the fetch handler
4. Lazy build-on-miss fallback for cold starts

---

## Acceptance Criteria

By the end of this phase:

1. ✅ KV namespace `COMMENTARY_CACHE` created and configured
2. ✅ Cron trigger configured to run every 6 hours
3. ✅ `/api/commentary` reads from KV cache when available
4. ✅ Cache is rebuilt on cron schedule (not on every request)
5. ✅ Cache TTL is 6 hours, matching cron interval
6. ✅ Lazy build-on-miss works for cold starts (first request after deploy)
7. ✅ Only real results are cached (not empty/fallback responses)
8. ✅ Cache key includes version for easy invalidation
9. ✅ APIs are called exactly on cron cadence, not per-request
10. ✅ Traffic spikes don't trigger duplicate API calls

---

## Implementation Details

### Step 1: Create KV Namespace

```bash
# Create the namespace
npx wrangler kv namespace create COMMENTARY_CACHE

# This will output something like:
# ID: abcdef12-3456-7890-abcd-ef1234567890
# Copy the ID for wrangler.toml
```

### Step 2: Update wrangler.toml

```toml
name = "andy-burnham-yet"
main = "src/worker.js"
compatibility_date = "2026-06-23"

[assets]
directory = "./public"

# KV namespace for caching
[[kv_namespaces]]
binding = "COMMENTARY_CACHE"
id = "abcdef12-3456-7890-abcd-ef1234567890"  # Replace with actual ID

# Cron trigger for cache rebuild
[triggers]
crons = ["0 */6 * * *"]  # Every 6 hours: 00:00, 06:00, 12:00, 18:00 UTC
```

### Step 3: Update Worker Code

```javascript
// src/worker.js

const CACHE_KEY = 'commentary:v1';
const TTL_SECONDS = 6 * 60 * 60; // 6 hours

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    if (url.pathname === '/api/commentary') {
      return handleCommentary(req, env);
    }
    
    return new Response('Not found', { status: 404 });
  },
  
  // Cron trigger handler
  async scheduled(event, env, ctx) {
    try {
      const result = await runPipeline(env);
      
      if (result.articles?.length) {
        await env.COMMENTARY_CACHE.put(
          CACHE_KEY,
          JSON.stringify(result),
          { expirationTtl: TTL_SECONDS }
        );
        console.log('Cache rebuilt successfully');
      } else {
        console.log('Cache rebuild skipped: no articles to cache');
      }
    } catch (e) {
      console.error('Scheduled cache rebuild failed:', e);
    }
  }
};

async function handleCommentary(req, env) {
  // Try to serve from cache first
  try {
    const cached = await env.COMMENTARY_CACHE.get(CACHE_KEY, 'json');
    if (cached) {
      console.log('Cache hit');
      return Response.json(cached);
    }
    console.log('Cache miss');
  } catch (e) {
    console.error('Cache read error:', e);
  }
  
  // Cache miss - run pipeline and cache result
  try {
    const result = await runPipeline(env);
    
    // Only cache real results (not empty fallbacks)
    if (result.articles?.length) {
      // Use ctx.waitUntil for fire-and-forget cache write
      ctx.waitUntil(
        env.COMMENTARY_CACHE.put(
          CACHE_KEY,
          JSON.stringify(result),
          { expirationTtl: TTL_SECONDS }
        )
      );
    }
    
    return Response.json(result);
  } catch (e) {
    console.error('Pipeline error:', e);
    return Response.json({ probability_pct: null, one_line: '', articles: [] });
  }
}

// Extract pipeline into reusable function
async function runPipeline(env) {
  const empty = { probability_pct: null, one_line: '', articles: [] };
  
  try {
    const found = await retrievePool(env);
    const meta = {
      probability_pct: found.probability_pct ?? null,
      one_line: found.one_line ?? ''
    };
    
    if (!found.pool?.length) {
      return { ...empty, ...meta };
    }
    
    const selected = await judgeAndCurate(env, found.pool);
    
    const articles = selected
      .map(s => {
        const a = found.pool[s.i];
        return a && {
          title: a.title,
          url: a.url,
          outlet: a.outlet,
          date: a.date,
          verdict: s.verdict,
          caption: s.caption
        };
      })
      .filter(Boolean)
      .slice(0, PANEL_SIZE);
    
    return { ...meta, articles };
  } catch (e) {
    console.error('Pipeline error in runPipeline:', e);
    return empty;
  }
}
```

---

## Testing Checklist

### KV Tests
- [ ] KV namespace created successfully
- [ ] KV namespace ID configured in wrangler.toml
- [ ] `wrangler dev` can access the KV namespace locally
- [ ] Production Worker can access KV namespace

### Cron Tests
- [ ] Cron trigger configured in wrangler.toml
- [ ] Cron expression `0 */6 * * *` is correct (every 6 hours)
- [ ] Cron trigger works in production (Cloudflare dashboard shows scheduled events)
- [ ] Manual test: temporarily change cron to run in 2 minutes, verify cache is rebuilt

### Cache Behavior Tests
- [ ] First request after deploy → cache miss, pipeline runs, result cached
- [ ] Second request within TTL → cache hit, pipeline doesn't run
- [ ] Request after TTL expires → cache miss, pipeline runs
- [ ] Cache key versioning works (change to `commentary:v2`, verify old cache not used)
- [ ] Empty/fallback results are NOT cached
- [ ] Real results (with articles) ARE cached

### API Call Verification
- [ ] Monitor production Worker logs
- [ ] Verify APIs called only on cron schedule (not per-request)
- [ ] Verify traffic spike doesn't cause duplicate API calls
- [ ] Verify lazy build-on-miss works (first request after deploy before first cron)

---

## Alternative: Lazy Caching Only

If Cron Triggers are problematic, implement lazy read-through caching only:

```javascript
// src/worker.js - Lazy caching only

const CACHE_KEY = 'commentary:v1';
const TTL_SECONDS = 6 * 60 * 60;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    
    if (url.pathname === '/api/commentary') {
      return handleCommentary(req, env);
    }
    
    return new Response('Not found', { status: 404 });
  }
};

async function handleCommentary(req, env) {
  // Try cache
  try {
    const cached = await env.COMMENTARY_CACHE.get(CACHE_KEY, 'json');
    if (cached) {
      return Response.json(cached);
    }
  } catch (e) {
    console.error('Cache read error:', e);
  }
  
  // Cache miss - run pipeline
  const result = await runPipeline(env);
  
  // Cache real results
  if (result.articles?.length) {
    // Use ctx if available, or fire-and-forget
    if (req.ctx) {
      req.ctx.waitUntil(
        env.COMMENTARY_CACHE.put(CACHE_KEY, JSON.stringify(result), {
          expirationTtl: TTL_SECONDS
        })
      );
    } else {
      // Fire-and-forget (not ideal but works)
      env.COMMENTARY_CACHE.put(CACHE_KEY, JSON.stringify(result), {
        expirationTtl: TTL_SECONDS
      });
    }
  }
  
  return Response.json(result);
}
```

**Trade-offs:**
- ✅ Simpler (no cron trigger)
- ✅ Still caches results
- ❌ First visitor after TTL expiry pays the cost
- ❌ Potential stampede if many requests hit at same time after expiry
- ❌ Cost is traffic-dependent (but minimal at this scale)

---

## Cache Invalidation

To manually invalidate cache:

```javascript
// Add an admin endpoint (for development only)
async function handleCommentary(req, env) {
  const url = new URL(req.url);
  
  // Cache bust endpoint (GET /api/commentary?bust=cache)
  if (url.searchParams.get('bust') === 'cache') {
    await env.COMMENTARY_CACHE.delete(CACHE_KEY);
    return Response.json({ status: 'cache busted' });
  }
  
  // Normal handling...
}
```

**Note:** This should be protected in production or removed entirely.

---

## Monitoring

### Cloudflare Dashboard
- Check Worker logs for:
  - Cache hits/misses
  - Pipeline execution times
  - API call frequency
  - Errors

### Metrics to Track
- Cache hit rate
- Pipeline execution count
- API call count (should be ~4 per day with cron)
- Error rate
- Response time

---

## Rollout Plan

1. **Local testing:**
   - Create KV namespace for dev
   - Test with `wrangler dev`
   - Verify cache behavior

2. **Production staging:**
   - Deploy without cron first
   - Verify lazy caching works
   - Monitor for a day

3. **Cron activation:**
   - Add cron trigger to wrangler.toml
   - Deploy
   - Verify cron is running

4. **Monitoring:**
   - Check logs for first few cron runs
   - Verify cache is being set
   - Verify API call count drops to ~4/day

---

## Dependencies for Next Phase

Phase 5 (Testing & Deployment) depends on:
- [ ] KV namespace created and configured
- [ ] Cron trigger configured
- [ ] Cache behavior verified
- [ ] Pipeline still works correctly with caching layer

---

## Notes

- **KV Limits:**
  - Free tier: 1 GB storage, 100k reads/day
  - Our usage: ~4 pipeline runs/day × ~1KB result = ~4KB/day (negligible)
  - TTL minimum: 60 seconds
  - Eventual consistency: a few seconds globally

- **Cron Limits:**
  - Free tier: 1000 events/month (we use ~480)
  - Max frequency: every minute
  - Our schedule: every 6 hours = 4/day = ~120/month (well within limits)

- **Cache Key Versioning:**
  - Increment version (v1 → v2) when:
    - Judge prompt changes
    - Response schema changes
    - Perplexity/Claude model changes
  - This ensures old cache doesn't serve stale data after changes

- **TTL Choice:**
  - 6 hours is good for this use case
  - News moves slowly for this specific question
  - Long enough to amortize API costs
  - Short enough to stay reasonably fresh
