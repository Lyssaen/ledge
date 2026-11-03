import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lot 1 complement to ledge-human-operator-ab.html: the « À toi » cards against the back contract
// (docs/vision/ledge-human-channel-contract.md, branch feat/human-channel). Reuses the directions page's and the A+B page's
// styles, plus the real Lyssaën tokens and sidebar stylesheet. Output: docs/mockups/ledge-human-operator-ab-lot1.html.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const styleOf = s => s.slice(s.indexOf('<style>') + 7, s.indexOf('</style>'));
const tokens = (await readFile(resolve(root, 'packages/ui/src/styles/tokens.css'), 'utf8'))
  .replaceAll(':root, :root[data-theme="light"]', '.th-light')
  .replaceAll(':root[data-theme="dark"]', '.th-dark');
const sidebar = await readFile(resolve(root, 'apps/desktop/src/styles/sidebar.css'), 'utf8');
const base = styleOf(await readFile(resolve(root, 'docs/mockups/human-operator/page.html'), 'utf8'));
const ab = styleOf(await readFile(resolve(root, 'docs/mockups/human-operator-ab/page.html'), 'utf8')).replace('/*BASE*/', '');
const page = await readFile(resolve(here, 'page.html'), 'utf8');
const html = page.replace('/*BASE*/', base + ab).replace('/*TOKENS*/', tokens).replace('/*SIDEBAR*/', sidebar);
const out = resolve(root, 'docs/mockups/ledge-human-operator-ab-lot1.html');
await writeFile(out, html);
console.log(out, Buffer.byteLength(html));
