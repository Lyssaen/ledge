import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone mockup: the closed notch with Ledge alone, one activity line and the music cover.
// Bundles the real ResidentMascot / Shoulders / tokens without touching the application.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(resolve(root, 'apps/overlay/package.json'));
const viteRequire = createRequire(require.resolve('vite'));
const { build } = viteRequire('esbuild');
const result = await build({ entryPoints: [resolve(here, 'notch.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', nodePaths: [resolve(root, 'apps/overlay/node_modules')], define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' }, minify: true });
const paths = ['packages/ui/src/styles/tokens.css', 'packages/ui/src/bots/bots.css', 'packages/ui/src/bots/resident.css', 'packages/ui/src/styles/base.css', 'docs/mockups/notch-activity/notch.css'];
const css = (await Promise.all(paths.map(p => readFile(resolve(root, p), 'utf8')))).map(s => s.replace(/^@import .*;\s*$/gm, '')).join('\n');
const html = `<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Encoche : activité et musique</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
const output = resolve(root, 'docs/mockups/ledge-notch-activity.html');
await writeFile(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html) }));
