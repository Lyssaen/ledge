import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:5299' },
  webServer: { command: 'pnpm exec vite', url: 'http://127.0.0.1:5299/', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Skipped by each spec when WebKit is not installed (see e2e/webkit.ts).
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
