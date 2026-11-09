import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, fakeRemote, session } from './daemon';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

// Desktop is Ledge 0.6.0 (the e2e build's stand-in for the app's version): the daemons of the connected machines follow it (#48).
const desktopIs = (page: Page, v: string) => page.addInitScript(version => { (window as unknown as { __ledgeAppVersion?: string }).__ledgeAppVersion = version; }, v);

test('a connected machine whose daemon is behind Desktop is updated on its own: « Connecting… » in Settings › Machines while it restarts, never offline, then up to date in About', async ({ page }) => {
  await desktopIs(page, '0.6.0');
  const local = await fakeDaemon(page, [session('otto')], {
    machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }],
    daemon: { version: '0.6.0', install: 'npm', systemd: true }
  });
  const remote = await fakeRemote(page, 'devbox', [], { daemon: { version: '0.5.0', install: 'npm', systemd: true } });
  await page.goto('/');
  // The IDE has no machine list in its sidebar: a machine's connection is in Settings › Machines.
  await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Control+Comma');
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await sections.getByRole('button', { name: /^Machines/ }).click();
  const devbox = page.getByRole('article', { name: 'Devbox' }).locator('.set-status');
  await expect(devbox).toHaveText('Connected');

  // Sent once, to the machine behind only; the local daemon is already at Desktop's version.
  await expect.poll(() => remote.received.filter(m => m.type === 'update.daemon')).toEqual([{ type: 'update.daemon', version: '0.6.0' }]);
  expect(local.received.filter(m => m.type === 'update.daemon')).toEqual([]);
  remote.push({ type: 'update.progress', version: '0.6.0', step: 'restarting' });

  // The daemon restarts: the machine is away, said connecting, never offline.
  remote.close();
  await expect(devbox).toHaveText('Connecting…');
  await expect(devbox).toHaveClass(/connecting/);

  // Back with Desktop's version: connected again, the log says it is up to date, nothing sent twice.
  remote.reopen([], { version: '0.6.0', install: 'npm', systemd: true });
  await expect(devbox).toHaveText('Connected');
  await sections.getByRole('button', { name: /^About/ }).click();
  await expect(page.getByRole('list', { name: 'Daemon log · Devbox' }).getByRole('listitem')).toHaveText([
    'Automatic update of the daemon of Devbox: 0.6.0', 'Restarting the daemon…', 'Daemon up to date: 0.6.0'
  ]);
  await expect(page.getByText('Update needed')).toHaveCount(0);
  expect(remote.received.filter(m => m.type === 'update.daemon')).toHaveLength(1);
});
