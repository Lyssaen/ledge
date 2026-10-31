import { defineConfig, devices } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop/node_modules/@playwright/test/index.js';
const S = '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture';
export default defineConfig({
  testDir: S, testMatch: /(rigs|desk)\.spec\.ts/, outputDir: S + '/.results', reporter: [['list']], workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:5311', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  webServer: { command: 'pnpm exec vite --port 5311 --strictPort --host 127.0.0.1', cwd: '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/desktop', url: 'http://127.0.0.1:5311', reuseExistingServer: false, timeout: 90_000, env: { VITE_LEDGE_E2E: '1' } }
});
