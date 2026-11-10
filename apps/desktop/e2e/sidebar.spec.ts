import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

// The first tests of a run pay Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);
/** The IDE is up on its Atelier tab, the agents seated. */
async function booted(page: Page) {
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.ide-atelier button[data-agent]').first()).toBeVisible({ timeout: 15_000 });
}

/** Same capability the manage spec uses: archive, restore, resume and delete are allowed. */
const CAN = { version: '0.7.0', install: 'npm' as const, systemd: true, archive: true };

// listSessions-like: Otto is live, Bix has finished, both filed under Ledge. hideDone (the default) keeps Bix behind « +1 finished ».
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const bix = session('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', topic: 'Reread the pull request' });

test('open Otto from the tree, show Bix from +N finished and archive him, reread him in Archives', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, bix], { projects: twoProjects, daemon: CAN });
  await page.goto('/'); await booted(page);
  await expect(page.getByRole('tree', { name: /Projects, branches and sessions/ })).toBeVisible();
  await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).click();
  // Otto opens in a tab, in front.
  await expect(page.locator('.ide-dockview .dv-tab.dv-active-tab')).toHaveText(/Otto/);
  await page.getByRole('button', { name: /\+1 finished/ }).click();
  // The row's archive icon only shows on hover; E on the focused row is the same action.
  await page.getByRole('tree').getByRole('button', { name: /^Bix/ }).focus();
  await page.keyboard.press('e');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.archive')).toEqual([{ type: 'session.archive', id: 'bix' }]);
  // The fake daemon records the message; the fleet only files Bix once it broadcasts archivedAt, as manage.spec does.
  daemon.upsert({ ...bix, archivedAt: new Date().toISOString() });
  await page.getByRole('button', { name: /Archives/ }).click();
  await page.getByRole('button', { name: /Reread Bix/ }).click();
  // The toast region is always a status (« Bix is archived. »). The banner is the one that names the archived session.
  await expect(page.getByRole('status').filter({ hasText: /Archived session/ })).toContainText(/Archived session/);
});

// #98: in the rail (< 850 px) branch and session rows hide, and the project keeps its swatch.
// The IDE's explorer has no rail: at 800 px it keeps its width (247 px), the activity bar and Ctrl+B fold it instead. Not
// replaced by a decision and not in the IDE's mockups: left for design-ux and the lead (lot 12a), not rewritten.
test.fixme('the tree in the rail', async ({ page }) => {
  await fakeDaemon(page, [otto], { projects: twoProjects });
  await page.goto('/'); await booted(page);
  const tree = page.getByRole('tree');
  if (process.env.LEDGE_RAIL_SHOTS) await page.screenshot({ path: `${process.env.LEDGE_RAIL_SHOTS}/wide.png` });
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(tree.locator('.st-project').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const rail = await page.locator('aside.sidebar').boundingBox();
  expect(rail!.width).toBeLessThan(90);
  if (process.env.LEDGE_RAIL_SHOTS) await page.screenshot({ path: `${process.env.LEDGE_RAIL_SHOTS}/rail.png` });
});
