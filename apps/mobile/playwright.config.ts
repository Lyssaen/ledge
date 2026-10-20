import { existsSync } from 'node:fs';
import { defineConfig, devices, webkit } from '@playwright/test';

// WebKit only runs where its browser is installed; nothing is downloaded here.
const hasWebkit = existsSync(webkit.executablePath());

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:5299' },
  webServer: { command: 'pnpm exec vite', url: 'http://127.0.0.1:5299/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(hasWebkit ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
