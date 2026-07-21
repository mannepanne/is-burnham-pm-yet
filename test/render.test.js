// ABOUT: Front-end render tests — the S-1 XSS regression guard.
// ABOUT: Verifies createArticleCard escapes untrusted article fields.
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createArticleCard,
  renderHero,
  formatScoreboardStatus,
} from '../public/app.js';
import { extractText } from '../src/worker.js';

describe('createArticleCard', () => {
  it('renders HTML metacharacters in untrusted fields as inert text (S-1)', () => {
    const card = createArticleCard({
      outlet: '<img src=x onerror="window.__xss=1">',
      date: '<svg onload="window.__xss=1">21 Jun</svg>',
      title: '<script>window.__xss=1</script>',
      verdict: 'fixating',
      caption: '"><b>injected</b>',
    });

    // No markup from any untrusted field is parsed into elements.
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('svg')).toBeNull();
    expect(card.querySelector('b')).toBeNull();

    // The raw strings survive as text content.
    expect(card.querySelector('.article-title').textContent).toBe(
      '<script>window.__xss=1</script>',
    );
    expect(card.querySelector('.article-outlet').textContent).toBe(
      '<img src=x onerror="window.__xss=1">',
    );
    expect(card.querySelector('.article-date').textContent).toBe(
      '<svg onload="window.__xss=1">21 Jun</svg>',
    );
    expect(card.querySelector('.verdict-caption').textContent).toBe(
      '"><b>injected</b>',
    );
  });

  it('renders a normal article with the expected structure and verdict class', () => {
    const card = createArticleCard({
      outlet: 'BBC',
      date: '20 Jun',
      title: 'Burnham confirms he will stand',
      verdict: 'noting',
      caption: 'Routine conference-season profile.',
    });

    expect(card.classList.contains('article-card')).toBe(true);
    expect(card.classList.contains('noting')).toBe(true);
    expect(card.querySelector('.article-title').textContent).toBe(
      'Burnham confirms he will stand',
    );
    expect(card.querySelector('.verdict-label').textContent).toBe('Noted');
  });

  it('applies sensible fallbacks for missing fields', () => {
    const card = createArticleCard({ verdict: 'probing' });

    expect(card.querySelector('.article-outlet').textContent).toBe('Unknown');
    expect(card.querySelector('.article-title').textContent).toBe('Untitled');
    expect(card.querySelector('.article-date').textContent).toBe('');
    expect(card.querySelector('.verdict-caption').textContent).toBe('');
  });

  it('links the headline to a safe http(s) source URL (Q-3a)', () => {
    const card = createArticleCard({
      title: 'A real headline',
      url: 'https://bbc.co.uk/news/article',
      verdict: 'probing',
      caption: 'c',
    });

    const link = card.querySelector('.article-title a');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('https://bbc.co.uk/news/article');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('A real headline');
  });

  it('does not link a non-http(s) URL (e.g. javascript:) — renders plain text', () => {
    const card = createArticleCard({
      title: 'Sketchy',
      url: 'javascript:window.__xss=1',
      verdict: 'fixating',
      caption: 'c',
    });

    expect(card.querySelector('.article-title a')).toBeNull();
    expect(card.querySelector('.article-title').textContent).toBe('Sketchy');
  });
});

// The headline verdict is the site's single most important output. These guard
// the settled-"Yes" default and the ?force=no historical preview against a
// future refactor of the render path.
describe('renderHero — the settled headline answer', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="hero-answer">
        <span id="hero-answer-text">Yes</span><span id="hero-period"></span>
      </div>
      <div id="hero-subtitle"></div>
      <div id="hero-status"></div>
      <span id="pm-count">6</span>
      <span id="footer-status">Scoreboard checking…</span>`;
  });

  it('renders the default settled "Yes" — green period, PM count 7, settled footer', () => {
    renderHero(true, false);

    expect(document.getElementById('hero-answer-text').textContent).toBe('Yes');
    const period = document.getElementById('hero-period');
    expect(period.textContent).toBe('.');
    expect(period.style.color).toBe('var(--green)');
    expect(document.getElementById('pm-count').textContent).toBe('7');
    expect(document.getElementById('footer-status').textContent).toBe(
      'Scoreboard settled',
    );
    expect(document.getElementById('hero-status').textContent).toContain(
      'Scoreboard settled',
    );
  });

  it('previews the historical "Not yet" state under ?force=no', () => {
    renderHero(false, true);

    expect(document.getElementById('hero-answer-text').textContent).toBe(
      'Not yet',
    );
    expect(document.getElementById('hero-period').style.color).toBe(
      'var(--amber)',
    );
    expect(document.getElementById('pm-count').textContent).toBe('6');
    expect(document.getElementById('hero-status').textContent).toBe(
      'Scoreboard overridden: NOT YET (forced via query param)',
    );
  });
});

describe('formatScoreboardStatus', () => {
  it('states the settled answer without implying a live check', () => {
    const status = formatScoreboardStatus(true, false);
    expect(status).toContain('Scoreboard settled');
    expect(status).not.toMatch(/checking|last checked|just now/i);
  });

  it('uses the overridden wording for forced states', () => {
    expect(formatScoreboardStatus(true, true)).toBe(
      'Scoreboard overridden: YES (forced via query param)',
    );
    expect(formatScoreboardStatus(false, true)).toBe(
      'Scoreboard overridden: NOT YET (forced via query param)',
    );
  });
});

// extractText's regex fallback is covered in the node-environment worker suite;
// this exercises the DOMParser branch, which only runs where a DOM is present
// (the Workers runtime — and happy-dom here).
describe('extractText (DOMParser branch)', () => {
  it('strips scripts, style and chrome via DOMParser, keeping body prose', () => {
    const html = `
      <html><head><style>.x{color:red}</style></head>
      <body><nav>menu</nav><p>Burnham confirms he will stand.</p>
      <script>evil()</script><footer>foot</footer></body></html>`;
    const text = extractText(html);
    expect(text).toContain('Burnham confirms he will stand');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('menu');
    expect(text).not.toContain('foot');
  });

  it('caps output at ~1500 characters', () => {
    const long = `<p>${'word '.repeat(1000)}</p>`;
    expect(extractText(long).length).toBeLessThanOrEqual(1500);
  });
});
