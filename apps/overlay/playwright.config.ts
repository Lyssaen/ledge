import { defineConfig, devices } from '@playwright/test';
import { e2ePort, e2eReuse } from '../../scripts/e2e-port';

// This worktree's own port, in 5800-6299 (LEDGE_E2E_PORT forces it): another tree's run is never reused (scripts/e2e-port.ts).
const PORT = e2ePort(5800);

// e2e runs the real Vite app in Chromium; the daemon is simulated in the page via routeWebSocket (see e2e/daemon.ts).
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
  webServer: { command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: e2eReuse(), timeout: 60_000 }
});
