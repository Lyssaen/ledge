import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

test('Ledge stays in the notch without sessions, greets the empty panel, and remains beside new companions', async ({ page }) => {
  const daemon = await fakeDaemon(page, []);
  await ready(page, 0);
  await expectMode(page, 'handle');
  const resident = layer(page, 'handle').locator('[data-resident]');
  await expect(resident).toBeVisible();
  await expect(resident.locator('svg')).toHaveAttribute('aria-label', 'Ledge');

  await resident.hover();
  await expect(resident.locator('svg')).toHaveAttribute('data-gesture', 'happy');
  await resident.click();
  await expectMode(page, 'chat');
  await expect(layer(page, 'chat').getByRole('textbox', { name: 'Ask Ledge' })).toBeVisible();
  await expect(layer(page, 'chat').getByRole('button', { name: 'Back to sessions' })).toHaveCount(0);

  // The composer takes the first Escape (it only blurs). The next one folds the chat.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  daemon.upsert(session('a'));
  await expect(layer(page, 'handle').locator('button:not([data-resident])')).toHaveCount(1);
  await expect(resident).toBeVisible();
  daemon.remove('a');
  await expect(layer(page, 'handle').locator('button:not([data-resident])')).toHaveCount(0);
  await expect(resident).toBeVisible();
});

test('Ledge follows the pointer near the notch and returns to centre when it leaves', async ({ page }) => {
  await fakeDaemon(page, []);
  await ready(page, 0);
  const face = layer(page, 'handle').locator('[data-resident] svg');
  const box = await face.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width + 56, box!.y + box!.height / 2);
  await expect(face).toHaveAttribute('data-near', 'true');
  await expect.poll(() => face.evaluate(el => (el as SVGSVGElement).style.getPropertyValue('--resident-gx'))).not.toBe('0px');
  await page.mouse.move(500, 500);
  await expect(face).toHaveAttribute('data-near', 'false');
  await expect.poll(() => face.evaluate(el => (el as SVGSVGElement).style.getPropertyValue('--resident-gx'))).toBe('0px');
});
