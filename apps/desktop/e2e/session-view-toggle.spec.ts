import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet, ottoThread, tool } from './thread';

// Fil | Terminal (docs/mockups/ledge-session-fil-terminal.html, v3): on the left the thread or the agent's own screen, on the
// right the panel (« ± Modifications », then the shells). The e2e build's fake pty echoes what is typed.
const threads = {
  otto: [
    ...ottoThread,
    tool('t6', -7, 'Write', '/w/ledge/docs/guide.md', { turn: 2, files: [{ path: '/w/ledge/docs/guide.md', change: 'add', diff: '+ # Guide' }] })
  ]
};
// Each spec opens the session page and its xterms more than once: more than the default 30 s under load.
test.setTimeout(90_000);

const open = async (page: Page, name: string) => {
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  // The session page's chunk loads on the first visit: under load it can take a while.
  await expect(page.locator('.session-page')).toBeVisible({ timeout: 20_000 });
};
const tab = (page: Page, name: RegExp) => page.getByRole('tablist', { name: 'Session view' }).getByRole('tab', { name });
const agentView = (page: Page) => page.locator('.agent-view');
const panel = (page: Page) => page.getByRole('region', { name: 'Panel: shells and changes' });
const inAgent = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.agent-view [data-terminal]'));
const inPanelShell = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.right-panel [data-terminal]'));
const onThread = (page: Page) => page.evaluate(() => document.activeElement?.hasAttribute('data-thread-focus') ?? false);
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites.join(''));

test('Fil | Terminal: the agent screen full frame, the keyboard follows Ctrl+², the view is remembered', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  await expect(tab(page, /^Thread/)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toBeVisible();

  // Ctrl+² from the thread: the Terminal view, the keyboard straight in the agent's screen; keys reach it.
  await page.locator('.session-thread').focus();
  await page.keyboard.press('Control+Backquote');
  await expect(tab(page, /^Terminal/)).toHaveAttribute('aria-selected', 'true');
  await expect(agentView(page)).toBeVisible();
  await expect.poll(() => inAgent(page)).toBe(true);
  await page.keyboard.type('ls');
  await expect.poll(() => writes(page)).toContain('ls');
  // The reply area is hidden; Otto waits for an approval, so « Thread » carries a badge.
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toHaveCount(0);
  await expect(tab(page, /^Thread/).locator('.view-badge')).toHaveText('1');
  await expect(page.locator('.session-page .pane-heading .term-chip')).toHaveText('wsl');
  await expect(page.locator('.agent-view .terminal-footer')).toContainText('back to the thread');

  // Ctrl+² from the agent's screen: back on the thread, the keyboard with it; the badge goes.
  await page.keyboard.press('Control+Backquote');
  await expect(tab(page, /^Thread/)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => onThread(page)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Reply to the agent' })).toBeVisible();
  await expect(tab(page, /^Thread/).locator('.view-badge')).toHaveCount(0);

  // ← / → on the switch: the other view, the focus on its tab. A click on Terminal hands the keyboard to the screen.
  await tab(page, /^Thread/).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, /^Terminal/)).toBeFocused();
  await expect(agentView(page)).toBeVisible();
  await tab(page, /^Thread/).click();
  await tab(page, /^Terminal/).click();
  await expect.poll(() => inAgent(page)).toBe(true);

  // The view is the same for every session, and survives a reload.
  await page.keyboard.press('Control+Backquote');
  await tab(page, /^Terminal/).click();
  await open(page, 'Nova');
  await expect(tab(page, /^Terminal/)).toHaveAttribute('aria-selected', 'true');
  await page.reload(); await openAtelier(page);
  await open(page, 'Otto');
  await expect(tab(page, /^Terminal/)).toHaveAttribute('aria-selected', 'true');
  await expect(agentView(page)).toBeVisible();
});

test('the right panel: Modifications first, then the shells; O reopens it on the last tab; Ctrl+² from a shell gives the keyboard back to the left view', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  // The keyboard on the page (from the sidebar tree, J / K walk the sessions).
  await page.locator('.session-thread').focus();
  await page.keyboard.press('o');
  // No shell yet: the panel opens on Modifications, with its count and « + ».
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page).getByRole('tab', { name: /^Changes/ })).toContainText('2');
  await expect(panel(page).locator('.file-title code')).toHaveText('src/App.tsx');
  await page.keyboard.press('j');
  await expect(panel(page).locator('.file-title code')).toHaveText('docs/guide.md');
  await page.keyboard.press('k');
  await expect(panel(page).locator('.file-title code')).toHaveText('src/App.tsx');

  // « + » opens a shell, the keyboard in it.
  await panel(page).getByRole('button', { name: 'New shell' }).click();
  await expect(panel(page).getByRole('tab', { name: /^Shell · / })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => inPanelShell(page)).toBe(true);
  await page.keyboard.type('pwd');
  await expect.poll(() => writes(page)).toContain('pwd');
  // J in a shell is typed there, it does not walk the files.
  await page.keyboard.press('j');
  await expect.poll(() => writes(page)).toContain('pwdj');

  // Ctrl+² in a panel shell: the keyboard back to the left view (the thread), which does not change.
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => onThread(page)).toBe(true);
  await expect(tab(page, /^Thread/)).toHaveAttribute('aria-selected', 'true');
  // On Terminal, the same key from the shell goes to the agent's screen.
  await tab(page, /^Terminal/).click();
  await panel(page).getByRole('tab', { name: /^Shell · / }).click();
  await expect.poll(() => inPanelShell(page)).toBe(true);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inAgent(page)).toBe(true);
  await expect(tab(page, /^Terminal/)).toHaveAttribute('aria-selected', 'true');
  // The panel stays the same from one view to the other.
  await expect(panel(page).getByRole('tab', { name: /^Shell · / })).toHaveAttribute('aria-selected', 'true');

  // O hides the panel (from outside a terminal) and reopens it on the tab last used; the top bar's >_ is O.
  await tab(page, /^Thread/).click();
  await page.keyboard.press('o');
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Show the panel: shells and changes' }).click();
  await expect(panel(page).getByRole('tab', { name: /^Shell · / })).toHaveAttribute('aria-selected', 'true');

  // Enlarged, the panel takes the whole width; the left view hides, its switch stays.
  await panel(page).getByRole('button', { name: 'Enlarge the panel' }).click();
  await expect(page.locator('.session-thread')).toBeHidden();
  await expect(tab(page, /^Terminal/)).toBeVisible();
  await panel(page).getByRole('button', { name: 'Shrink the panel' }).click();
  await expect(page.locator('.session-thread')).toBeVisible();

  // Closing the last shell leaves Modifications.
  await panel(page).getByRole('button', { name: /^Close Shell/ }).click();
  await expect(panel(page).getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
});

test('an OMP session has no agent screen: its own text, and « Open a shell » opens one in the panel', async ({ page }) => {
  const omp = fleet.map(s => (s.id === 'nova' ? { ...s, tool: 'omp' as const, backend: 'omp-rpc' as const } : s));
  await fakeDaemon(page, omp, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Nova');
  await page.keyboard.press('Control+Backquote');
  await expect(agentView(page).getByText('Ledge drives Nova itself: it has no agent screen.')).toBeVisible();
  await expect(agentView(page).locator('.terminal-footer')).toContainText('No agent screen');
  // Read only: the key hands the focus to the view's button, never to a screen.
  await expect(agentView(page).getByRole('button', { name: 'Open a shell' })).toBeFocused();
  await expect(page.locator('.session-page .pane-heading .term-chip')).toHaveCount(0);
  await agentView(page).getByRole('button', { name: 'Open a shell' }).click();
  await expect(panel(page).getByRole('tab', { name: /^Shell · / })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => inPanelShell(page)).toBe(true);
});
