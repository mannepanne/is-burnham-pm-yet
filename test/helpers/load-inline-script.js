// ABOUT: Test helper that loads the front-end's inline <script> from
// ABOUT: public/index.html and exposes its render functions for unit testing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, '..', '..', 'public', 'index.html');

// Extract the first inline <script> (the application script — the Cloudflare
// beacon tag carries attributes so it does not match the bare `<script>`),
// strip the DOM-load auto-init block so evaluation has no side effects, and
// return the functions under test. Function declarations are hoisted, so
// evaluating the body and returning them by name works without exports.
export function loadInlineScript() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find the inline application script in index.html');
  }

  const code = match[1].replace(/\/\/ Initialize on DOM load[\s\S]*$/, '');
  const factory = new Function(
    `${code}\n; return { createArticleCard, getVerdictLabel };`,
  );
  return factory();
}
