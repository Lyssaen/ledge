import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, fakeRemote, twoProjects } from './daemon';
import { ideReady, openSession, pane, tabOf } from './ide';
import { fleet, ottoThread, tool } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

// Fil | Terminal in the IDE (inventory B6): a session tab shows its thread or the agent's own screen (Ctrl+², the tab menu), the
// shells are the bottom panel's; the old page's view switch and right panel are gone. The e2e build's fake pty echoes what is typed.
const threads = {
  otto: [
    ...ottoThread,
    tool('t6', -7, 'Write', '/w/ledge/docs/guide.md', { turn: 2, files: [{ path: '/w/ledge/docs/guide.md', change: 'add', diff: '+ # Guide' }] })
  ]
};
// Each spec opens the session page and its xterms more than once: more than the default 30 s under load.
test.setTimeout(90_000);

const agentView = (page: Page, name: string) => pane(page, name).locator('.agent-view');
const reply = (page: Page, name: string) => pane(page, name).getByRole('textbox', { name: 'Reply to the agent' });
const bottom = (page: Page) => page.getByRole('region', { name: 'Bottom panel' });
const inAgent = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.agent-view [data-terminal]'));
const inPanelShell = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.ide-bottom [data-terminal]'));
const onThread = (page: Page) => page.evaluate(() => document.activeElement?.hasAttribute('data-thread-focus') ?? false);
const opens = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyOpens: { argv: string[]; native?: string }[] }).__ledgePtyOpens);
const panelText = (page: Page) => bottom(page).locator('[data-terminal]').last().evaluate(el => (el as unknown as { __ledgeTermText?: string }).__ledgeTermText ?? '');
// The menu's default is PowerShell: OMP's « Open a shell » must not take it, it opens the session's own shell.
const lastShellPowerShell = (page: Page) => page.addInitScript(() => {
  (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false };
  try { localStorage.setItem('ledge.ide.lastShell', 'powershell'); } catch { /* ignore */ }
});
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites.join(''));

test('Fil | Terminal: Ctrl+² puts the agent screen in the tab with the keyboard in it, and brings the thread back', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await ideReady(page);
  await openSession(page, 'Otto');
  await expect(reply(page, 'Otto')).toBeVisible();

  // Ctrl+² from the thread: the Terminal view, the keyboard straight in the agent's screen; keys reach it.
  await pane(page, 'Otto').locator('.session-thread').focus();
  await page.keyboard.press('Control+Backquote');
  await expect(agentView(page, 'Otto')).toBeVisible();
  await expect(tabOf(page, 'Otto').locator('.tab-term')).toHaveText('>_');
  await expect.poll(() => inAgent(page)).toBe(true);
  await page.keyboard.type('ls');
  await expect.poll(() => writes(page)).toContain('ls');
  // The reply area is hidden with the thread.
  await expect(reply(page, 'Otto')).toHaveCount(0);

  // Ctrl+² from the agent's screen: back on the thread, the keyboard with it.
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => onThread(page)).toBe(true);
  await expect(reply(page, 'Otto')).toBeVisible();
  await expect(tabOf(page, 'Otto').locator('.tab-term')).toHaveCount(0);
});

test('a bottom-panel shell keeps its keys (J is typed); Ctrl+² from it gives the keyboard back to the tab\'s view, thread or agent screen', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false }; });
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await ideReady(page);
  await openSession(page, 'Otto');
  await page.keyboard.press('Control+j');
  await expect(bottom(page)).toBeVisible();
  await bottom(page).getByRole('button', { name: 'New terminal' }).click();
  await page.getByRole('menu').getByRole('menuitem').first().click();
  await expect.poll(() => inPanelShell(page)).toBe(true);
  await page.keyboard.type('pwd');
  await expect.poll(() => writes(page)).toContain('pwd');
  // J in a shell is typed there, it does not walk anything.
  await page.keyboard.press('j');
  await expect.poll(() => writes(page)).toContain('pwdj');

  // Ctrl+² in a panel shell: the keyboard back to the tab's view (the thread), which does not change.
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => onThread(page)).toBe(true);
  await expect(reply(page, 'Otto')).toBeVisible();
  // On Terminal, the same key from the shell goes to the agent's screen.
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inAgent(page)).toBe(true);
  await bottom(page).locator('.ide-btile-screen:not([hidden]) [data-terminal]').click();
  await expect.poll(() => inPanelShell(page)).toBe(true);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inAgent(page)).toBe(true);
  await expect(agentView(page, 'Otto')).toBeVisible();
});

test('an OMP session has no agent screen: its own text, and « Open a shell » opens one in the bottom panel', async ({ page }) => {
  await lastShellPowerShell(page);
  const omp = fleet.map(s => (s.id === 'nova' ? { ...s, tool: 'omp' as const, backend: 'omp-rpc' as const } : s));
  await fakeDaemon(page, omp, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await ideReady(page);
  await openSession(page, 'Nova');
  await pane(page, 'Nova').locator('.session-thread').focus();
  await page.keyboard.press('Control+Backquote');
  const view = agentView(page, 'Nova');
  await expect(view.getByText('Ledge drives Nova itself: it has no agent screen.')).toBeVisible();
  // Read only: the key hands the focus to the view's button, never to a screen.
  await expect(view.getByRole('button', { name: 'Open a shell' })).toBeFocused();
  await view.getByRole('button', { name: 'Open a shell' }).click();
  await expect(bottom(page)).toBeVisible();
  await expect.poll(() => inPanelShell(page)).toBe(true);
  // WSL in the session's folder (not the menu's PowerShell), its first line saying so.
  const shell = (await opens(page)).at(-1)!;
  expect(shell.native).toBeUndefined();
  expect(shell.argv.at(-1)).toContain("cd '/w/ledge'");
  await expect.poll(() => panelText(page)).toContain('Shell opened in Nova’s folder: /w/ledge');
});

test('an OMP session of a machine reached over SSH: « Open a shell » opens it on that machine, in its folder', async ({ page }) => {
  await lastShellPowerShell(page);
  const local = fleet.filter(s => s.id !== 'nova');
  const nova = fleet.find(s => s.id === 'nova')!;
  await fakeDaemon(page, local, { launcher: ['ledge'], projects: twoProjects, threads, machines: [{ id: 'local', label: 'Local' }, { id: 'devbox', label: 'Devbox', ssh: 'devbox' }] });
  await fakeRemote(page, 'devbox', [{ ...nova, tool: 'omp' as const, backend: 'omp-rpc' as const, cwd: '/srv/ledge' }]);
  await page.goto('/'); await ideReady(page);
  await openSession(page, 'Nova');
  await pane(page, 'Nova').locator('.session-thread').focus();
  await page.keyboard.press('Control+Backquote');
  await agentView(page, 'Nova').getByRole('button', { name: 'Open a shell' }).click();
  await expect.poll(() => inPanelShell(page)).toBe(true);
  const shell = (await opens(page)).at(-1)!;
  expect(shell.native).toBeUndefined();
  expect(shell.argv.slice(0, 4)).toEqual(['ssh', '-t', '--', 'devbox']);
  expect(shell.argv.at(-1)).toContain("cd '/srv/ledge'");
  await expect.poll(() => panelText(page)).toContain('Shell on Devbox, in Nova’s folder: /srv/ledge');
});
