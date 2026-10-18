import { test, expect } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

test('projects from the daemon in the sidebar, a filter from a click, cleared with Escape', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await page.getByRole('button', { name: /^ledge/i }).click();
  await expect(page.getByRole('banner').getByText('ledge', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});

test('Ctrl K finds a session by its task and opens it; Escape comes back', async ({ page }) => {
  await fakeDaemon(page, eight, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('aside.sidebar').getByText('8 agents')).toBeVisible();   // the app is up and its keys are bound
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Luna');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner').getByText('Luna')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('banner').getByText('Atelier')).toBeVisible();
});

test('the view choice survives a reload', async ({ page }) => {
  await fakeDaemon(page, eight);
  await page.goto('/');
  await page.getByRole('tab', { name: 'List' }).click();
  await page.reload();
  await expect(page.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
});

test('at 1000 px the top bar stays on one line with a long project name', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await fakeDaemon(page, eight, { projects: { projects: [{ id: 'ledge', name: 'Payment Service Platform Migration Europe', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] } });
  await page.goto('/');
  await page.locator('aside.sidebar').getByRole('button', { name: /Payment Service Platform/ }).click();   // the atelier's rug names the project too
  const full = 'Payment Service Platform Migration Europe';
  const banner = page.getByRole('banner');
  await expect(banner.getByText(/Payment Service Platform/)).toBeVisible();
  const crumb = banner.locator('.project-filter span[title]');
  await expect(crumb).toHaveAttribute('title', full);
  await expect(page.locator('aside.sidebar .side-project span[title]').first()).toHaveAttribute('title', full);
  expect(await crumb.evaluate(el => el.scrollWidth > el.clientWidth), 'the visible crumb text is clipped').toBe(true);
  const box = await banner.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(57);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
