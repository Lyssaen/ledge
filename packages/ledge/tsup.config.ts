import { defineConfig } from 'tsup';

// @ledge/protocol is a workspace package that ships TypeScript sources: bundle it into the CLI,
// otherwise dist/cli/index.js imports src/index.ts at runtime and fails with ERR_MODULE_NOT_FOUND.
export default defineConfig({ noExternal: ['@ledge/protocol'] });
