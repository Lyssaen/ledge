import { defineConfig } from 'vitest/config';

// Tests of the repo-level release scripts (scripts/). Named explicitly: a root vitest.config.ts would be picked up
// by findUp as the config of packages/protocol.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
