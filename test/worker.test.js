// ABOUT: Worker unit tests — judge/curate, refresh auth, cache read, text strip.
// ABOUT: Covers the security-relevant verdict allowlist and the auth gate.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, {
  judgeAndCurate,
  handleRefresh,
  handleCommentary,
  extractText,
} from '../src/worker.js';

// Build a fetch stub that returns a single JSON body.
function mockFetchJson(body) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

// Shape a Claude /v1/messages response carrying a text block.
function claudeText(text) {
  return { content: [{ type: 'text', text }] };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('judgeAndCurate', () => {
  const pool = [
    { title: 'Analysis: transition timeline', outlet: 'BBC', snippet: 's0' },
    { title: 'Secret meeting drama', outlet: 'Sky', snippet: 's1' },
  ];

  it('maps a valid selection straight through', async () => {
    global.fetch = mockFetchJson(
      claudeText(JSON.stringify({ selected: [{ i: 1, verdict: 'fixating', caption: 'sharp' }] })),
    );

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result).toEqual([{ i: 1, verdict: 'fixating', caption: 'sharp' }]);
  });

  it('coerces an out-of-allowlist verdict to "noting"', async () => {
    global.fetch = mockFetchJson(
      claudeText(JSON.stringify({ selected: [{ i: 0, verdict: 'banana', caption: 'x' }] })),
    );

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result[0].verdict).toBe('noting');
  });

  it('falls back to a single neutral card when the judge reply is unparseable', async () => {
    global.fetch = mockFetchJson(claudeText('not json at all'));

    const result = await judgeAndCurate({ ANTHROPIC_API_KEY: 'k' }, pool);
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe('noting');
  });
});

describe('handleRefresh', () => {
  it('rejects a request with the wrong key (401)', async () => {
    const url = new URL('https://example.org/api/refresh?key=wrong');
    const res = await handleRefresh({ REFRESH_SECRET: 'secret' }, url);
    expect(res.status).toBe(401);
  });

  it('rejects a request with no key (401)', async () => {
    const url = new URL('https://example.org/api/refresh');
    const res = await handleRefresh({ REFRESH_SECRET: 'secret' }, url);
    expect(res.status).toBe(401);
  });

  it('runs the pipeline when the key matches', async () => {
    // Perplexity returns an empty pool, so no Claude call is made.
    global.fetch = mockFetchJson({
      choices: [{ message: { content: JSON.stringify({ probability_pct: 10, one_line: 'x', pool: [] }) } }],
    });

    const url = new URL('https://example.org/api/refresh?key=secret');
    const res = await handleRefresh(
      { REFRESH_SECRET: 'secret', PERPLEXITY_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' },
      url,
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
    global.fetch = vi.fn(); // must not be called

    const res = await handleCommentary(env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.articles).toHaveLength(1);
    expect(body.probability_pct).toBe(42);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('fetch routing', () => {
  it('returns 404 for an unknown path', async () => {
    const res = await worker.fetch(new Request('https://example.org/nope'), {});
    expect(res.status).toBe(404);
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

describe('extractText', () => {
  it('strips scripts and tags via the regex fallback (no DOMParser)', () => {
    const text = extractText('<p>Hello <script>evil()</script> world</p>');
    expect(text).not.toContain('evil');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
  });
});
