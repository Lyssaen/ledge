// Builds this isolated mockup into one file that opens offline (docs/mockups/ledge-agent-conversation.html), bundling
// Desktop's real components. Two things are swapped for the mockup only: the thread's MessageCard (./MessageCard.tsx, the
// app's plus the new entry points), and bare imports from this folder resolve as Desktop's own do.
// Run: node docs/mockups/agent-conversation/build.mjs [extra/copy.html]   (MOCKUP_DEBUG=1: not minified, to read a stack)
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(root, '../../../apps/desktop');
const require = createRequire(path.join(desktop, 'package.json'));
const { build } = await import(require.resolve('vite'));
const { default: react } = await import(require.resolve('@vitejs/plugin-react'));
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'));

const thread = path.join(desktop, 'src/session/Thread.tsx');
const entry = path.join(desktop, 'src/main.tsx');
const mockup = {
  name: 'ledge-mockup',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (!importer) return null;
    const from = importer.split('?')[0];
    if (from === thread && source === './MessageCard') return path.join(root, 'MessageCard.tsx');
    const bare = !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0');
    if (bare && from.startsWith(root + path.sep)) return this.resolve(source, entry, { skipSelf: true });
    return null;
  }
};

const out = await mkdtemp(path.join(tmpdir(), 'ledge-agent-conversation-'));
await build({
  configFile: false, root, base: './', logLevel: 'warn',
  // One React for everything (packages/ui has its own devDependency copy): Desktop's.
  resolve: { alias: { react: path.dirname(require.resolve('react/package.json')), 'react-dom': path.dirname(require.resolve('react-dom/package.json')) } },
  plugins: [mockup, react(), tailwind()],
  build: { outDir: out, emptyOutDir: true, target: 'es2022', minify: !process.env.MOCKUP_DEBUG, assetsInlineLimit: 1_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
});
let html = await readFile(path.join(out, 'index.html'), 'utf8');
for (const asset of await readdir(path.join(out, 'assets'))) {
  const content = await readFile(path.join(out, 'assets', asset), 'utf8');
  if (asset.endsWith('.js')) html = html.replace(/<script type="module"[^>]*src="[^"]+"[^>]*><\/script>/, () => '<script type="module">' + content.replaceAll('</script', '<\\/script') + '</script>');
  if (asset.endsWith('.css')) html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>/, () => '<style>' + content + '</style>');
}
const target = path.resolve(root, '../ledge-agent-conversation.html');
await writeFile(target, html);
if (process.argv[2]) await writeFile(path.resolve(process.argv[2]), html);
console.log(target);
