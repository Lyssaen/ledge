import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet } from './thread';

// The agent's screen is the session's Terminal view, the shells are the right panel's (Fil | Terminal v3); the switch itself
// is session-view-toggle.spec.ts.
test.setTimeout(90_000);
const open = async (page: Page, name: string) => {
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.locator('.session-page')).toBeVisible({ timeout: 20_000 });
};
const panel = (page: Page) => page.getByRole('region', { name: 'Panel: shells and changes' });
const inTerminal = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[data-terminal]'));
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites);
const termWidth = (page: Page) => page.locator('.conversation-workspace').evaluate(el => (el as HTMLElement).style.getPropertyValue('--term-width'));

test('in the agent\'s screen Ledge\'s keys stand down; the panel and its width survive a reload', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects });
  await page.goto('/'); await openAtelier(page);
  await open(page, 'Nova');

  // Ctrl+² on AZERTY is the physical Backquote key: the keyboard goes into the agent's screen.
  expect(await inTerminal(page)).toBe(false);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inTerminal(page)).toBe(true);
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await writes(page)).join('')).toContain('ls\r');

  // Ledge's keys stand down inside the terminal: Ctrl+K reaches it, not the search; O is typed, it does not toggle the panel.
  await page.keyboard.press('Control+k');
  await expect.poll(async () => (await writes(page)).join('')).toContain('\x0b');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('o');
  await expect.poll(async () => (await writes(page)).join('')).toContain('o');
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => inTerminal(page)).toBe(true);

  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-thread-focus'))).toBe(true);

  // The panel and its width survive a reload.
  await page.keyboard.press('o');
  await expect(panel(page)).toBeVisible();
  const before = await termWidth(page);
  await page.getByRole('separator', { name: 'Panel width' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => termWidth(page)).not.toBe(before);
  const width = await termWidth(page);
  expect(width).not.toBe('');
  await page.reload(); await openAtelier(page);
  await open(page, 'Nova');
  await expect(panel(page)).toBeVisible();
  expect(await termWidth(page)).toBe(width);
});
