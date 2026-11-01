import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '/home/paradow/Workspace/harness-assistant/.worktrees/mobi-mockup/apps/mobile/e2e', testMatch: /zz-.*\.spec\.ts/, projects: [{ name: 'chromium' }] });
