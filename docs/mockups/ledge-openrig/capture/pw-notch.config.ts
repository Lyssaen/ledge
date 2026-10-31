import { defineConfig, devices } from '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/overlay/node_modules/@playwright/test/index.js';
export default defineConfig({
  testDir: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture', testMatch: /notch-new\.spec\.ts/, outputDir: '/home/paradow/Workspace/harness-assistant/docs/mockups/ledge-openrig/capture/.results-n', reporter: [['list']], workers: 1, timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:5312', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  webServer: { command: 'pnpm exec vite --port 5312 --strictPort --host 127.0.0.1', cwd: '/home/paradow/Workspace/harness-assistant/.worktrees/capture-main/apps/overlay', url: 'http://127.0.0.1:5312', reuseExistingServer: false, timeout: 90_000 }
});
