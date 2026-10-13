import type { Locator } from '@playwright/test';
import { test, expect, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { openList } from './scenarios';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __LEDGE_FAKE_UPDATE__: unknown }).__LEDGE_FAKE_UPDATE__ = {
      version: '0.3.0', notes: '- Réponses depuis le chat\n- Île plus réactive',
      downloadAndInstall: async (p: (done: number, total: number) => void) => { p(5, 10); }
    };
  });
});

test('the island and the list offer the update, and the click asks the daemon first', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Otto' })], { daemon: { version: '0.2.2', install: 'npm', systemd: true } });
  await page.goto('/');
  await expect(page.locator('[data-update-pip="new"]')).toBeVisible();
  await openList(page);
  await expect(page.getByText('Ledge 0.3.0 is available')).toBeVisible();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect.poll(() => d.received).toContainEqual({ type: 'update.daemon', version: '0.3.0' });
  d.send({ type: 'update.failed', version: '0.3.0', reason: 'sessions-at-risk' });
  await expect(page.getByRole('alert')).toContainText('a restart would close them');
});

test('with no session the list grows to hold the whole update card, its buttons in reach', async ({ page }) => {
  // A long release (six notes): the card alone is taller than the empty state.
  await page.addInitScript(() => {
    const w = window as unknown as { __LEDGE_FAKE_UPDATE__: { notes: string } };
    w.__LEDGE_FAKE_UPDATE__ = { ...w.__LEDGE_FAKE_UPDATE__, notes: Array.from({ length: 6 }, (_, i) => `- Note de version ${i + 1}`).join('\n') };
  });
  await fakeDaemon(page, [], { daemon: { version: '0.2.2', install: 'npm', systemd: true } });
  await page.goto('/');
  await openList(page);
  const update = page.getByRole('button', { name: 'Update', exact: true });
  await expect(update).toBeVisible();
  const bottom = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height; };
  await expect.poll(async () => await bottom(update) <= await bottom(surface(page))).toBe(true);
  await expect.poll(async () => await bottom(page.locator('[data-empty]')) <= await bottom(surface(page))).toBe(true);
});
