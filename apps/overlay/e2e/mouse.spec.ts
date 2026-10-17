import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { hoverHandle } from './scenarios';

test('hovering the top edge or the handle does not open a panel', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await page.mouse.move(200, 120);
  await page.mouse.move(3, 3, { steps: 4 });
  await page.waitForTimeout(400);
  await expectMode(page, 'handle');
  const s = (await surface(page).boundingBox())!;
  await page.mouse.move(s.x - 20, 4, { steps: 4 });
  await page.waitForTimeout(400);
  await expectMode(page, 'handle');
  await hoverHandle(page);
  await page.waitForTimeout(400);
  await expectMode(page, 'handle');
});

test('a bot click opens a peek; Open in Ledge notes the session; Escape folds', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api', topic: 'Split the settings view' })]);
  await ready(page, 2);
  await layer(page, 'handle').getByRole('button', { name: /^Pim/ }).click();
  await expectMode(page, 'peek');
  const peek = layer(page, 'peek');
  await expect(peek).toContainText('Pim');
  await expect(peek).toContainText('Split the settings view');
  await peek.getByRole('button', { name: 'Open in Ledge' }).click();
  await expect(page.getByRole('status')).toContainText('Opening Pim in Ledge Desktop');
  await expectMode(page, 'peek');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
});

test('a click outside a keyboard-opened chat folds it', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' })]);
  await ready(page, 2);
  await page.keyboard.press('Control+Alt+L');
  await expectMode(page, 'chat');
  await expect(layer(page, 'chat').getByRole('button', { name: 'Back to sessions' })).toHaveCount(0);
  await page.mouse.click(300, 700);
  await expectMode(page, 'handle');
});
