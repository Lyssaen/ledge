import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Every test file gets its own LEDGE_HOME: code that logs or writes state must never reach the real ~/.ledge.
  test: { setupFiles: ['test/isolate-home.ts'] }
});
