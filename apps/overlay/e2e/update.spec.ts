import { test, expect, expectMode } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { wake } from './scenarios';

/** Ledge Desktop found 0.3.0: the notch only reads it from the shared storage. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('desktop.update.available', '0.3.0'));
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
