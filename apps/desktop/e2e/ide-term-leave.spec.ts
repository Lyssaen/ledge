import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { fleet, ottoThread } from './thread';

// Ledge at the keyboard alone (IDE): Ctrl+Shift+` takes the keyboard out of a terminal onto its group's front tab, without
// changing the view, and back in; Ctrl+1…9 typed in a terminal go to a group. The same from a shell of the bottom panel.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } });
});

const tabOf = (page: Page, name: string) => page.locator('.ide-dockview .dv-tab').filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });
const pane = (page: Page, name: string) => page.getByRole('tabpanel', { name: new RegExp(`^${name}`) });
/** Where the keyboard is: in a terminal, on a dock tab (its name), or elsewhere. */
const keyboardAt = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  if (a?.closest('[data-terminal]')) return a.closest('.ide-bottom, .ide-bpanel, [aria-label="Bottom panel"]') ? 'panel terminal' : 'terminal';
  const tab = a?.closest('.dv-tab');
  return tab ? `tab ${tab.querySelector('.tab-name')?.textContent ?? tab.textContent}` : 'elsewhere';
});

test('Ctrl+Shift+` leaves the terminal for its tab and goes back in; Ctrl+1 from a terminal; a bottom-panel shell too', async ({ page }) => {
  await fakeDaemon(page, fleet, { launcher: ['ledge'], projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
  await page.locator('.ide-explorer').getByRole('button', { name: /^Nova/ }).first().click();
  await expect(pane(page, 'Nova').locator('.session-page')).toBeVisible({ timeout: 20_000 });
  await pane(page, 'Nova').locator('.session-thread').focus();
  await page.keyboard.press('Control+Backquote');
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();
  await expect.poll(() => keyboardAt(page)).toBe('terminal');

  // Out: the keyboard on Nova's tab, the terminal still shown; Ledge's keys work again (? opens the help).
  await page.keyboard.press('Control+Shift+Backquote');
  await expect.poll(() => keyboardAt(page)).toMatch(/^tab Nova/);
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();
  await expect(tabOf(page, 'Nova')).toBeFocused();
  await tabOf(page, 'Nova').screenshot({ path: 'e2e/.results/term-leave-tab.png' });
  await page.locator('.ide-dockview .dv-tabs-and-actions-container').first().screenshot({ path: 'e2e/.results/term-leave-strip.png' });
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Leave the terminal for its tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  await tabOf(page, 'Nova').focus();

  // Back in, the view unchanged.
  await page.keyboard.press('Control+Shift+Backquote');
  await expect.poll(() => keyboardAt(page)).toBe('terminal');
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();

  // Ctrl+1 typed in the terminal: group 1, the keyboard on its tab.
  await page.keyboard.press('Control+Digit1');
  await expect.poll(() => keyboardAt(page)).toMatch(/^tab Nova/);
  await expect(pane(page, 'Nova').locator('.agent-view')).toBeVisible();

  // A shell of the bottom panel: Ctrl+J opens it with the keyboard, Ctrl+Shift+` gives it to the focused group's tab.
  await page.keyboard.press('Control+j');
  await expect.poll(() => keyboardAt(page)).not.toMatch(/^tab/);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-terminal]'))).toBe(true);
  await page.keyboard.press('Control+Shift+Backquote');
  await expect.poll(() => keyboardAt(page)).toMatch(/^tab Nova/);
  await page.screenshot({ path: 'e2e/.results/term-leave-full.png' });
});
