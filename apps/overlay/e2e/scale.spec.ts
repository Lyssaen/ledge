import { test, expect, surface, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

const team = () => [session('a'), session('b', { name: 'Pim', project: 'speos-api' }), session('c', { name: 'Ada', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } })];
const box = async (l: import('@playwright/test').Locator) => (await l.boundingBox())!;
const storeScales = (page: import('@playwright/test').Page, s: { handle?: string; panel?: string }) =>
  page.addInitScript(v => { try { if (v.handle) localStorage.setItem('ledge.handleScale', v.handle); if (v.panel) localStorage.setItem('ledge.panelScale', v.panel); } catch { /* ignore */ } }, s);

test.describe('4K work area', () => {
  test.use({ viewport: { width: 3840, height: 2160 } });

  test('both on Auto: the handle and its bots at 2x, the windows at their base size', async ({ page }) => {
    await fakeDaemon(page, team());
    await ready(page, 3);
    await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '2');
    await expect(page.locator('html')).toHaveAttribute('data-panel-scale', '1');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(56, 0);
    const bots = layer(page, 'handle').getByRole('button');
    await expect.poll(async () => (await box(bots.nth(0))).width).toBeCloseTo(24, 0); // a quiet bot: 12 x 2
    await expect.poll(async () => (await box(bots.nth(2))).width).toBeCloseTo(40, 0); // an ask: 20 x 2
    // Still vertically centered on the real screen.
    const s = await box(surface(page));
    expect(Math.abs(s.y + s.height / 2 - 1080)).toBeLessThan(4);
    // The list opens at its base 380 px.
    await page.keyboard.press('Control+Alt+L');
    await expectMode(page, 'list');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380, 0);
    await expect.poll(async () => (await box(layer(page, 'list').locator('[data-row]').first())).height).toBeCloseTo(58, 0);
  });

  test('edge hover works on the 2x handle bands; the list stays open under a resting pointer when it changes shape', async ({ page }) => {
    const d = await fakeDaemon(page, team());
    await ready(page, 3);
    await page.mouse.move(3, 200, { steps: 2 });
    await expectMode(page, 'list');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380, 0);
    await page.mouse.move(300, 1080, { steps: 4 });
    // A new session grows the list without any pointer event; the sticky hover check must still see the pointer inside,
    // or the mouse-opened list would fold after the 500 ms leave delay.
    d.upsert(session('d', { name: 'Zed' }));
    await expect(layer(page, 'list').getByRole('button', { name: /Zed, open/ })).toBeVisible();
    await page.waitForTimeout(900);
    await expectMode(page, 'list');
    await layer(page, 'list').getByRole('button', { name: 'speos-api, Pim, open' }).click();
    await expectMode(page, 'session');
  });

  test('windows at 150 %: the bubble is measured in its own CSS px and the surface fits its content exactly', async ({ page }) => {
    await storeScales(page, { panel: '1.5' });
    const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim' })]);
    await ready(page, 2);
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(56, 0); // the handle keeps its Auto 200 %
    d.upsert(session('b', { name: 'Pim', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }));
    await expectMode(page, 'bubble');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(336 * 1.5, 0);
    const content = await box(layer(page, 'bubble'));
    await expect.poll(async () => Math.abs((await box(surface(page))).height - content.height)).toBeLessThanOrEqual(2 * 1.5 + 2);
    // The bubble's actions take real clicks under the zoom.
    await layer(page, 'bubble').getByRole('button', { name: 'Approve' }).click();
    await expect(layer(page, 'bubble')).toHaveAttribute('data-ack', 'pending');
  });

  test('Settings: handle Auto (200%) and windows Auto (100%); each size changes on its own, live, and is remembered', async ({ page }) => {
    await fakeDaemon(page, team());
    await ready(page, 3);
    await page.keyboard.press('Control+Alt+L');
    await page.locator('[data-coachmark]').getByRole('button', { name: 'Got it' }).click();
    await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
    await expectMode(page, 'settings');
    const settings = layer(page, 'settings');
    const handle = settings.getByRole('group', { name: 'Handle size' }); const windows = settings.getByRole('group', { name: 'Window size' });
    await expect(handle.getByRole('radio', { name: 'Auto (200%)' })).toBeChecked();
    await expect(windows.getByRole('radio', { name: 'Auto (100%)' })).toBeChecked();
    // Handle to 150 %: the opened settings keep their size.
    await handle.getByText('150%', { exact: true }).click();
    await expect(handle.getByRole('radio', { name: '150%', exact: true })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '1.5');
    await expect(page.locator('html')).toHaveAttribute('data-panel-scale', '1');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380, 0);
    // Windows to 100 % explicitly (already the Auto value here): still 380 px, the handle stays at 150 %.
    await windows.getByText('100%', { exact: true }).click();
    await expect(windows.getByRole('radio', { name: '100%', exact: true })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '1.5');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expectMode(page, 'handle');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(42, 0); // 28 x 1.5
    // Windows to 125 % from the list: the list grows, the handle does not.
    await page.keyboard.press('Control+Alt+L');
    await layer(page, 'list').getByRole('button', { name: 'Settings' }).click();
    await windows.getByText('125%', { exact: true }).click();
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(380 * 1.25, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(42, 0);
    expect(await page.evaluate(() => [localStorage.getItem('ledge.handleScale'), localStorage.getItem('ledge.panelScale')])).toEqual(['1.5', '1.25']);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '1.5');
    await expect(page.locator('html')).toHaveAttribute('data-panel-scale', '1.25');
  });

  test('a stored single Size from an older version applies to both', async ({ page }) => {
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('migrated')) { localStorage.setItem('ledge.uiScale', '1.25'); sessionStorage.setItem('migrated', '1'); } } catch { /* ignore */ } });
    await fakeDaemon(page, team());
    await ready(page, 3);
    await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '1.25');
    await expect(page.locator('html')).toHaveAttribute('data-panel-scale', '1.25');
    expect(await page.evaluate(() => localStorage.getItem('ledge.uiScale'))).toBeNull();
  });
});

test('at 1920x1080 both Autos stay at 100%', async ({ page }) => {
  await fakeDaemon(page, team());
  await ready(page, 3);
  await expect(page.locator('html')).toHaveAttribute('data-handle-scale', '1');
  await expect(page.locator('html')).toHaveAttribute('data-panel-scale', '1');
  await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(28, 0);
  await expect.poll(async () => (await box(layer(page, 'handle').getByRole('button').nth(0))).width).toBeCloseTo(12, 0);
});
