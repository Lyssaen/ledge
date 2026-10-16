import { test, expect } from './fixtures';
import { fakeDaemon, fakeRemote, session } from './daemon';

test('a remote machine falls then comes back', async ({ page }) => {
  await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })], { machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  const remote = await fakeRemote(page, 'devbox', [session('nova', { name: 'Nova', state: 'waiting_input' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(2);
  remote.close();
  await expect(page.getByText('Devbox is disconnected')).toBeVisible();
  await expect(page.locator('.seat[data-offline="true"]')).toHaveCount(1);
  await page.locator('.seat[data-offline="true"]').click(); // selecting a frozen seat is fine
  await expect(page.locator('.seat[aria-pressed="true"]')).toHaveCount(1);
  remote.reopen([session('nova', { name: 'Nova', state: 'working' }), session('milo', { name: 'Milo', state: 'working' })]);
  await expect(page.getByText('Devbox is disconnected')).toBeHidden();
  await expect(page.locator('.seat')).toHaveCount(3);
  await expect(page.locator('.seat[data-offline="true"]')).toHaveCount(0);
});

test('the local daemon down: a read-only alert', async ({ page }) => {
  const local = await fakeDaemon(page, [session('otto', { name: 'Otto', state: 'working' })]);
  await page.goto('/');
  await expect(page.locator('.seat')).toHaveCount(1);
  local.close();
  await expect(page.getByRole('alert')).toContainText('Local daemon unreachable');
  await expect(page.locator('main')).toHaveAttribute('data-readonly', 'true');
  // Its sessions stay on screen, frozen, rather than vanishing.
  await expect(page.locator('.seat[data-offline="true"]')).toHaveCount(1);
  await expect(page.locator('.seat .state')).toHaveText('Disconnected');
});
