import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { hoverHandle } from './scenarios';

test('hovering the handle opens the list; a row click opens the session; Escape goes back, then closes', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  // The top edge far from the island opens nothing; the 10 px band just beside it does, and leaving it folds the list.
  await page.mouse.move(200, 120);
  await page.mouse.move(3, 3, { steps: 4 });
  await page.waitForTimeout(400);
  await expectMode(page, 'handle');
  const s = (await surface(page).boundingBox())!;
  await page.mouse.move(s.x - 20, 4, { steps: 4 });
  await expectMode(page, 'list');
  await page.mouse.move(300, 700, { steps: 3 });
  await expectMode(page, 'handle');
  await hoverHandle(page);
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
  await hoverHandle(page);
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

test('a hover-opened list folds when the pointer leaves; a click outside a keyboard-opened one folds it too', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await hoverHandle(page);
  await expectMode(page, 'list');
  // The list hangs under the island, centred: leave it far below, not beside it.
  await page.mouse.move(300, 700, { steps: 3 });
  await expectMode(page, 'handle');
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'list');
  await page.mouse.click(300, 700);
  await expectMode(page, 'handle');
});
