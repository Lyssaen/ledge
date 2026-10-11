// Builds only this isolated mockup, inlining the real components into a file Windows can open directly.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.resolve(root,'../../../apps/overlay/package.json'));
const {build}=await import(require.resolve('vite'));
const {default:react}=await import(require.resolve('@vitejs/plugin-react'));
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'));
const out='/tmp/ledge-reader-existing-build';
await build({configFile:false,root,base:'./',resolve:{alias:{react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))}},plugins:[react(),tailwind()],build:{outDir:out,emptyOutDir:true,assetsInlineLimit:1000000,minify:true}});
let html=await readFile(path.join(out,'index.html'),'utf8');
for(const asset of await readdir(path.join(out,'assets'))){
 const content=await readFile(path.join(out,'assets',asset),'utf8');
 if(asset.endsWith('.js'))html=html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/,()=>'<script type="module">'+content.replaceAll('</script','<\\/script')+'</script>');
 if(asset.endsWith('.css'))html=html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/,()=>'<style>'+content+'</style>');
}
await writeFile(path.join(root,'../ledge-reader-existing.html'),html);
console.log('Standalone mockup: docs/mockups/ledge-reader-existing.html');
