import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// The bottom bar of an IDE session tab (design-ux, qitem-20261110083952 and qitem-20261110084837): its « | » only shows with something on
// each side: before it, the model or the context (both optional: none right after a launch, or for a harness that gives none); after
// it, the branch, the terminal, the project or the MR/PR chip. Under 560 px the project goes (v27).
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

const sessions = [
  // No model, no context: nothing before the separator.
  session('zed', { name: 'Zed', project: 'ledge', cwd: '/w/ledge', state: 'working' }),
  session('mia', { name: 'Mia', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'claude-opus-5-5' }),
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', branch: 'fix/ssh', model: 'claude-opus-5-5' })
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

test('a « | » only between two things: none without a model or context before it; between 400 and 560 px none without a branch after it', async ({ page }) => {
  await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });

  // Nothing before it: no separator, the project first.
  await open(page, 'Zed');
  await expect(pane(page, 'Zed').locator('.ide-bar-chip.pj')).toBeVisible();
  await expect(sep(page, 'Zed')).toHaveCount(0);
  // Nor an empty model box: the project starts at the bar's padding, as the model does elsewhere.
  const start = await pane(page, 'Zed').locator('.ide-bar').evaluate(el => { const b = el.getBoundingClientRect(), p = el.querySelector('.ide-bar-chip.pj')!.getBoundingClientRect(); return p.x - b.x - parseFloat(getComputedStyle(el).paddingLeft); });
  expect(start).toBeLessThanOrEqual(1);
  await pane(page, 'Zed').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-nomodel.png' });

  // A model before it, the project after it; under 560 px the project goes, and the separator with it.
  await open(page, 'Mia');
  await expect(sep(page, 'Mia')).toBeVisible();
  await pane(page, 'Mia').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-model.png' });
  await holdPane(page, 'Mia', 480);
  await expect(pane(page, 'Mia').locator('.ide-bar-chip.pj')).toBeHidden();
  await expect(sep(page, 'Mia')).toBeHidden();
  await pane(page, 'Mia').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-nobranch-480.png' });

  await open(page, 'Nova');
  await holdPane(page, 'Nova', 480);
  await expect(pane(page, 'Nova').locator('.ide-bar-chip.br')).toBeVisible();
  await expect(sep(page, 'Nova')).toBeVisible();
  await pane(page, 'Nova').locator('.ide-bar').screenshot({ path: 'e2e/.results/ide-bar-sep-branch-480.png' });
});
