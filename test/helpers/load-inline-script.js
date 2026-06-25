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
//
// This is a deliberate bridge: it lets the S-1 render guard test the live
// inline script without prematurely extracting it. Retire it when S-2 extracts
// the script into a module — at that point import the module directly. Do not
// add further front-end tests on top of this eval path; wait for the module.
//
// The guards below make the string-coupling fail loudly: if the inline-script
// markers ever drift, the test errors clearly instead of loading the wrong
// block or silently running init() inside `new Function`.
const INIT_MARKER = '// Initialize on DOM load';

export function loadInlineScript() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Could not find the inline application script in index.html');
  }

  const raw = match[1];
  if (!raw.includes('function createArticleCard')) {
    throw new Error(
      'Extracted inline <script> does not contain createArticleCard — the wrong block was matched; update load-inline-script.js',
    );
  }
  if (!raw.includes(INIT_MARKER)) {
    throw new Error(
      `Inline-script init marker "${INIT_MARKER}" not found — the auto-init block may no longer be stripped; update load-inline-script.js`,
    );
  }

  const code = raw.replace(new RegExp(`${INIT_MARKER}[\\s\\S]*$`), '');
  const factory = new Function(
    `${code}\n; return { createArticleCard, getVerdictLabel };`,
  );
  return factory();
}
