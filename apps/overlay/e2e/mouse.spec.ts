import { test, expect, layer, expectMode, ready, surface } from './fixtures';
import { filetWidth, islandWidth, ISLAND } from '../src/surface/geometry';
import { fakeDaemon, session } from './daemon';
import { hoverHandle, wake } from './scenarios';

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
  await wake(page);
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

for (const panel of ['1', '1.5', '2']) {
  test(`the peek is as tall as its card at a ${panel} window size: its buttons are never cut off`, async ({ page }) => {
    await page.addInitScript(v => { try { localStorage.setItem('ledge.panelScale', v); } catch { /* ignore */ } }, panel);
    await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api', topic: 'Split the settings view into tabs and keep the machines list' })]);
    await ready(page, 2);
    await wake(page);
    await layer(page, 'handle').getByRole('button', { name: /^Pim/ }).click();
    await expectMode(page, 'peek');
    const bottom = async () => { const s = (await surface(page).boundingBox())!; return s.y + s.height; };
    // The surface grows from the notch: wait until it has settled, then the card's last pixel is inside it.
    await expect.poll(async () => { const a = await bottom(); await page.waitForTimeout(150); return a === await bottom() && a > 40; }).toBe(true);
    const card = (await layer(page, 'peek').boundingBox())!;
    expect(card.y + card.height).toBeLessThanOrEqual(await bottom() + 1);
    expect(card.y + card.height).toBeGreaterThan(await bottom() - 24);
  });
}

test('hovering the filet grows it into the compact island with its robots; leaving rests it again', async ({ page }) => {
  await fakeDaemon(page, [session('a'), session('b', { name: 'Pim', project: 'speos-api' }), session('c', { name: 'Ada' })]);
  await ready(page, 3);
  const handle = layer(page, 'handle');
  await expect(surface(page)).toHaveCSS('width', `${filetWidth([3])}px`);
  await expect(handle.locator('svg.bot')).toHaveCount(0);
  const s = (await surface(page).boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
  await expect(surface(page)).toHaveAttribute('data-awake', 'true');
  await expect(surface(page)).toHaveCSS('width', `${islandWidth(3)}px`);
  await expect(surface(page)).toHaveCSS('height', `${ISLAND.h}px`);
  await expect(handle.locator('svg.bot')).toHaveCount(3);
  await expect(handle.locator('[data-resident] svg').first()).toBeVisible();
  // A robot opens its peek, as a dash does.
  await handle.getByRole('button', { name: /^Pim/ }).click();
  await expectMode(page, 'peek');
  await page.keyboard.press('Escape');
  await expectMode(page, 'handle');
  await page.mouse.move(200, 400);
  await expect(surface(page)).not.toHaveAttribute('data-awake', 'true');
  await expect(surface(page)).toHaveCSS('width', `${filetWidth([3])}px`);
  await expect(handle.locator('svg.bot')).toHaveCount(0);
});
