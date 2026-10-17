import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone design prototype: one-row island, bundled from the real mascots. It does not change the application.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'apps/overlay/package.json'));
const viteRequire = createRequire(require.resolve('vite'));
const { build } = viteRequire('esbuild');
const result = await build({
  entryPoints: [resolve(here, 'island.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  nodePaths: [resolve(root, 'apps/overlay/node_modules')],
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  minify: true,
});
const paths = [
  'packages/ui/src/styles/tokens.css',
  'packages/ui/src/bots/bots.css',
  'packages/ui/src/bots/resident.css',
  'packages/ui/src/styles/base.css',
  'docs/mockups/island-minimal/island.css',
];
const css = (await Promise.all(paths.map(p => readFile(resolve(root, p), 'utf8')))).map(s => s.replace(/^@import .*;\s*$/gm, '')).join('\n');
const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>L’île, quatre encoches</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, 'docs/mockups/ledge-island-minimal.html');
await writeFile(output, html);
if (process.argv[2]) await writeFile(resolve(process.argv[2]), html);
console.log(JSON.stringify({ output, sharedComponents: ['Shoulders', 'Bot', 'ResidentMascot', 'Button', 'Icon'], styles: paths, bytes: Buffer.byteLength(html) }));
