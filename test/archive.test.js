// ABOUT: Archive page tests — filing-date formatting and page-param clamping.
// ABOUT: Card XSS-escaping is covered via createArticleCard in render.test.js.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatFiled, requestedPage, init, renderList, renderPagination } from '../public/archive.js';

// Rebuild the archive page's DOM skeleton before each render test so init() and
// the render helpers have the elements they target.
function setupDom() {
  document.body.innerHTML = `
    <span id="archive-count"></span>
    <div id="archive-status"></div>
    <div id="archive-list"></div>
    <nav id="archive-pagination" class="hide"></nav>
  `;
}

describe('formatFiled', () => {
  it('formats an ISO shown_at into an unambiguous filing date with a year', () => {
    // Use midday UTC so the local-date conversion can't slip to an adjacent day.
    expect(formatFiled('2026-07-03T12:00:00.000Z')).toBe('Filed 3 Jul 2026');
  });

  it('returns empty string for missing or unparseable input', () => {
    expect(formatFiled(undefined)).toBe('');
    expect(formatFiled('')).toBe('');
    expect(formatFiled('not a date')).toBe('');
  });
});

describe('requestedPage', () => {
  const setSearch = (search) => {
    // happy-dom allows assigning window.location.search.
    window.history.replaceState({}, '', `/archive.html${search}`);
  };

  afterEach(() => setSearch(''));

  it('reads a positive page from the query string', () => {
    setSearch('?page=3');
    expect(requestedPage()).toBe(3);
  });

  it('falls back to page 1 for absent, zero, negative or junk values', () => {
    setSearch('');
    expect(requestedPage()).toBe(1);
    setSearch('?page=0');
    expect(requestedPage()).toBe(1);
    setSearch('?page=-4');
    expect(requestedPage()).toBe(1);
    setSearch('?page=banana');
    expect(requestedPage()).toBe(1);
  });
});

describe('archive page rendering', () => {
  beforeEach(() => {
    setupDom();
    window.history.replaceState({}, '', '/archive');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/archive');
  });

  // A payload shaped like the live /api/archive response (fields copied from a
  // real two-cron-cycle run), including a would-be-XSS field to prove the reused
  // createArticleCard still neutralises it on this page.
  const livePayload = {
    page: 1, pageSize: 20, total: 2, totalPages: 1,
    items: [
      { title: 'GB News political editor: Burnham’s media-dodging', url: 'https://www.gbnews.com/a', outlet: 'GB News', date: '9 Jul', verdict: 'fixating', caption: 'chasing a non-answer', shown_at: '2026-07-09T07:43:05.663Z' },
      { title: '<script>window.__xss=1</script>', url: 'https://news.example/b', outlet: 'BBC News', date: '9 Jul', verdict: 'probing', caption: 'the transition mechanics', shown_at: '2026-07-09T06:00:00.000Z' },
    ],
  };

  it('renders one card per item, with the filing date, from a live-shaped payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => livePayload })));

    await init();

    const cards = document.querySelectorAll('#archive-list .article-card');
    expect(cards).toHaveLength(2);
    // Reused createArticleCard neutralises the injected markup (no <script> element).
    expect(document.querySelector('#archive-list script')).toBeNull();
    expect(cards[0].querySelector('.article-title').textContent).toContain('GB News political editor');
    // The unambiguous "Filed" date is shown on each card.
    const filed = document.querySelectorAll('#archive-list .archive-filed');
    expect(filed).toHaveLength(2);
    expect(filed[0].textContent).toBe('Filed 9 Jul 2026');
    // Header count reflects the total.
    expect(document.getElementById('archive-count').textContent).toBe('2 clippings filed');
    // Single page → pagination stays hidden.
    expect(document.getElementById('archive-pagination').classList.contains('hide')).toBe(true);
  });

  it('shows the friendly empty state when nothing has been filed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ page: 1, pageSize: 20, total: 0, totalPages: 0, items: [] }),
    })));

    await init();

    expect(document.getElementById('archive-status').textContent).toMatch(/Nothing filed yet/i);
    expect(document.querySelectorAll('#archive-list .article-card')).toHaveLength(0);
  });

  it('shows the error state when the archive API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    await init();

    expect(document.getElementById('archive-status').textContent).toMatch(/briefly unavailable/i);
    expect(document.querySelectorAll('#archive-list .article-card')).toHaveLength(0);
  });

  it('renders Prev/Next controls with correct enabled state on a middle page', () => {
    renderPagination({ page: 2, pageSize: 20, total: 60, totalPages: 3, items: [] });

    const nav = document.getElementById('archive-pagination');
    expect(nav.classList.contains('hide')).toBe(false);
    const links = nav.querySelectorAll('.page-link');
    expect(links).toHaveLength(2);
    // Newer (page 1) and Older (page 3) both reachable from page 2.
    expect(links[0].getAttribute('href')).toBe('/archive?page=1');
    expect(links[1].getAttribute('href')).toBe('/archive?page=3');
    expect(document.getElementById('page-indicator').textContent).toBe('Page 2 of 3');
  });

  it('disables the Newer link on page 1 and the Older link on the last page', () => {
    renderPagination({ page: 1, pageSize: 20, total: 60, totalPages: 3, items: [] });
    let links = document.getElementById('archive-pagination').querySelectorAll('.page-link');
    expect(links[0].classList.contains('disabled')).toBe(true); // no Newer on page 1
    expect(links[1].classList.contains('disabled')).toBe(false);

    renderPagination({ page: 3, pageSize: 20, total: 60, totalPages: 3, items: [] });
    links = document.getElementById('archive-pagination').querySelectorAll('.page-link');
    expect(links[0].classList.contains('disabled')).toBe(false);
    expect(links[1].classList.contains('disabled')).toBe(true); // no Older on last page
  });
});
