// Standalone mockup: the Atelier view on iPad, in the mobile app. The real mobile components and their Tailwind (apps/mobile
// styles.css), the real Desktop Atelier component and stylesheets, sample sessions, inlined into one file.
// `node docs/mockups/ipad-atelier/build.mjs [entry]` writes docs/mockups/ledge-ipad-atelier.html (or ipad-atelier/<entry>.html).
// Needs this worktree's node_modules (pnpm install). The script is bundled by esbuild; Vite only compiles the stylesheet
// (Tailwind v4 scans the mobile sources and this folder), fonts inlined.
import { createRequire } from 'node:module';
import { readFile, readdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const entry = process.argv[2] ?? 'mockup';
const mobile = createRequire(resolve(root, 'apps/mobile/package.json'));
const { build: vite } = await import(mobile.resolve('vite'));
const { default: tailwind } = await import(mobile.resolve('@tailwindcss/vite'));
const { build: esbuild } = createRequire(mobile.resolve('vite'))('esbuild');

// The script: both apps' components, one React.
const js = await esbuild({
  entryPoints: [resolve(here, `${entry}.tsx`)], bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
  nodePaths: [resolve(root, 'apps/mobile/node_modules'), resolve(root, 'apps/desktop/node_modules'), resolve(root, 'node_modules')],
  define: { 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}', 'process.env.NODE_ENV': '"production"' }, minify: true, loader: { '.css': 'empty' }
});

// The stylesheet: mockup.css through Vite and Tailwind.
const out = await mkdtemp(join(tmpdir(), 'ledge-ipad-atelier-'));
await writeFile(join(here, 'index.html'), '<!doctype html><html><head></head><body><script type="module" src="./css-entry.ts"></script></body></html>');
await vite({
  configFile: false, root: here, base: './', logLevel: 'warn', plugins: [tailwind()],
  build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false, minify: true }
});
const css = (await Promise.all((await readdir(join(out, 'assets'))).filter(a => a.endsWith('.css')).map(a => readFile(join(out, 'assets', a), 'utf8')))).join('\n');

const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledge iPad Atelier</title><style>${css}</style></head><body><div id="root"></div><script type="module">${js.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, entry === 'mockup' ? 'docs/mockups/ledge-ipad-atelier.html' : `docs/mockups/ipad-atelier/${entry}.html`);
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html) }));
