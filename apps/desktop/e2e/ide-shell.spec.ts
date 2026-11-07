import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// The assembled IDE shell at the mockup's size (docs/mockups/ledge-ide-interactive.html, v26).
test.use({ viewport: { width: 1920, height: 1080 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

const box = async (l: Locator) => (await l.boundingBox())!;
const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const side = (page: Page) => page.locator('.ide-explorer');

async function boot(page: Page): Promise<void> {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
}

test('the grid has the mockup\'s sizes', async ({ page }) => {
  await boot(page);
  await expect(side(page)).toBeVisible();
  expect((await box(page.locator('.ide-titlebar'))).height).toBe(34);
  expect((await box(page.locator('.ide-status'))).height).toBe(24);
  expect((await box(page.getByRole('navigation', { name: 'Activity bar' }))).width).toBe(48);
  expect((await box(side(page))).width).toBe(248);
  expect((await box(page.locator('.ide-right'))).width).toBe(300);
});

test('dragging the sidebar edge under 150 px collapses it; Ctrl+B gives it back at 248 px', async ({ page }) => {
  await boot(page);
  const edge = await box(page.locator('.ide-resize'));
  const x = edge.x + edge.width / 2, y = edge.y + edge.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 5 });
  await page.mouse.move(48 + 100, y, { steps: 5 });
  await page.mouse.up();
  await expect(side(page)).toHaveCount(0);
  await page.keyboard.press('Control+b');
  await expect(side(page)).toBeVisible();
  expect((await box(side(page))).width).toBe(248);
});

test('Ctrl+J shows the bottom panel, 240 px high', async ({ page }) => {
  await boot(page);
  const bottom = page.getByRole('region', { name: 'Bottom panel' });
  await expect(bottom).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(bottom).toBeVisible();
  expect((await box(bottom)).height).toBe(240);
  // A new shell takes the keyboard (lot 5), and a terminal keeps Ctrl+J for itself: the panel hides from its toggle.
  await page.getByRole('button', { name: 'Bottom panel (Ctrl+J)' }).click();
  await expect(bottom).toHaveCount(0);
});

test('two sessions are two more dockview tabs, named; a click on the first brings its thread back; screenshot', async ({ page }, info) => {
  await boot(page);
  const tree = page.getByRole('tree');
  await tree.getByRole('button', { name: /^Otto/ }).click();
  await tree.getByRole('button', { name: /^Nova/ }).click();
  // The workspace opens on its Atelier tab; each session opened adds its own, titled with its name.
  await expect(tabs(page)).toHaveCount(3);
  await expect(tabs(page).nth(0)).toContainText('Atelier');
  await expect(tabs(page).nth(1)).toContainText('Otto');
  await expect(tabs(page).nth(2)).toContainText('Nova');
  await expect(tabs(page).nth(2)).toHaveClass(/dv-active-tab/);
  await tabs(page).nth(1).click();
  await expect(tabs(page).nth(1)).toHaveClass(/dv-active-tab/);
  await expect(tabs(page).nth(2)).not.toHaveClass(/dv-active-tab/);
  await expect(page.getByRole('tabpanel', { name: 'Otto' }).getByRole('tabpanel', { name: 'Session thread' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('ide-shell.png') });
  await page.screenshot({ path: 'e2e/.results/ide-shell.png' });
});

// The status bar's usage limits (mockup `statusbar()`, `.lmt`, `.limpop`): at the bar's far right, their detail opening above it,
// whole in the window and drawn on top (the bar does not clip it).
test('the usage limits sit at the status bar\'s right end; each one\'s detail opens whole above it', async ({ page }) => {
  const SHOTS = process.env.LEDGE_STATUSBAR_SHOTS;
  const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  const usage = {
    harnesses: [
      { harness: 'claude' as const, account: 'a1b2c3d4e5f6', status: 'ok' as const, readAt: at(-1), windows: [{ kind: 'five_hour' as const, pct: 84, resetsAt: at(130) }, { kind: 'seven_day' as const, pct: 41, resetsAt: at(3000) }, { kind: 'model' as const, model: 'Opus', pct: 71, resetsAt: at(3000) }] },
      { harness: 'cursor' as const, account: 'c0ffee000001', status: 'ok' as const, readAt: at(-1), windows: [{ kind: 'month' as const, pct: 81, resetsAt: at(30_000) }, { kind: 'pool' as const, pool: 'cursor' as const, pct: 41, resetsAt: at(30_000) }, { kind: 'pool' as const, pool: 'other' as const, pct: 100, resetsAt: at(30_000) }] }
    ],
    alerts: [], prefs: { alert: 0.8 }
  };
  await fakeDaemon(page, eight, { projects: twoProjects, usage });
  await page.goto('/');
  const bar = page.locator('.ide-status');
  const limits = bar.locator('.usage-foot');
  await expect(limits).toBeVisible();
  const vw = page.viewportSize()!.width;
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: { x: vw - 960, y: 1080 - 460, width: 960, height: 460 } }); };
  await shot('bar');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/bar-full.png`, clip: { x: 0, y: 1080 - 40, width: vw, height: 40 } });
  const edge = await box(limits);
  expect.soft(vw - (edge.x + edge.width)).toBeLessThanOrEqual(24);
  for (const [name, title] of [['Claude Code', 'claude'], ['Cursor Agent', 'cursor']] as const) {
    await limits.getByRole('button', { name: new RegExp(name) }).click();
    const pop = page.getByRole('dialog', { name: new RegExp(name) });
    await expect(pop).toBeInViewport({ ratio: 1 });
    const p = await box(pop);
    const hit = await page.evaluate(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('.usage-pop'), [p.x + p.width / 2, p.y + p.height / 2]);
    expect(hit).toBe(true);
    await shot(`open-${title}`);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  }
});
