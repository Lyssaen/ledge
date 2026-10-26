import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet, ottoThread } from './thread';

const open = async (page: Page, name: string) => { await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click(); };
const pane = (page: Page) => page.getByRole('region', { name: 'Terminal' });
const inTerminal = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[data-terminal]'));
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites);
const termWidth = (page: Page) => page.locator('.conversation-workspace').evaluate(el => (el as HTMLElement).style.getPropertyValue('--term-width'));

test('O shows the terminal, the keyboard goes to it and back, keys reach the shell', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Nova');
  await expect(page.locator('.session-page')).toBeVisible();
  await page.keyboard.press('o');
  await expect(pane(page)).toBeVisible();
  await expect(pane(page).getByRole('tab', { name: 'Nova · agent' })).toBeVisible();

  // Ctrl+² on AZERTY is the physical Backquote key: the keyboard goes into the xterm.
  expect(await inTerminal(page)).toBe(false);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inTerminal(page)).toBe(true);
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await writes(page)).join('')).toContain('ls\r');

  // Ledge's keys stand down inside the terminal: Ctrl+K reaches the shell, not the search.
  await page.keyboard.press('Control+k');
  await expect.poll(async () => (await writes(page)).join('')).toContain('\x0b');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => inTerminal(page)).toBe(true);

  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-thread-focus'))).toBe(true);

  await pane(page).getByRole('button', { name: 'New shell' }).click();
  await expect(pane(page).getByRole('tab', { name: /^Shell 2 · / })).toBeVisible();

  // The pane and its width survive a reload.
  const before = await termWidth(page);
  await page.getByRole('separator', { name: 'Terminal width' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => termWidth(page)).not.toBe(before);
  const width = await termWidth(page);
  expect(width).not.toBe('');
  await page.reload();
  await open(page, 'Nova');
  await expect(pane(page)).toBeVisible();
  expect(await termWidth(page)).toBe(width);
});

test('with Changes hiding the thread, Ctrl+² from the terminal lands on the session panel', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Otto');
  await expect(page.locator('.session-page')).toBeVisible();
  await page.getByRole('tab', { name: /^Changes/ }).click();
  await page.keyboard.press('o');
  await expect(pane(page)).toBeVisible();
  expect(await inTerminal(page)).toBe(false);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inTerminal(page)).toBe(true);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('session-body'))).toBe(true);
});
