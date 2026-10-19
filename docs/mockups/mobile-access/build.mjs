// Standalone design mockup of Settings › Accès mobile, built from the desktop's real components and styles, without changing the app.
// Vite (the desktop's own, with its React and Tailwind plugins) bundles main.tsx: the real Card/Row/SwitchRow, @ledge/ui's
// Button/Icon/Kbd, the real Modal and the real stylesheet (apps/desktop/src/styles/app.css, which carries Tailwind's preflight,
// the tokens, base.css, shell.css and settings.css). Everything is then inlined into one HTML file that opens from disk.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const desktop = resolve(root, 'apps/desktop');
const require = createRequire(resolve(desktop, 'package.json'));
const { build } = await import(require.resolve('vite'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));

const result = await build({
  configFile: false, logLevel: 'warn', root: here, base: './',
  plugins: [react(), tailwind()],
  define: { 'import.meta.env.VITE_LEDGE_E2E': 'undefined' },
  resolve: {
    alias: [
      { find: /^@ledge\/ui\/styles\/(.*)$/, replacement: resolve(root, 'packages/ui/src/styles/$1') },
      { find: /^@ledge\/ui\/(.*)$/, replacement: resolve(root, 'packages/ui/src/$1') },
      { find: /^react$/, replacement: dirname(require.resolve('react/package.json')) },
      { find: /^react\/(.*)$/, replacement: dirname(require.resolve('react/package.json')) + '/$1' },
      { find: /^react-dom$/, replacement: dirname(require.resolve('react-dom/package.json')) },
      { find: /^react-dom\/(.*)$/, replacement: dirname(require.resolve('react-dom/package.json')) + '/$1' }
    ]
  },
  build: {
    write: false, cssCodeSplit: false, assetsInlineLimit: 10_000_000, modulePreload: false, minify: true,
    rollupOptions: { input: resolve(here, 'main.tsx'), output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' } }
  }
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
const js = outputs.filter(o => o.type === 'chunk').map(o => o.code).join('\n');
const css = outputs.filter(o => o.type === 'asset' && o.fileName.endsWith('.css')).map(o => String(o.source)).join('\n');

const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ledge Desktop — Accès mobile (maquette)</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, 'docs/mockups/ledge-mobile-access.html');
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), css: Buffer.byteLength(css), js: Buffer.byteLength(js) }));
