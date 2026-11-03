import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { wake } from './scenarios';

test('Ledge stays in the notch without sessions, greets the empty panel, and stays alone when sessions come', async ({ page }) => {
  const daemon = await fakeDaemon(page, []);
  await ready(page, 0);
  await expectMode(page, 'handle');
  const resident = layer(page, 'handle').locator('[data-resident]');
  await expect(resident).toBeVisible();
  await expect(resident.locator('[data-ledge-mark]')).toBeVisible();
  await expect(layer(page, 'handle').locator('svg')).toHaveCount(0);

  await wake(page);
  await resident.click();
  await expectMode(page, 'chat');
  await expect(layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
  await expect(layer(page, 'chat').getByRole('button', { name: 'Back to sessions' })).toHaveCount(0);

  // The composer takes the first Escape (it only blurs). The next one folds the chat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  daemon.upsert(session('a'));
  await expect(resident).toHaveAttribute('title', /^1 session/);
  await expect(layer(page, 'handle').locator('button')).toHaveCount(1);
  daemon.remove('a');
  await expect(resident).toHaveAttribute('title', /^No sessions/);
  await expect(resident).toBeVisible();
});

test('at rest Ledge’s mark alone; awake, Ledge alone opens the chat', async ({ page }) => {
  await fakeDaemon(page, [session('a', { name: 'Otto', state: 'idle' })]);
  await ready(page, 1);
  await expect(layer(page, 'handle').locator('button')).toHaveCount(1);
  await wake(page);
  await expect(layer(page, 'handle').locator('svg.bot')).toHaveCount(0);
  await layer(page, 'handle').locator('[data-resident]').click();
  await expectMode(page, 'chat');
});
