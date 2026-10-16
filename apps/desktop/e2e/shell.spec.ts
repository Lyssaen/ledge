import type { Projects } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { eight, fakeDaemon } from './daemon';

const twoProjects: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'website', name: 'Website', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/website' }] }
  ],
  rules: []
};

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
  await page.getByRole('button', { name: /Payment Service Platform/ }).click();
  const box = await page.getByRole('banner').boundingBox();
  expect(box!.height).toBeLessThanOrEqual(57);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
