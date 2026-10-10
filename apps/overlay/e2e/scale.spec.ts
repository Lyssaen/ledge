import { test, expect, surface, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const team = () => [session('a'), session('b', { name: 'Pim', project: 'speos-api' }), session('c', { name: 'Ada', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } })];
const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!;

test.describe('4K work area', () => {
  test.use({ viewport: { width: 3840, height: 2160 } });

  test('auto scale renders the handle and the bots at 2x', async ({ page }) => {
    await fakeDaemon(page, team());
    await ready(page, 3);
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', '2');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(56, 0);
    const bots = layer(page, 'handle').getByRole('button');
    await expect.poll(async () => (await box(bots.nth(0))).width).toBeCloseTo(24, 0); // a quiet bot: 12 x 2
    await expect.poll(async () => (await box(bots.nth(2))).width).toBeCloseTo(40, 0); // an ask: 20 x 2
    // Still vertically centered on the real screen.
    const s = await box(surface(page));
    expect(Math.abs(s.y + s.height / 2 - 1080)).toBeLessThan(4);
  });

  test('edge hover works under the zoom; the list stays open under a resting pointer when it changes shape', async ({ page }) => {
    const d = await fakeDaemon(page, team());
    await ready(page, 3);
    await page.mouse.move(3, 200, { steps: 2 });
    await expectMode(page, 'list');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(760, 0);
    // Rest the pointer inside the zoomed list, at a point that unzoomed coordinates would put outside it (x 600 > 380).
    await page.mouse.move(600, 1080, { steps: 4 });
    // A new session grows the list without any pointer event; the sticky hover check must still see the pointer inside,
    // or the mouse-opened list would fold after the 500 ms leave delay.
    d.upsert(session('d', { name: 'Zed' }));
    await expect(layer(page, 'list').getByRole('button', { name: /Zed, open/ })).toBeVisible();
    await page.waitForTimeout(900);
    await expectMode(page, 'list');
    await layer(page, 'list').getByRole('button', { name: 'speos-api, Pim, open' }).click();
    await expectMode(page, 'session');
  });

  test('the bubble is measured in CSS px under the zoom: the surface fits its content exactly', async ({ page }) => {
    const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim' })]);
    await ready(page, 2);
    d.upsert(session('b', { name: 'Pim', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }));
    await expectMode(page, 'bubble');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(336 * 2, 0);
    const content = await box(layer(page, 'bubble'));
    await expect.poll(async () => Math.abs((await box(surface(page))).height - content.height)).toBeLessThanOrEqual(2 * 2 + 2);
  });

  test('Size 150% applies live and is remembered', async ({ page }) => {
    await fakeDaemon(page, team());
    await ready(page, 3);
    await page.keyboard.press('Control+Alt+L');
    await page.locator('[data-coachmark]').getByRole('button', { name: 'Got it' }).click();
    await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
    await expectMode(page, 'settings');
    const auto = layer(page, 'settings').getByRole('radio', { name: 'Auto (200%)' });
    await expect(auto).toBeChecked();
    await layer(page, 'settings').getByText('150%', { exact: true }).click();
    await expect(layer(page, 'settings').getByRole('radio', { name: '150%' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', '1.5');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380 * 1.5, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expectMode(page, 'handle');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(42, 0);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-ui-scale', '1.5');
  });
});

test('at 1920x1080 auto stays at 100%', async ({ page }) => {
  await fakeDaemon(page, team());
  await ready(page, 3);
  await expect(page.locator('html')).toHaveAttribute('data-ui-scale', '1');
  await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(28, 0);
  await expect.poll(async () => (await box(layer(page, 'handle').getByRole('button').nth(0))).width).toBeCloseTo(12, 0);
});
