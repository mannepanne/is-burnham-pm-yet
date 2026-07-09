// ABOUT: Front-end script for the press archive sub-page.
// ABOUT: Fetches a paginated slice of /api/archive and renders it, newest-first.
import { createArticleCard } from './app.js';

const PAGE_SIZE = 20;
const FETCH_TIMEOUT = 15000; // 15s — the archive is a plain KV read, so this is generous

// Read the requested page from the query string; clamp to a sane minimum. The
// server clamps authoritatively and echoes back the effective page, which is what
// the pagination links are built from.
function requestedPage() {
  const raw = new URLSearchParams(window.location.search).get('page');
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
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

async function fetchArchive(page) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(`/api/archive?page=${page}`, { signal: controller.signal });
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

  const link = (label, targetPage, enabled) => {
    const el = document.createElement('a');
    el.className = 'page-link' + (enabled ? '' : ' disabled');
    el.textContent = label;
    if (enabled) {
      el.href = `/archive?page=${targetPage}`;
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

async function init() {
  const page = requestedPage();
  const data = await fetchArchive(page);

  if (!data) {
    setStatus('The archive is briefly unavailable. Please try again shortly.');
    renderPagination(null);
    return;
  }

  updateCount(data.total);

  if (!data.items || data.items.length === 0) {
    setStatus('Nothing filed yet — check back after the next edition.');
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

export { formatFiled, requestedPage, init, renderList, renderPagination };
