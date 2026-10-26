import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects, openAtelier } from './daemon';

/** Same capability the manage spec uses: archive, restore, resume and delete are allowed. */
const CAN = { version: '0.7.0', install: 'npm' as const, systemd: true, archive: true };

// listSessions-like: Otto is live, Bix has finished, both filed under Ledge. hideDone (the default) keeps Bix behind « +1 finished ».
const otto = session('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const bix = session('bix', { name: 'Bix', cwd: '/w/ledge', state: 'exited', topic: 'Reread the pull request' });

test('open Otto from the tree, show Bix from +N finished and archive him, reread him in Archives', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, bix], { projects: twoProjects, daemon: CAN });
  await page.goto('/'); await openAtelier(page);
  await expect(page.getByRole('tree', { name: /Projects, branches and sessions/ })).toBeVisible();
  await page.getByRole('tree').getByRole('button', { name: /^Otto/ }).click();
  await expect(page.getByRole('banner').getByText('Otto')).toBeVisible();
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

// #98: a team is one row; in the rail (< 850 px) team and common-table rows hide, as branches and seats do, and the project keeps its swatch.
test('teams in the tree: one row each, hidden in the rail', async ({ page }) => {
  const seat = (id: string, name: string, role: string) => session(id, { name, title: `${name} · ledge`, cwd: '/w/ledge', project: 'ledge', team: 'team-a1b2', role });
  const daemon = await fakeDaemon(page, [seat('nova', 'Nova', 'review'), seat('pim', 'Pim', 'lead'), otto], { projects: twoProjects });
  const T = new Date().toISOString();
  await page.goto('/'); await openAtelier(page);
  daemon.push({ type: 'teams', teams: [{ id: 'team-a1b2', name: 'ledge-dev', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'lead', sessionId: 'pim' }, { role: 'review', sessionId: 'nova' }], createdAt: T, updatedAt: T }] });
  const tree = page.getByRole('tree');
  const team = tree.locator('.st-team');
  await expect(team).toHaveCount(1);
  const name = await team.locator('strong').boundingBox(), tag = await team.locator('.st-main span').boundingBox();
  expect(Math.abs((name!.y + name!.height) - (tag!.y + tag!.height))).toBeLessThan(4);
  if (process.env.LEDGE_RAIL_SHOTS) await page.screenshot({ path: `${process.env.LEDGE_RAIL_SHOTS}/wide.png` });
  await page.setViewportSize({ width: 800, height: 800 });
  await expect(team).toBeHidden();
  await expect(tree.locator('.st-common')).toBeHidden();
  await expect(tree.locator('.st-project').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const rail = await page.locator('aside.sidebar').boundingBox();
  expect(rail!.width).toBeLessThan(90);
  if (process.env.LEDGE_RAIL_SHOTS) await page.screenshot({ path: `${process.env.LEDGE_RAIL_SHOTS}/rail.png` });
});
