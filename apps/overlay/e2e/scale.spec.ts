import { test, expect, surface, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { hoverHandle } from './scenarios';
import { islandWidth } from '../src/surface/geometry';

const team = () => [session('a'), session('b', { name: 'Pim', project: 'speos-api' }), session('c', { name: 'Ada' })];
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
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(islandWidth(3) * 2, 0);
    const bots = layer(page, 'handle').locator('button:not([data-resident])');
    await expect.poll(async () => (await box(bots.nth(0))).width).toBeCloseTo(44, 0); // a companion: 22 x 2
    await expect.poll(async () => (await box(bots.nth(2))).width).toBeCloseTo(44, 0);
    // Still on the top edge, centred on the real screen. Hovering it does not open a panel.
    const s = await box(surface(page));
    expect(s.y).toBe(0); expect(Math.abs(s.x + s.width / 2 - 1920)).toBeLessThan(4);
    await hoverHandle(page);
    await page.waitForTimeout(400);
    await expectMode(page, 'handle');
  });

  test('hovering the 2x handle leaves it folded while a new companion arrives', async ({ page }) => {
    const d = await fakeDaemon(page, team());
    await ready(page, 3);
    await hoverHandle(page);
    await page.mouse.move(1920, 200, { steps: 4 });
    d.upsert(session('d', { name: 'Zed' }));
    await expect(layer(page, 'handle').getByRole('button', { name: /Zed/ })).toBeVisible();
    await page.waitForTimeout(900);
    await expectMode(page, 'handle');
  });

  test('windows at 150 %: the bubble is measured in its own CSS px and the surface fits its content exactly', async ({ page }) => {
    await storeScales(page, { panel: '1.5' });
    const d = await fakeDaemon(page, [session('a'), session('b', { name: 'Pim' })]);
    await ready(page, 2);
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(islandWidth(2) * 2, 0); // the island keeps its Auto 200 %
    d.upsert(session('b', { name: 'Pim', state: 'waiting_permission', pending: { kind: 'permission', text: 'Run pnpm test', source: 'hook' } }));
    await expectMode(page, 'bubble');
    await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(440 * 1.5, 0);
    const content = await box(layer(page, 'bubble'));
    await expect.poll(async () => Math.abs((await box(surface(page))).height - content.height)).toBeLessThanOrEqual(2 * 1.5 + 2);
    // The bubble's actions take real clicks under the zoom.
    await layer(page, 'bubble').getByRole('button', { name: 'Approve' }).click();
    await expect(layer(page, 'bubble')).toHaveAttribute('data-ack', 'pending');
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
  await expect.poll(async () => (await box(surface(page))).width).toBeCloseTo(islandWidth(3), 0);
  await expect.poll(async () => (await box(layer(page, 'handle').locator('button:not([data-resident])').nth(0))).width).toBeCloseTo(22, 0);
});
