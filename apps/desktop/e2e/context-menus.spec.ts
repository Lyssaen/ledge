import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { ideReady } from './ide';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

/** Archive, restore, resume and delete are allowed (as in manage.spec). */
const CAN = { version: '0.7.0', install: 'npm' as const, systemd: true, archive: true };
const ARCHIVED_AT = new Date(Date.now() - 60 * 60_000).toISOString();

const otto = session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', state: 'working', topic: 'Wire the list' });
const nia = session('nia', { name: 'Nia', cwd: '/w/ledge', state: 'exited', archivedAt: ARCHIVED_AT, topic: 'Old one' });
const ned = session('ned', { name: 'Ned', cwd: '/w/website', state: 'exited', archivedAt: ARCHIVED_AT, topic: 'Older one' });

test('right click a project › Add a folder…: the editor of that project opens on the folder browser', async ({ page }) => {
  await fakeDaemon(page, [otto], { projects: twoProjects, daemon: CAN, folders: { '/home/me': { parent: '/home', entries: ['Workspace'] } }, home: '/home/me' });
  await page.goto('/'); await ideReady(page);
  const tree = page.getByRole('tree', { name: 'Projects, branches and sessions' });
  await tree.getByRole('button', { name: /^Ledge/ }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Actions for Ledge' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Add a folder…' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Ledge' });
  await expect(editor.getByRole('radiogroup', { name: 'Machine to browse' })).toBeVisible();
});

test('right click Archives › Delete all (2)… › confirm: two session.delete are sent and, once removed, the Archives are empty', async ({ page }) => {
  const daemon = await fakeDaemon(page, [otto, nia, ned], { projects: twoProjects, daemon: CAN });
  await page.goto('/'); await ideReady(page);
  const archives = page.getByRole('region', { name: 'Archives' });
  const header = archives.getByRole('button', { name: /Archives/ });
  await expect(header).toContainText('2');
  await header.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Actions for Archives' }).getByRole('menuitem', { name: 'Delete all (2)…' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Delete these 2 sessions?');
  await confirm.getByRole('button', { name: /Delete/ }).click();
  await expect.poll(() => daemon.received.flatMap(m => (m.type === 'session.delete' ? [m.id] : [])).sort()).toEqual(['ned', 'nia']);
  daemon.remove('nia'); daemon.remove('ned');
  await header.click();
  await expect(archives.getByText('Nothing archived yet.')).toBeVisible();
});
