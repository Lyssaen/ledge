import { defineConfig, devices } from '@playwright/test';
import { e2ePort, e2eReuse } from '../../scripts/e2e-port';

// e2e runs the real Vite app in Chromium; the daemon is simulated in the page via routeWebSocket (see e2e/daemon.ts).
// Its port is this worktree's own, in 5300-5799 (LEDGE_E2E_PORT forces it): never `tauri dev` (1421), the real daemon (47831), another
// app's e2e, or another tree's run. VITE_LEDGE_E2E shortens the fleet's reconnect backoff.
const PORT = e2ePort(5300);
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
  webServer: { command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`, url: `http://127.0.0.1:${PORT}`, reuseExistingServer: e2eReuse(), timeout: 60_000, env: { VITE_LEDGE_E2E: '1' } }
});
