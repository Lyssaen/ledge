import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

test('edge hover opens the list; a row click opens the session; Escape goes back, then closes', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  // The real mouse against the left edge, well above the handle (a DOM hot zone in the browser).
  await page.mouse.move(200, 120);
  await page.mouse.move(3, 120, { steps: 4 });
  await expectMode(page, 'list');
  await expect(layer(page, 'list').getByRole('button', { name: 'speos-api, Pim, open' })).toBeVisible();
  await layer(page, 'list').getByRole('button', { name: 'speos-api, Pim, open' }).click();
  await expectMode(page, 'session');
  await expect(layer(page, 'session')).toContainText('Pim');
  // The keyboard works in a mouse-opened panel.
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
});

test('a mouse-opened list: header buttons and rows take real clicks (no hidden layer swallows them)', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await page.mouse.move(3, 120, { steps: 2 });
  await expectMode(page, 'list');
  await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
  await expectMode(page, 'settings');
  await layer(page, 'settings').getByRole('button', { name: 'Back to sessions' }).click();
  await expectMode(page, 'list');
  await layer(page, 'list').getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expectMode(page, 'help');
  await page.keyboard.press('Escape');
  await expectMode(page, 'list');
  await layer(page, 'list').getByRole('button', { name: 'harness-assistant, Otto, open' }).click();
  await expectMode(page, 'session');
  await layer(page, 'session').getByRole('button', { name: 'Close' }).click();
  await expectMode(page, 'handle');
});

test('a bot click opens its session', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await layer(page, 'handle').getByRole('button', { name: /^Pim/ }).click();
  await expectMode(page, 'session');
  await expect(layer(page, 'session')).toContainText('Pim');
});
