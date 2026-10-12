import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist/cli',
  clean: true,
  // @ledge/protocol is a workspace package that ships TypeScript sources: bundle it into the CLI,
  // otherwise dist/cli/index.js imports src/index.ts at runtime and fails with ERR_MODULE_NOT_FOUND.
  noExternal: ['@ledge/protocol'],
  define: { __LEDGE_VERSION__: JSON.stringify(version) }
});
