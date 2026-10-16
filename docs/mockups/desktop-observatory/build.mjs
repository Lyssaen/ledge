import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone design prototype: bundle the actual overlay components without changing the application.
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../..');
const require=createRequire(resolve(root,'apps/overlay/package.json'));
const viteRequire=createRequire(require.resolve('vite'));
const {build}=viteRequire('esbuild');
const result=await build({entryPoints:[resolve(here,'observatory.tsx')],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',nodePaths:[resolve(root,'apps/overlay/node_modules')],define:{'import.meta.env':'{}','process.env.NODE_ENV':'"production"'},minify:true,loader:{'.css':'empty'}});
const paths=['apps/overlay/src/styles/tokens.css','apps/overlay/src/bots/bots.css','apps/overlay/src/bots/resident.css','apps/overlay/src/styles/base.css','docs/mockups/desktop-observatory/observatory.css','docs/mockups/desktop-observatory/office.css','docs/mockups/desktop-observatory/sidebar.css','docs/mockups/desktop-observatory/launch.css','docs/mockups/desktop-observatory/decor.css','docs/mockups/desktop-observatory/settings.css','docs/mockups/desktop-observatory/projects.css','docs/mockups/desktop-observatory/list.css','apps/overlay/src/documents/markdown.css','docs/mockups/desktop-observatory/session.css'];
const css=(await Promise.all(paths.map(p=>readFile(resolve(root,p),'utf8')))).map(s=>s.replace(/^@import .*;\s*$/gm,'')).join('\n');
const html=`<!doctype html><html lang="fr" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledge desktop — Atelier · Design system</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"><style>${css}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
const output=resolve(root,'docs/mockups/ledge-desktop-observatory.html');
await writeFile(output,html);
if(process.argv[2])await writeFile(resolve(process.argv[2]),html);
console.log(JSON.stringify({output,sharedComponents:['Bot','ResidentMascot','Button','Badge','Tabs','Icon'],styles:paths,bytes:Buffer.byteLength(html)}));
