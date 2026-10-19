import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // @ledge/protocol and @ledge/seal are workspace packages that ship TypeScript sources: bundle them,
  // otherwise dist/main.js imports their src/index.ts at runtime and fails with ERR_MODULE_NOT_FOUND.
  noExternal: ['@ledge/protocol', '@ledge/seal']
});
