import { defineConfig, devices } from '@playwright/test';
import { e2ePort, e2eReuse } from '../../scripts/e2e-port';

// This worktree's own port, in 6300-6799 (LEDGE_E2E_PORT forces it), apart from the desktop's e2e and another tree's (scripts/e2e-port.ts).
const PORT = e2ePort(6300);

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: { command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`, url: `http://127.0.0.1:${PORT}/`, reuseExistingServer: e2eReuse() },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Skipped by each spec when WebKit is not installed (see e2e/webkit.ts).
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
