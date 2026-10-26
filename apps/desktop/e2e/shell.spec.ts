import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects, openAtelier } from './daemon';

test('projects from the daemon in the sidebar, a filter from a click, cleared with Escape', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await page.getByRole('button', { name: /^ledge/i }).click();
  await expect(page.getByRole('banner').getByText('ledge', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});

test('Ctrl K finds a session by its task and opens it; Escape comes back', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await expect(page.locator('aside.sidebar').getByText('8 active')).toBeVisible();   // the app is up and its keys are bound
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Luna');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner').getByText('Luna')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});

test('a stored list preference opens the atelier', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.addInitScript(() => {
    try { localStorage.setItem('desktop.overview', JSON.stringify({ view: 'list', helpers: true, paused: false })); }
    catch { /* about:blank denies storage; the app page does not */ }
  });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveCount(0);
  await page.reload(); await openAtelier(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveCount(0);
});

test('at 520 px the sidebar is hidden and Ctrl+/ opens the chat', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 800 });
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('region', { name: 'Ledge table' })).toBeVisible();
  await expect(page.locator('aside.sidebar')).toBeHidden();
  await page.keyboard.press('Control+/');
  await expect(page.getByRole('complementary', { name: 'Chat Ledge' })).toBeVisible();
});

test('at 1000 px the top bar stays on one line with a long project name', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await fakeDaemon(page, eight, { projects: { projects: [{ id: 'ledge', name: 'Payment Service Platform Migration Europe', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] } });
  await page.goto('/'); await openAtelier(page);
  const project = page.getByRole('tree').getByRole('button', { name: /^Payment Service Platform/ });
  await project.click();   // the atelier's rug names the project too
  const full = 'Payment Service Platform Migration Europe';
  const banner = page.getByRole('banner');
  await expect(banner.getByText(/Payment Service Platform/)).toBeVisible();
  const crumb = banner.locator('.project-filter span[title]');
  await expect(crumb).toHaveAttribute('title', full);
  await expect(project).toHaveAttribute('title', `Show only ${full} in the atelier`);
  expect(await crumb.evaluate(el => el.scrollWidth > el.clientWidth), 'the visible crumb text is clipped').toBe(true);
  const box = await banner.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(57);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the Commande bar is 32 px over the sidebar, without a search field; Ctrl K opens the palette under it', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  const bar = page.getByRole('group', { name: 'Window bar' });
  await expect(page.locator('aside.sidebar').getByText('8 active')).toBeVisible();
  const box = (await bar.boundingBox())!, side = (await page.locator('aside.sidebar').boundingBox())!;
  expect(box.height).toBe(32);
  expect(side.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  await expect(bar.getByRole('button', { name: /Go to a session/ })).toHaveCount(0);
  // The buttons fit in the lower bar: none overflows it.
  for (const b of await bar.getByRole('button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.y).toBeGreaterThanOrEqual(box.y); expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height);
  }
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox')).toBeFocused();
  expect((await page.locator('.modal-backdrop').boundingBox())!.y).toBeGreaterThanOrEqual(32);
});
