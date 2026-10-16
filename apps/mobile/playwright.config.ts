import { defineConfig, devices } from '@playwright/test';

// e2e runs the real Vite app in Chromium; the daemon is simulated in the page via routeWebSocket (see e2e/daemon.ts).
// Port 5299 so it never collides with the overlay (5199, 1420) or the real daemon.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5299', ...devices['Desktop Chrome'] },
  webServer: { command: 'pnpm exec vite --port 5299 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5299/m/', reuseExistingServer: true, timeout: 60_000 }
});
