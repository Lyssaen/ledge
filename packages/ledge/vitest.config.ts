import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every temporary folder of a run lives in one folder that the run removes at its end (test/global-tmpdir.ts).
    globalSetup: ['test/global-tmpdir.ts'],
    // Every test file gets its own LEDGE_HOME: code that logs or writes state must never reach the real ~/.ledge.
    setupFiles: ['test/isolate-home.ts']
  }
});
