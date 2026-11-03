import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The A+B mockup reuses the directions page's styles (docs/mockups/human-operator/page.html) and inlines the real Lyssaën
// tokens and sidebar stylesheet (main 0c47f61b), scoped per theme. Output: docs/mockups/ledge-human-operator-ab.html.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const tokens = (await readFile(resolve(root, 'packages/ui/src/styles/tokens.css'), 'utf8'))
  .replaceAll(':root, :root[data-theme="light"]', '.th-light')
  .replaceAll(':root[data-theme="dark"]', '.th-dark');
const sidebar = await readFile(resolve(root, 'apps/desktop/src/styles/sidebar.css'), 'utf8');
const directions = await readFile(resolve(root, 'docs/mockups/human-operator/page.html'), 'utf8');
const base = directions.slice(directions.indexOf('<style>') + 7, directions.indexOf('</style>'));
const page = await readFile(resolve(here, 'page.html'), 'utf8');
const html = page.replace('/*BASE*/', base).replace('/*TOKENS*/', tokens).replace('/*SIDEBAR*/', sidebar);
const out = resolve(root, 'docs/mockups/ledge-human-operator-ab.html');
await writeFile(out, html);
console.log(out, Buffer.byteLength(html));
