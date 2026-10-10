import { defineConfig, devices } from '@playwright/test';

// e2e runs the real Vite app in Chromium; the daemon is simulated in the page via routeWebSocket (see e2e/daemon.ts).
// Port 5199 so it never collides with `tauri dev` (1420) or the real daemon (47831).
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5199', ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
  webServer: { command: 'pnpm exec vite --port 5199 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5199', reuseExistingServer: true, timeout: 60_000 }
});
