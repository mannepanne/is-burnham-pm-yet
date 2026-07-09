// ABOUT: Front-end render tests — the S-1 XSS regression guard.
// ABOUT: Verifies createArticleCard escapes untrusted article fields.
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createArticleCard } from '../public/app.js';
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
