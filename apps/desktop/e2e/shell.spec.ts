import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';
import { ideReady, tabOf } from './ide';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

// The shell around the screens, in the IDE: the old top bar's crumbs and project filter are the Atelier tab's bar (inventory B5),
// its « Commande » bar the IDE's title bar (sizes: ide-shell.spec), its search the palette.
const atelierBar = (page: import('@playwright/test').Page) => page.locator('.ide-abar');

test('projects from the daemon in the explorer; a click filters the Atelier tab, its × clears the filter', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await ideReady(page);
  await page.getByRole('tree').getByRole('button', { name: /^ledge/i }).click();
  await expect(page.locator('.ide-dockview .dv-tab').filter({ hasText: 'Atelier' })).toHaveClass(/dv-active-tab/);
  const filter = atelierBar(page).locator('.ide-abar-filter');
  await expect(filter).toContainText('Ledge');
  await filter.getByRole('button', { name: 'Remove the filter: show every project' }).click();
  await expect(filter).toHaveCount(0);
});

test('Ctrl K finds a session by its name and opens its tab', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await ideReady(page);
  await expect(page.getByRole('tree').getByRole('button', { name: /^Luna/ })).toBeVisible();   // the app is up and its keys are bound
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('Luna');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(tabOf(page, 'Luna')).toHaveClass(/dv-active-tab/);
});

test('a stored list preference opens the atelier', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.addInitScript(() => {
    try { localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false })); }
    catch { /* about:blank denies storage; the app page does not */ }
  });
  await page.goto('/'); await ideReady(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveCount(0);
  await page.reload(); await ideReady(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveCount(0);
});

test('Ctrl+/ hides and shows the chat with Ledge', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await ideReady(page);
  const chat = page.locator('.ide-right');
  await expect(chat).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(chat).toHaveCount(0);
  await page.keyboard.press('Control+/');
  await expect(chat).toBeVisible();
});

test('at 1000 px the Atelier bar stays on one line with a long project name, inside the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await fakeDaemon(page, eight, { projects: { projects: [{ id: 'ledge', name: 'Payment Service Platform Migration Europe', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] } });
  await page.goto('/'); await ideReady(page);
  const project = page.getByRole('tree').getByRole('button', { name: /^Payment Service Platform/ });
  const full = 'Payment Service Platform Migration Europe';
  await expect(project).toHaveAttribute('title', `Show only ${full} in the atelier`);
  await project.click();
  const bar = atelierBar(page);
  const name = bar.locator('.ide-abar-filter span[title]');
  await expect(name).toHaveAttribute('title', full);
  // The name fits or ellipsizes, never past the bar.
  expect((await name.boundingBox())!.x + (await name.boundingBox())!.width).toBeLessThanOrEqual((await bar.boundingBox())!.x + (await bar.boundingBox())!.width + 0.5);
  // One line: the bar keeps its height, and no button wraps under another.
  const box = (await bar.boundingBox())!;
  for (const b of await bar.getByRole('button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.y).toBeGreaterThanOrEqual(box.y - 0.5); expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
