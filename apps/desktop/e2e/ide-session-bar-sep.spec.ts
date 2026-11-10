import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// The bottom bar of an IDE session tab (design-ux, qitem-20261110083952): its « | » only shows when something follows it on its left
// side (branch, terminal, project or MR/PR chip). Under 560 px the project goes (v27): a session without a branch keeps nothing there.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

const sessions = [
  session('zed', { name: 'Zed', project: 'ledge', cwd: '/w/ledge', state: 'working' }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/ssh' })
];
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
const sep = (page: Page, name: string) => pane(page, name).locator('.ide-bar .ide-bar-sep');

async function open(page: Page, name: string): Promise<void> {
  await page.locator('.ide-explorer').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(pane(page, name).locator('.ide-bar')).toBeVisible({ timeout: 20_000 });
}
/** The tab's pane held at `w` px: the bar's container queries follow it. */
const holdPane = (page: Page, name: string, w: number) => pane(page, name).locator('.ide-pane').first().evaluate((el, px) => {
  const s = (el as HTMLElement).style; s.width = `${px}px`; s.maxWidth = `${px}px`; s.flex = 'none';
}, w);

test('between 400 and 560 px, a session without a branch has no lone « | »; with a branch it keeps it; wider, the project follows it', async ({ page }) => {
  await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });

  await open(page, 'Zed');
  await expect(sep(page, 'Zed')).toBeVisible();
  await holdPane(page, 'Zed', 480);
  await expect(pane(page, 'Zed').locator('.ide-bar-chip.pj')).toBeHidden();
  await expect(sep(page, 'Zed')).toBeHidden();
  await pane(page, 'Zed').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-nobranch-480.png' });

  await open(page, 'Nova');
  await holdPane(page, 'Nova', 480);
  await expect(pane(page, 'Nova').locator('.ide-bar-chip.br')).toBeVisible();
  await expect(sep(page, 'Nova')).toBeVisible();
  await pane(page, 'Nova').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-branch-480.png' });
});
