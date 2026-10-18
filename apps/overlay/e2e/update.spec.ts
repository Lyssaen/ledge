import { test, expect, expectMode } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { wake } from './scenarios';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __LEDGE_FAKE_UPDATE__: unknown }).__LEDGE_FAKE_UPDATE__ = {
      version: '0.3.0', notes: '- Réponses depuis le chat\n- Île plus réactive',
      downloadAndInstall: async (p: (done: number, total: number) => void) => { p(5, 10); }
    };
  });
});

test('the update pip notes Ledge Desktop and does not start an install', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Otto' })], { daemon: { version: '0.2.2', install: 'npm', systemd: true } });
  await page.goto('/');
  const pip = page.locator('[data-update-pip="new"]');
  await expect(pip).toBeVisible();
  await wake(page);
  await pip.click();
  await expectMode(page, 'handle');
  await expect(page.getByRole('status')).toContainText('Opening updates in Ledge Desktop');
  await expect.poll(() => d.received.some(m => m.type === 'update.daemon')).toBe(false);
});
