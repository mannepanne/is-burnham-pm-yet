// ABOUT: Front-end script for the press archive sub-page.
// ABOUT: Fetches a paginated slice of /api/archive and renders it, newest-first.
import { createArticleCard } from './app.js';

const FETCH_TIMEOUT = 15000; // 15s — the archive is a plain KV read, so this is generous

// Concise labels for the verdict filter — deliberately NOT getVerdictLabel(), which
// returns "Fixating on:" and would read wrong in a chip or the empty-state. Its keys
// double as the client-side allowlist for the verdict query param.
const FILTER_LABELS = { probing: 'Probing', noting: 'Noted', fixating: 'Fixating' };

// Read the requested page from the query string; clamp to a sane minimum. The
// server clamps authoritatively and echoes back the effective page, which is what
// the pagination links are built from.
function requestedPage() {
  const raw = new URLSearchParams(window.location.search).get('page');
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// Read the requested verdict filter from the query string, lower-cased and checked
// against the allowlist; anything else is null (the "All" view). Used ONLY to build
// the outbound fetch URL — the active-chip highlight and empty-state label render
// from the server-echoed data.verdict instead, exactly as pagination renders from
// the server's clamped page.
function requestedVerdict() {
  const raw = new URLSearchParams(window.location.search).get('verdict');
  const v = (raw || '').toLowerCase();
  return FILTER_LABELS[v] ? v : null;
}

// Format an ISO 8601 shown_at into an unambiguous filing date. The per-article
// `date` field is year-less ("21 Jun") and fine on the always-current front page,
// but ambiguous across a months-long archive — so surface shown_at here.
function formatFiled(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return 'Filed ' + d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

async function fetchArchive(page, verdict) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  // Add the verdict param only when set — an empty &verdict= would dirty the "All"
  // URLs and break the pagination-href expectations.
  const params = new URLSearchParams({ page: String(page) });
  if (verdict) params.set('verdict', verdict);
  try {
    const res = await fetch(`/api/archive?${params}`, { signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`Archive API error: ${res.status}`);
    return await res.json();
  } catch (error) {
    clearTimeout(id);
    console.error('Archive fetch failed:', error);
    return null;
  }
}

function setStatus(message) {
  const statusEl = document.getElementById('archive-status');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.classList.toggle('hide', !message);
}

function renderPagination(data) {
  const nav = document.getElementById('archive-pagination');
  if (!nav) return;
  nav.replaceChildren();

  if (!data || data.totalPages <= 1) {
    nav.classList.add('hide');
    return;
  }
  nav.classList.remove('hide');

  const { page, totalPages } = data;
  const verdict = data.verdict;

  const link = (label, targetPage, enabled) => {
    const el = document.createElement('a');
    el.className = 'page-link' + (enabled ? '' : ' disabled');
    el.textContent = label;
    if (enabled) {
      // Preserve the active filter across pages; keep All's URLs param-clean.
      const params = new URLSearchParams({ page: String(targetPage) });
      if (verdict) params.set('verdict', verdict);
      el.href = `/archive?${params}`;
    } else {
      el.setAttribute('aria-disabled', 'true');
    }
    return el;
  };

  const indicator = document.createElement('span');
  indicator.id = 'page-indicator';
  indicator.textContent = `Page ${page} of ${totalPages}`;

  nav.append(
    link('← Newer', page - 1, page > 1),
    indicator,
    link('Older →', page + 1, page < totalPages),
  );
}

// Build an archive card by reusing the front page's createArticleCard (which sets
// every untrusted field via textContent — the tested XSS guard), then append the
// filing date beneath it.
function renderList(items) {
  const listEl = document.getElementById('archive-list');
  listEl.replaceChildren();

  items.forEach((article) => {
    const card = createArticleCard(article);
    const filed = formatFiled(article.shown_at);
    if (filed) {
      const filedEl = document.createElement('div');
      filedEl.className = 'archive-filed';
      filedEl.textContent = filed;
      card.appendChild(filedEl);
    }
    listEl.appendChild(card);
  });
}

function updateCount(total) {
  const countEl = document.getElementById('archive-count');
  if (!countEl) return;
  countEl.textContent = total === 1 ? '1 clipping filed' : `${total} clippings filed`;
}

// Populate the filter chips with whole-archive counts and mark the active one. The
// counts come from data.counts (filter-independent), so the "All" chip shows their
// sum — the true count of verdict-bearing clippings — not the filtered page total.
// The active chip is driven by the server-echoed activeVerdict (null → All).
function renderFilter(counts, activeVerdict) {
  const nav = document.getElementById('archive-filter');
  if (!nav) return;
  const c = counts || { probing: 0, fixating: 0, noting: 0 };
  const total = (c.probing || 0) + (c.fixating || 0) + (c.noting || 0);
  nav.querySelectorAll('.filter-chip').forEach((chip) => {
    const v = chip.dataset.verdict; // '' for the All chip
    const countEl = chip.querySelector('.chip-count');
    if (countEl) countEl.textContent = v === '' ? total : (c[v] ?? 0);
    const isActive = (activeVerdict ?? '') === v;
    chip.classList.toggle('is-active', isActive);
    if (isActive) chip.setAttribute('aria-current', 'page');
    else chip.removeAttribute('aria-current');
  });
}

async function init() {
  const page = requestedPage();
  const verdict = requestedVerdict();
  const data = await fetchArchive(page, verdict);

  if (!data) {
    setStatus('The archive is briefly unavailable. Please try again shortly.');
    renderPagination(null);
    return;
  }

  renderFilter(data.counts, data.verdict);
  updateCount(data.total);

  if (!data.items || data.items.length === 0) {
    setStatus(data.verdict
      ? `Nothing filed under ${FILTER_LABELS[data.verdict]} yet.`
      : 'Nothing filed yet — check back after the next edition.');
    renderPagination(data);
    return;
  }

  setStatus('');
  renderList(data.items);
  renderPagination(data);
}

// Bootstrap only in the browser where the page markup is present; the guard keeps
// the module importable by tests without side effects.
if (typeof document !== 'undefined' && document.getElementById('archive-list')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

export {
  formatFiled, requestedPage, requestedVerdict, init, renderList,
  renderPagination, renderFilter, fetchArchive, FILTER_LABELS,
};
