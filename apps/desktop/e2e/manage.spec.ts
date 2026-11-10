import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady, pane, tabOf } from './ide';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

const rex = session('rex', { name: 'Rex', project: 'ledge', cwd: '/w/ledge', state: 'exited', topic: 'Old task' });
const live = session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working' });
const CAN = { version: '0.7.0', install: 'npm' as const, systemd: true, archive: true };

test('archive a finished agent from its seat, undo with Ctrl Z, then archive and reopen it read-only', async ({ page }) => {
  const daemon = await fakeDaemon(page, [live, rex], { projects: twoProjects, daemon: CAN });
  await page.goto('/'); await ideReady(page);
  const seat = page.getByRole('button', { name: /^Rex,/ });
  await expect(seat).toBeVisible();

  // E on the chosen seat archives it at once (a finished agent), with an « Undo » toast; the daemon says it is archived.
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect(seat).toBeFocused();
  await page.keyboard.press('e');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.archive')).toEqual([{ type: 'session.archive', id: 'rex' }]);
  daemon.upsert({ ...rex, archivedAt: new Date().toISOString() });
  await expect(seat).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();

  // Ctrl Z takes it back: session.restore, and the seat is there again.
  await page.keyboard.press('Control+z');
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.restore')).toEqual([{ type: 'session.restore', id: 'rex' }]);
  daemon.upsert(rex);
  await expect(seat).toBeVisible();

  // Its tab open, the right click on its row archives it; the tab stays, read-only, with the banner and no reply field.
  await seat.click();
  await expect(tabOf(page, 'Rex')).toHaveClass(/dv-active-tab/);
  const tab = pane(page, 'Rex');
  await expect(tab.locator('.session-reply')).toBeVisible();
  // The tab hides the atelier's seat: the explorer reveals the open session in its project.
  await page.getByRole('tree', { name: 'Projects, branches and sessions' }).getByRole('button', { name: /^Rex/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.archive').length).toBe(2);
  daemon.upsert({ ...rex, archivedAt: new Date().toISOString() });
  const banner = tab.locator('.archived-banner');
  await expect(banner).toContainText('Archived session');
  await expect(banner).toContainText('the conversation is read-only');
  await expect(tab.locator('.session-reply')).toHaveCount(0);

  await banner.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => daemon.received.filter(m => m.type === 'session.resume')).toEqual([{ type: 'session.resume', id: 'rex' }]);
});
