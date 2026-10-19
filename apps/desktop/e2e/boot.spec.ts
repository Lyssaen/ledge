import { test, expect } from './fixtures';
import { eight, fakeDaemon, fakeRemote, session } from './daemon';

test('boots on the local daemon: name, sessions and machine', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
  await expect(page.locator('aside.sidebar').getByText('8 active')).toBeVisible();
  await expect(page.locator('aside.sidebar').getByText('Local')).toBeVisible();
});

test('the local daemon goes away: disconnected', async ({ page }) => {
  const d = await fakeDaemon(page, [session('otto')]);
  await page.goto('/');
  const side = page.locator('aside.sidebar');
  await expect(side.getByText('1 active', { exact: true })).toBeVisible();
  d.close();
  await expect(side.getByRole('button', { name: 'Local' })).toHaveAttribute('title', /offline/);
});

test('an unreachable remote is disconnected while local stays connected', async ({ page }) => {
  await fakeDaemon(page, [session('otto')], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', []);
  remote.close();   // refuses every connection from the start
  await page.goto('/');
  const side = page.locator('aside.sidebar');
  await expect(side.getByText('1 active', { exact: true })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Devbox' })).toHaveAttribute('title', /offline/);
});

test('no daemon at all: the shell still opens', async ({ page }) => {
  await page.routeWebSocket(/127\.0\.0\.1:47831\/?$/, ws => ws.close());
  await page.goto('/');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
  await expect(page.locator('aside.sidebar').getByRole('button', { name: 'Local' })).toHaveAttribute('title', /offline/);
});
