import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { ideReady } from './ide';
import { fleet } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
});

// The agent's screen is the session tab's Terminal view, the shells are the IDE's bottom panel (inventory B6: it replaces the old
// right panel of shells and changes); the switch itself is session-view-toggle.spec.ts.
test.setTimeout(90_000);
const open = async (page: Page, name: string) => {
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.locator('.session-page')).toBeVisible({ timeout: 20_000 });
};
const panel = (page: Page) => page.getByRole('region', { name: 'Bottom panel' });
const inTerminal = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[data-terminal]'));
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __ledgePtyWrites: string[] }).__ledgePtyWrites);
const panelHeight = async (page: Page) => Math.round((await panel(page).boundingBox())!.height);

test('in the agent\'s screen Ledge\'s keys stand down; the bottom panel and its height survive a reload', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects });
  await page.goto('/'); await ideReady(page);
  await open(page, 'Nova');

  // Ctrl+² on AZERTY is the physical Backquote key: the keyboard goes into the agent's screen.
  expect(await inTerminal(page)).toBe(false);
  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => inTerminal(page)).toBe(true);
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await writes(page)).join('')).toContain('ls\r');

  // Ledge's keys stand down inside the terminal: Ctrl+K reaches it, not the palette; O is typed.
  await page.keyboard.press('Control+k');
  await expect.poll(async () => (await writes(page)).join('')).toContain('\x0b');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('o');
  await expect.poll(async () => (await writes(page)).join('')).toContain('o');
  await expect.poll(() => inTerminal(page)).toBe(true);

  await page.keyboard.press('Control+Backquote');
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-thread-focus'))).toBe(true);

  // The bottom panel (Ctrl+J) and its height survive a reload: its top edge dragged 80 px up.
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press('Control+j');
  await expect(panel(page)).toBeVisible();
  const before = await panelHeight(page);
  const edge = (await page.locator('.ide-bottom-resize').boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 - 80, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => panelHeight(page)).toBeGreaterThan(before + 40);
  const height = await panelHeight(page);
  await page.reload(); await ideReady(page);
  await expect(panel(page)).toBeVisible();
  expect(await panelHeight(page)).toBe(height);
});
