import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

/** The IDE has booted on the Atelier tab (its chunk loads on the first visit: under a parallel run it can take more than 5 s). */
async function booted(page: Page): Promise<void> {
  await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.ide-dockview .dv-tab').filter({ hasText: 'Atelier' })).toBeVisible();
}

/** A machine's connection, as Settings › Machines says it (the IDE has no machine list in its sidebar). */
async function machine(page: Page, label: string) {
  if (!(await page.locator('.settings-nav').isVisible())) await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Machines/ }).click();
  return page.getByRole('article', { name: label }).locator('.set-status');
}

test('boots on the local daemon: name, sessions and machine', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('group', { name: 'Window bar' }).getByText('Ledge')).toBeVisible();
  await expect(page.locator('.ide-atelier button[data-agent^="local:"]')).toHaveCount(8);
  await expect(await machine(page, 'Local')).toHaveText('Connected');
});

test('the local daemon goes away: disconnected', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto')]);
  await page.goto('/'); await booted(page);
  const status = await machine(page, 'Local');
  await expect(status).toHaveText('Connected');
  d.close();
  await expect(status).toHaveText('Offline');
});

test('an unreachable remote is disconnected while local stays connected', async ({ page }) => {
  await fakeDaemon(page, [session('otto')], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();   // refuses every connection from the start
  await page.goto('/'); await booted(page);
  await expect(await machine(page, 'Local')).toHaveText('Connected');
  await expect(await machine(page, 'Devbox')).toHaveText('Offline');
});

test('no daemon at all: the shell still opens', async ({ page }) => {
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => ws.close());
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('navigation', { name: 'Activity bar' })).toBeVisible();
  await expect(await machine(page, 'Local')).toHaveText('Offline');
});
