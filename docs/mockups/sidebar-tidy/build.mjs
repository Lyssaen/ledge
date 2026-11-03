import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inline the real Lyssaën tokens and the real sidebar stylesheet (main 0c47f61b) into the mockup, scoped per theme
// (.th-light / .th-dark) so both themes sit on one page. Output: docs/mockups/ledge-sidebar-tidy.html, opens without a server.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const tokens = (await readFile(resolve(root, 'packages/ui/src/styles/tokens.css'), 'utf8'))
  .replaceAll(':root, :root[data-theme="light"]', '.th-light')
  .replaceAll(':root[data-theme="dark"]', '.th-dark');
const sidebar = await readFile(resolve(root, 'apps/desktop/src/styles/sidebar.css'), 'utf8');
const page = await readFile(resolve(here, 'page.html'), 'utf8');
const html = page.replace('/*TOKENS*/', tokens).replace('/*SIDEBAR*/', sidebar);
const out = resolve(root, 'docs/mockups/ledge-sidebar-tidy.html');
await writeFile(out, html);
console.log(out, Buffer.byteLength(html));
