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
  await page.keyboard.press('Control+j');
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
