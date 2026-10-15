// Isolated, self-contained design preview, using Ledge's actual UI components.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(root, '../../../apps/overlay/package.json'));
const { build } = await import(require.resolve('vite'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));
const out = await mkdtemp(path.join(tmpdir(), 'ledge-machines-design-'));
await build({ configFile: false, root, base: './', resolve: { alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } }, plugins: [react(), tailwind()], build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 1000000 } });
let html = await readFile(path.join(out, 'index.html'), 'utf8');
for (const asset of await readdir(path.join(out, 'assets'))) {
  const content = await readFile(path.join(out, 'assets', asset), 'utf8');
  if (asset.endsWith('.js')) html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '<script type="module">' + content.replaceAll('</script', '<\\/script') + '</script>');
  if (asset.endsWith('.css')) html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/, () => '<style>' + content + '</style>');
}
const target = path.resolve(root, '../ledge-machine-settings.html');
await writeFile(target, html);
if (process.argv[2]) await writeFile(path.resolve(process.argv[2]), html);
console.log(target);
