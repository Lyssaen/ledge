import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone mockup (the Projects section eye: every project or only those with a live agent): Ledge's real mascots and icons, Desktop's real stylesheets, the
// changed screens drawn with the classes the app already has. `node docs/mockups/projects-eye/build.mjs` writes
// docs/mockups/ledge-projects-eye.html. Dependencies come from a checkout that has node_modules (LEDGE_DEPS, default:
// the shared clone), read only.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const deps = process.env.LEDGE_DEPS ?? (existsSync(resolve(root, 'node_modules')) ? root : resolve(root, '../../ledge'));
const require = createRequire(resolve(deps, 'apps/desktop/package.json'));
const viteRequire = createRequire(require.resolve('vite'));
const { build } = viteRequire('esbuild');
const result = await build({
  entryPoints: [resolve(here, 'mockup.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  nodePaths: [resolve(deps, 'apps/desktop/node_modules'), resolve(deps, 'node_modules')],
  define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, minify: true, loader: { '.css': 'empty' }
});
const paths = [
  'packages/ui/src/styles/tokens.css', 'packages/ui/src/bots/bots.css', 'packages/ui/src/styles/base.css',
  'apps/desktop/src/styles/sidebar.css',
  'docs/mockups/projects-eye/mockup.css'
];
const css = (await Promise.all(paths.map(p => readFile(resolve(root, p), 'utf8')))).map(s => s.replace(/^@import .*;\s*$/gm, '')).join('\n');
const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledge projects eye</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, 'docs/mockups/ledge-projects-eye.html');
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html) }));
