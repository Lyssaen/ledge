import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

test('Ledge stays in the notch without sessions, greets the empty panel, and remains beside new dashes', async ({ page }) => {
  const daemon = await fakeDaemon(page, []);
  await ready(page, 0);
  await expectMode(page, 'handle');
  const resident = layer(page, 'handle').locator('[data-resident]');
  await expect(resident).toBeVisible();
  await expect(resident.locator('[data-ledge-mark]')).toBeVisible();
  await expect(layer(page, 'handle').locator('svg')).toHaveCount(0);

  await resident.click();
  await expectMode(page, 'chat');
  await expect(layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
  await expect(layer(page, 'chat').getByRole('button', { name: 'Back to sessions' })).toHaveCount(0);

  // The composer takes the first Escape (it only blurs). The next one folds the chat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  daemon.upsert(session('a'));
  await expect(layer(page, 'handle').locator('button:not([data-resident]):not(:has([data-update-pip]))')).toHaveCount(1);
  await expect(resident).toBeVisible();
  daemon.remove('a');
  await expect(layer(page, 'handle').locator('button:not([data-resident]):not(:has([data-update-pip]))')).toHaveCount(0);
  await expect(resident).toBeVisible();
});

test('a dash peeks at its session; the rectangle opens the chat', async ({ page }) => {
  await fakeDaemon(page, [session('a', { name: 'Otto', state: 'idle' })]);
  await ready(page, 1);
  const dash = layer(page, 'handle').getByRole('button', { name: 'Otto available, open' });
  await expect(dash).toHaveCSS('width', '5px');
  await dash.click();
  await expectMode(page, 'peek');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  await layer(page, 'handle').locator('[data-resident]').click();
  await expectMode(page, 'chat');
});
