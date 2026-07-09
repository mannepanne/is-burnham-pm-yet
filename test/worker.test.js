// ABOUT: Worker unit tests — judge/curate, refresh auth, cache read, text strip.
// ABOUT: Covers the security-relevant verdict allowlist and the auth gate.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, {
  judgeAndCurate,
  handleRefresh,
  handleCommentary,
  extractText,
  refineWithFullText,
  normalizeUrl,
  computeJudgePool,
  appendToArchive,
  paginate,
  handleArchive,
} from '../src/worker.js';

// Build a fetch stub that returns a single JSON body.
function mockFetchJson(body) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

// Shape a Claude /v1/messages response carrying a text block.
function claudeText(text) {
  return { content: [{ type: 'text', text }] };
}

// Reset spies and any globals (notably `fetch`) between tests. A raw
// `global.fetch = ...` assignment is NOT undone by restoreAllMocks(), so we
// install fetch via vi.stubGlobal and clear it with unstubAllGlobals() — this
// keeps tests order-independent as the suite grows.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('judgeAndCurate', () => {
  const pool = [
    { title: 'Analysis: transition timeline', outlet: 'BBC', snippet: 's0' },
    { title: 'Secret meeting drama', outlet: 'Sky', snippet: 's1' },
  ];

  it('maps a valid selection straight through', async () => {
    vi.stubGlobal('fetch', mockFetchJson(
      claudeText(JSON.stringify({ selected: [{ i: 1, verdict: 'fixating', caption: 'sharp' }] })),
    ));

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result).toEqual([{ i: 1, verdict: 'fixating', caption: 'sharp' }]);
  });

  it('coerces an out-of-allowlist verdict to "noting"', async () => {
    vi.stubGlobal('fetch', mockFetchJson(
      claudeText(JSON.stringify({ selected: [{ i: 0, verdict: 'banana', caption: 'x' }] })),
    ));

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result[0].verdict).toBe('noting');
  });

  it('falls back to a single neutral card when the judge reply is unparseable', async () => {
    vi.stubGlobal('fetch', mockFetchJson(claudeText('not json at all')));

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe('noting');
  });
});

describe('handleRefresh', () => {
  const refreshReq = (key) =>
    new Request('https://example.org/api/refresh', key ? { headers: { 'x-refresh-key': key } } : undefined);

  it('rejects a request with the wrong key (401)', async () => {
    const res = await handleRefresh({ REFRESH_SECRET: 'secret' }, refreshReq('wrong'));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no key header (401)', async () => {
    const res = await handleRefresh({ REFRESH_SECRET: 'secret' }, refreshReq());
    expect(res.status).toBe(401);
  });

  it('does not accept the secret in the query string', async () => {
    // The old query-string mechanism must no longer authenticate.
    const req = new Request('https://example.org/api/refresh?key=secret');
    const res = await handleRefresh({ REFRESH_SECRET: 'secret' }, req);
    expect(res.status).toBe(401);
  });

  it('runs the pipeline when the header key matches', async () => {
    // Perplexity returns an empty pool, so no Claude call is made.
    vi.stubGlobal('fetch', mockFetchJson({
      choices: [{ message: { content: JSON.stringify({ probability_pct: 10, one_line: 'x', pool: [] }) } }],
    }));

    const res = await handleRefresh(
      { REFRESH_SECRET: 'secret', PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' },
      refreshReq('secret'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.articles).toEqual([]);
    expect(body.probability_pct).toBe(10);
  });
});

describe('handleCommentary', () => {
  it('serves a cached result without running the pipeline', async () => {
    const cached = { probability_pct: 42, one_line: 'steady', articles: [{ title: 't' }] };
    const env = {
      COMMENTARY_CACHE: { get: async () => cached, put: async () => {} },
    };
    const fetchSpy = vi.fn(); // must not be called
    vi.stubGlobal('fetch', fetchSpy);

    const res = await handleCommentary(env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.articles).toHaveLength(1);
    expect(body.probability_pct).toBe(42);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs the pipeline on a cache miss and negative-caches an empty result (S-4)', async () => {
    // get() returns null → miss. Perplexity returns an empty pool, so the
    // pipeline short-circuits before the Claude/refinement code and produces
    // no articles — exercising the miss branch and the short negative-cache TTL.
    const put = vi.fn(async () => {});
    const env = {
      COMMENTARY_CACHE: { get: async () => null, put },
      PERPLEXITY_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    };
    const fetchSpy = mockFetchJson({
      choices: [{ message: { content: JSON.stringify({ probability_pct: 5, one_line: 'x', pool: [] }) } }],
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await handleCommentary(env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.articles).toEqual([]);
    expect(fetchSpy).toHaveBeenCalled(); // pipeline ran on the miss
    // Empty result is cached, but only briefly so the miss doesn't re-run the
    // paid pipeline on every request during an empty window.
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][2].expirationTtl).toBe(120);
    expect(put.mock.calls[0][2].expirationTtl).toBeLessThan(6 * 60 * 60);
  });
});

describe('fetch routing', () => {
  // Mock the static-assets binding.
  const assetsEnv = (assetResponse) => ({
    ASSETS: { fetch: vi.fn(async () => assetResponse) },
  });

  it('serves a static asset with the security headers attached', async () => {
    const env = assetsEnv(new Response('<html></html>', { status: 200 }));
    const res = await worker.fetch(new Request('https://example.org/'), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self' https://static.cloudflareinsights.com");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('passes the asset status through (e.g. 404) with headers still attached', async () => {
    const env = assetsEnv(new Response('not found', { status: 404 }));
    const res = await worker.fetch(new Request('https://example.org/nope'), env);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('routes /api/commentary to the cache-served handler', async () => {
    const env = {
      COMMENTARY_CACHE: {
        get: async () => ({ probability_pct: 1, one_line: '', articles: [{ title: 't' }] }),
        put: async () => {},
      },
    };
    const res = await worker.fetch(new Request('https://example.org/api/commentary'), env);
    expect(res.status).toBe(200);
  });

  it('routes /api/refresh through the auth gate', async () => {
    const res = await worker.fetch(
      new Request('https://example.org/api/refresh'),
      { REFRESH_SECRET: 'secret' },
    );
    expect(res.status).toBe(401);
  });
});

describe('refineWithFullText', () => {
  const articles = [
    { title: 'A piece', url: 'https://news.example/a', outlet: 'BBC', verdict: 'fixating', caption: 'orig caption' },
  ];

  // Route article fetches vs the Anthropic call. Article fetches need a
  // .text() body long enough to clear the 50-char floor; the Anthropic call
  // needs a .json() body.
  function routeFetch({ refinementBody }) {
    return vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        return { ok: true, json: async () => claudeText(refinementBody) };
      }
      return {
        ok: true,
        headers: { get: () => null }, // no content-length → no size cap
        text: async () => `<p>${'word '.repeat(60)}</p>`,
      };
    });
  }

  it('applies a refined verdict and caption on a valid response', async () => {
    const fetchSpy = routeFetch({
      refinementBody: JSON.stringify({ refined: [{ index: 0, verdict: 'probing', caption: 'refined caption' }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await refineWithFullText(articles, { ANTHROPIC_API_KEY: 'k' });
    expect(result[0].verdict).toBe('probing');
    expect(result[0].caption).toBe('refined caption');

    // Guard the Q-1 fix: the Anthropic request must carry a non-empty
    // `messages` array (an empty array is a 400, which is the original bug).
    const anthropicCall = fetchSpy.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('api.anthropic.com'),
    );
    expect(anthropicCall).toBeDefined();
    const body = JSON.parse(anthropicCall[1].body);
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content.length).toBeGreaterThan(0);
  });

  it('keeps the original verdict when the refinement reply is garbled', async () => {
    vi.stubGlobal('fetch', routeFetch({ refinementBody: 'not json' }));

    const result = await refineWithFullText(articles, { ANTHROPIC_API_KEY: 'k' });
    expect(result[0].verdict).toBe('fixating');
    expect(result[0].caption).toBe('orig caption');
  });

  it('returns the originals when no article text could be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));

    const result = await refineWithFullText(articles, { ANTHROPIC_API_KEY: 'k' });
    expect(result).toEqual(articles);
  });

  it('never fetches non-public article URLs (S-5 SSRF guard)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const unsafe = [
      { title: 'x', url: 'http://news.example/a', outlet: 'o', verdict: 'noting', caption: 'c' }, // not https
      { title: 'y', url: 'https://127.0.0.1/admin', outlet: 'o', verdict: 'noting', caption: 'c' }, // loopback
      { title: 'z', url: 'https://169.254.169.254/latest/meta-data', outlet: 'o', verdict: 'noting', caption: 'c' }, // metadata
    ];

    const result = await refineWithFullText(unsafe, { ANTHROPIC_API_KEY: 'k' });
    // None of the unsafe URLs is fetched, so there is no text to refine and the
    // originals are returned unchanged.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual(unsafe);
  });
});

describe('extractText', () => {
  it('strips scripts and tags via the regex fallback (no DOMParser)', () => {
    const text = extractText('<p>Hello <script>evil()</script> world</p>');
    expect(text).not.toContain('evil');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
  });
});

describe('normalizeUrl', () => {
  it('lowercases the host and drops query, hash and trailing slash', () => {
    expect(normalizeUrl('https://News.Example.com/story/')).toBe('news.example.com/story');
    expect(normalizeUrl('https://news.example.com/story?utm=x#frag')).toBe('news.example.com/story');
  });

  it('treats http and https of the same article as one key', () => {
    expect(normalizeUrl('http://news.example.com/a')).toBe(normalizeUrl('https://news.example.com/a'));
  });

  it('collapses a bare host with/without trailing slash', () => {
    expect(normalizeUrl('https://news.example.com/')).toBe('news.example.com');
    expect(normalizeUrl('https://news.example.com')).toBe('news.example.com');
  });

  it('returns null (never throws) for junk or absent input', () => {
    expect(normalizeUrl(undefined)).toBeNull();
    expect(normalizeUrl(null)).toBeNull();
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl(42)).toBeNull();
  });
});

describe('computeJudgePool', () => {
  const mk = (n) => ({ title: `t${n}`, url: `https://news.example/${n}`, outlet: 'o', snippet: 's' });
  const pool = [mk(0), mk(1), mk(2), mk(3)];

  it('returns fresh-only when at least PANEL_SIZE unseen URL-bearing articles exist', () => {
    const seen = new Set([normalizeUrl(pool[0].url)]);
    const result = computeJudgePool(pool, seen, 3, 9);
    // pool[0] is seen; the three fresh ones remain, and only those.
    expect(result).toEqual([pool[1], pool[2], pool[3]]);
  });

  it('tops up with seen items (for context) when fewer than PANEL_SIZE are fresh', () => {
    const seen = new Set([
      normalizeUrl(pool[0].url), normalizeUrl(pool[1].url), normalizeUrl(pool[2].url),
    ]);
    const result = computeJudgePool(pool, seen, 3, 9);
    // Only pool[3] is fresh; it must lead, then the pool is topped up so the judge
    // is never starved and the panel is never empty.
    expect(result[0]).toBe(pool[3]);
    expect(result).toHaveLength(pool.length);
  });

  it('never returns empty for a non-empty pool even when everything is seen', () => {
    const seen = new Set(pool.map((a) => normalizeUrl(a.url)));
    const result = computeJudgePool(pool, seen, 3, 9);
    expect(result.length).toBeGreaterThan(0);
  });

  it('treats URL-less articles as seen — they can never drive rotation', () => {
    const withNull = [{ title: 'x', outlet: 'o', snippet: 's' }, mk(0)];
    const seen = new Set(); // nothing seen
    const result = computeJudgePool(withNull, seen, 3, 9);
    // Only mk(0) is URL-bearing/fresh, so it leads; the URL-less item is topped-up context.
    expect(result[0]).toBe(withNull[1]);
  });

  it('defaults seen to empty and returns all fresh when no set is passed', () => {
    const result = computeJudgePool(pool, undefined, 3, 9);
    expect(result).toEqual(pool);
  });
});

describe('appendToArchive', () => {
  const shown = [
    { title: 'A', url: 'https://news.example/a', outlet: 'BBC', date: '3 Jul', verdict: 'probing', caption: 'c1' },
    { title: 'B', url: 'https://news.example/b', outlet: 'Sky', date: '3 Jul', verdict: 'fixating', caption: 'c2' },
  ];

  it('prepends new articles newest-first and stamps shown_at', () => {
    const existing = [{ title: 'old', url: 'https://news.example/old', shown_at: '2026-07-01T00:00:00.000Z' }];
    const result = appendToArchive(existing, shown, 1000);
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('A');
    expect(result[1].title).toBe('B');
    expect(result[2].title).toBe('old');
    expect(result[0].shown_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
  });

  it('dedups by normalised URL, keeping the existing entry unchanged', () => {
    const existing = [
      { title: 'A original', url: 'https://news.example/a', verdict: 'noting', caption: 'first', shown_at: '2026-07-01T00:00:00.000Z' },
    ];
    // Same URL reappears with a different title/verdict; must not be re-added or mutated.
    const result = appendToArchive(existing, [shown[0]], 1000);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('A original');
    expect(result[0].caption).toBe('first');
  });

  it('drops shown articles that have no URL (no dedup key)', () => {
    const result = appendToArchive([], [{ title: 'no url', outlet: 'o', verdict: 'noting', caption: 'c' }], 1000);
    expect(result).toEqual([]);
  });

  it('treats a null/undefined existing archive as empty', () => {
    expect(appendToArchive(null, shown, 1000)).toHaveLength(2);
    expect(appendToArchive(undefined, [], 1000)).toEqual([]);
  });

  it('treats a null/undefined shown list as nothing to add', () => {
    const existing = [{ title: 'old', url: 'https://news.example/old' }];
    expect(appendToArchive(existing, undefined, 1000)).toEqual(existing);
    expect(appendToArchive(existing, null, 1000)).toEqual(existing);
  });

  it('caps at MAX_ARCHIVE, keeping the newest', () => {
    const existing = Array.from({ length: 1000 }, (_, i) => ({
      title: `e${i}`, url: `https://news.example/e${i}`, shown_at: '2026-07-01T00:00:00.000Z',
    }));
    const result = appendToArchive(existing, shown, 1000);
    expect(result).toHaveLength(1000);
    expect(result[0].title).toBe('A'); // newest kept at the front
    expect(result.some((a) => a.title === 'e999')).toBe(false); // oldest trimmed
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ n: i }));

  it('returns the requested page, newest-first order preserved, 20 per page', () => {
    const r = paginate(items, 2, 20);
    expect(r.items[0]).toEqual({ n: 20 });
    expect(r.items).toHaveLength(20);
    expect(r.page).toBe(2);
    expect(r.total).toBe(45);
    expect(r.totalPages).toBe(3);
    expect(r.pageSize).toBe(20);
  });

  it('clamps page 0, negatives and non-numeric input to page 1', () => {
    expect(paginate(items, 0, 20).page).toBe(1);
    expect(paginate(items, -5, 20).page).toBe(1);
    expect(paginate(items, 'banana', 20).page).toBe(1);
    expect(paginate(items, undefined, 20).page).toBe(1);
  });

  it('clamps a beyond-last page to the last page', () => {
    const r = paginate(items, 99, 20);
    expect(r.page).toBe(3);
    expect(r.items).toHaveLength(5);
  });

  it('returns an empty, coherent shape for an empty archive', () => {
    expect(paginate([], 1, 20)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0, items: [] });
    expect(paginate(null, 3, 20)).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0, items: [] });
  });
});

describe('handleArchive', () => {
  const archiveReq = (qs = '') => new Request(`https://example.org/api/archive${qs}`);

  it('serves a page from the KV archive, newest-first', async () => {
    const stored = Array.from({ length: 25 }, (_, i) => ({ title: `a${i}`, url: `https://news.example/${i}` }));
    const env = { COMMENTARY_CACHE: { get: async () => stored } };
    const res = await handleArchive(env, archiveReq('?page=2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.total).toBe(25);
    expect(body.totalPages).toBe(2);
    expect(body.items).toHaveLength(5);
  });

  it('returns an empty archive when KV has nothing yet', async () => {
    const env = { COMMENTARY_CACHE: { get: async () => null } };
    const res = await handleArchive(env, archiveReq());
    const body = await res.json();
    expect(body).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0, items: [] });
  });

  it('returns an empty archive when there is no KV binding (local dev)', async () => {
    const res = await handleArchive({}, archiveReq('?page=1'));
    const body = await res.json();
    expect(body.total).toBe(0);
  });

  it('degrades to a 200 empty archive if the KV read throws', async () => {
    const env = { COMMENTARY_CACHE: { get: async () => { throw new Error('kv down'); } } };
    const res = await handleArchive(env, archiveReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it('is routed by the top-level fetch handler', async () => {
    const env = { COMMENTARY_CACHE: { get: async () => [] } };
    const res = await worker.fetch(archiveReq('?page=1'), env);
    expect(res.status).toBe(200);
  });
});

describe('runPipeline rotation via scheduled', () => {
  // A Perplexity pool of 4 URL-bearing articles; the judge picks index 0 of
  // whatever pool it is handed. We assert the archive is written and that the
  // `seen` set steers selection away from already-archived URLs.
  const poolPayload = (n) => ({
    choices: [{ message: { content: JSON.stringify({
      probability_pct: 20, one_line: 'x',
      pool: Array.from({ length: n }, (_, i) => ({
        title: `t${i}`, url: `https://news.example/${i}`, outlet: 'o', date: '3 Jul', snippet: `s${i}`,
      })),
    }) } }],
  });

  function routeFetch(judgeIndex) {
    return vi.fn(async (url) => {
      if (typeof url === 'string' && url.includes('api.anthropic.com')) {
        return { ok: true, json: async () => claudeText(JSON.stringify({ selected: [{ i: judgeIndex, verdict: 'noting', caption: 'c' }] })) };
      }
      if (typeof url === 'string' && url.includes('perplexity')) {
        return { ok: true, json: async () => poolPayload(4) };
      }
      // Article full-text fetch (refine stage): fail so verdicts pass through.
      return { ok: false };
    });
  }

  it('writes shown articles to the archive from the scheduled (cron) path', async () => {
    const store = new Map();
    const env = {
      PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k',
      COMMENTARY_CACHE: {
        get: async (key, type) => (store.has(key) ? store.get(key) : null),
        put: async (key, val) => { store.set(key, JSON.parse(val)); },
      },
    };
    vi.stubGlobal('fetch', routeFetch(0));

    await worker.scheduled({}, env, { waitUntil() {} });

    const archive = store.get('archive:v1');
    expect(Array.isArray(archive)).toBe(true);
    expect(archive.length).toBe(1);
    expect(archive[0].url).toBe('https://news.example/0');
    expect(archive[0].shown_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The front-page cache is written too.
    expect(store.get('commentary:v1').articles).toHaveLength(1);
  });

  it('runs without a KV binding (local dev) and writes nothing', async () => {
    const env = { PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }; // no COMMENTARY_CACHE
    vi.stubGlobal('fetch', routeFetch(0));
    // Must not throw despite there being no archive to read or write.
    await expect(worker.scheduled({}, env, { waitUntil() {} })).resolves.toBeUndefined();
  });

  it('does not re-append an article already in the archive', async () => {
    const store = new Map();
    store.set('archive:v1', [{ title: 'seen', url: 'https://news.example/0', shown_at: '2026-07-01T00:00:00.000Z' }]);
    const env = {
      PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k',
      COMMENTARY_CACHE: {
        get: async (key) => (store.has(key) ? store.get(key) : null),
        put: async (key, val) => { store.set(key, JSON.parse(val)); },
      },
    };
    // Judge picks index 0 of judgePool. Since /0 is already seen, computeJudgePool
    // drops it from the fresh set, so judgePool[0] is a fresh article — the panel rotates.
    vi.stubGlobal('fetch', routeFetch(0));

    await worker.scheduled({}, env, { waitUntil() {} });

    const archive = store.get('archive:v1');
    // The seen article is still present exactly once; a new (fresh) one was prepended.
    expect(archive.filter((a) => a.url === 'https://news.example/0')).toHaveLength(1);
    expect(archive.length).toBe(2);
    expect(archive[0].url).not.toBe('https://news.example/0'); // fresh article leads
  });
});
