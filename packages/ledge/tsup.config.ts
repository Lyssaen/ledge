import { copyFileSync, readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // The reduce worker is its own file beside the CLI (daemon/captureReducer.ts starts `./reduceWorker.js` from the bundle);
  // no splitting, so each stays one self-contained file.
  // index.js is the bin and imports nothing when it loads (see src/cli/index.ts): it loads hook.js for `ledge hook`, main.js for the rest.
  entry: { index: 'src/cli/index.ts', main: 'src/cli/main.ts', hook: 'src/cli/hook.ts', reduceWorker: 'src/daemon/reduceWorker.ts' },
  splitting: false,
  format: ['esm'],
  target: 'node22',
  outDir: 'dist/cli',
  clean: true,
  // @ledge/protocol is a workspace package that ships TypeScript sources: bundle it into the CLI,
  // otherwise dist/cli/index.js imports src/index.ts at runtime and fails with ERR_MODULE_NOT_FOUND.
  noExternal: ['@ledge/protocol', '@ledge/seal'],
  define: { __LEDGE_VERSION__: JSON.stringify(version) },
  // The Ledge guide the chat writes into ledge.md (chat/guide.ts reads it beside dist/cli).
  onSuccess: async () => { copyFileSync(new URL('../../docs/ledge-guide.md', import.meta.url), new URL('./dist/ledge-guide.md', import.meta.url)); }
});
