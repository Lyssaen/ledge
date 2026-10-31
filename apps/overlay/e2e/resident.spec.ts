import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { ISLAND, LINE } from '../src/surface/geometry';
import { fakeDaemon, session } from './daemon';
import { wake } from './scenarios';

test('Ledge stays in the notch without sessions, greets the empty panel, and stays alone as sessions come and go', async ({ page }) => {
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
  await expect(layer(page, 'handle')).toHaveAttribute('data-sessions', '1');
  await expect(layer(page, 'handle').locator('button:not([data-resident])')).toHaveCount(0);
  await expect(resident).toBeVisible();
  daemon.remove('a');
  await expect(layer(page, 'handle')).toHaveAttribute('data-sessions', '0');
  await expect(resident).toBeVisible();
});

test('a waiting session: at rest Ledge’s mark, awake its line in words that size the island; Ledge opens the chat', async ({ page }) => {
  const d = await fakeDaemon(page, [session('a', { name: 'Otto', state: 'idle' })]);
  await ready(page, 1);
  await expect(layer(page, 'handle').locator('[data-dot]')).toHaveCount(0);
  await expect(layer(page, 'handle').locator('[data-ledge-line]')).toHaveCount(0);
  // Hovered first, the ask does not unfold its bubble: the line says it on the island.
  await wake(page);
  d.upsert(session('a', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }));
  const line = layer(page, 'handle').locator('[data-ledge-line]');
  await expect(line).toHaveAttribute('data-kind', 'forYou');
  await expect(line).toContainText('Otto: Run pnpm test');
  await expect(line.locator('[data-counter]')).toHaveText('1');
  // The island is as wide as the mascot and the measured line, nothing for the session itself.
  await expect.poll(async () => {
    const w = (await line.boundingBox())!.width, s = (await surface(page).boundingBox())!.width;
    return Math.abs(s - (ISLAND.padL + ISLAND.resident + LINE.gap + Math.ceil(w) + ISLAND.padR));
  }).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await wake(page);
  await layer(page, 'handle').locator('[data-resident]').click();
  await expectMode(page, 'chat');
});
