import type { Locator, Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, session, twoProjects } from './daemon';

// IDE lot 6 (docs/superpowers/plans/2026-11-08-ide-lot-6-settings-atelier.md): Settings and the Atelier as tabs — Ctrl+, , the
// Atelier tab's bar and gestures, Settings › Workspace › Status bar. At the mockup's size (docs/mockups/ledge-ide-interactive.html, v26).
test.use({ viewport: { width: 1920, height: 1080 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

const SEAT = session('dev1', { name: 'Dex', cwd: '/w/ledge-dev', state: 'idle', rig: { seat: 'dev@ledge-dev', name: 'ledge-dev', role: 'dev' } });
const WITH_HELPERS = eight.map(s => (s.id === 'nova' ? { ...s, helpers: [{ id: 'h1', kind: 'Explore', task: 'Read the relay', state: 'working' as const }] } : s));
const USAGE = {
  harnesses: [{ harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: new Date().toISOString(), windows: [{ kind: 'five_hour', pct: 40, resetsAt: null }] }],
  alerts: [], prefs: { alert: 0.8 }
};

const tabs = (page: Page) => page.locator('.ide-dockview .dv-tab');
const groups = (page: Page) => page.locator('.ide-dockview .dv-groupview');
const abar = (page: Page) => page.locator('.ide-atelier .ide-abar');
const seat = (page: Page, id: string): Locator => page.locator(`.ide-atelier button[data-agent="local:${id}"]`).first();
const activity = (page: Page, name: string) => page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name });

async function boot(page: Page): Promise<void> {
  await fakeDaemon(page, [...WITH_HELPERS, SEAT], { projects: twoProjects, usage: USAGE } as never);
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible();
  await expect(abar(page)).toBeVisible();
}

test('Ctrl+, opens the Settings tab, once, on the section it was left on', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+,');
  await expect(tabs(page).filter({ hasText: 'Settings' })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
  await page.locator('.settings-nav').getByRole('button', { name: 'Workspace', exact: true }).click();
  await activity(page, 'Atelier (tab)').click();
  await expect(abar(page)).toBeVisible();
  await page.keyboard.press('Control+,');
  await expect(tabs(page).filter({ hasText: 'Settings' })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Workspace' })).toBeVisible();
});

test('the Atelier tab: its bar, « Projects | Rigs », the subagents, the filter; a click opens, Ctrl+click opens to the right', async ({ page }) => {
  await boot(page);
  const bar = abar(page);
  // « Projects | Rigs »: the seat has its rig's room, then sits at a project table.
  await expect(bar.getByRole('radio', { name: 'Rigs' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.ide-atelier .rig-room')).not.toHaveCount(0);
  await bar.getByRole('radio', { name: 'Projects' }).click();
  await expect(page.locator('.ide-atelier .rig-room')).toHaveCount(0);
  await bar.getByRole('radio', { name: 'Rigs' }).click();
  await expect(page.locator('.ide-atelier .rig-room')).not.toHaveCount(0);

  // The subagents.
  await expect(page.locator('.ide-atelier .helper-seat')).not.toHaveCount(0);
  await bar.getByRole('button', { name: 'Hide subagents' }).click();
  await expect(page.locator('.ide-atelier .helper-seat')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Show subagents' }).click();
  await expect(page.locator('.ide-atelier .helper-seat')).not.toHaveCount(0);

  // The project filter, set from the explorer, shows in the bar; its cross gives every project back, no tab moves.
  await page.locator('.ide-explorer').getByTitle('Show only Website in the atelier').click();
  await expect(bar).toContainText('Website');
  await expect(seat(page, 'nova')).toHaveCount(0);
  await bar.getByRole('button', { name: 'Remove the filter: show every project' }).click();
  await expect(bar).not.toContainText('Website');
  await expect(seat(page, 'nova')).toBeVisible();
  await expect(tabs(page)).toHaveCount(1);

  // A click opens the session in the active group; Ctrl+click opens another to the right.
  await seat(page, 'nova').click();
  await expect(tabs(page).filter({ hasText: 'Nova' })).toHaveCount(1);
  await expect(groups(page)).toHaveCount(1);
  await activity(page, 'Atelier (tab)').click();
  await seat(page, 'pim').click({ modifiers: ['Control'] });
  await expect(groups(page)).toHaveCount(2);
  await expect(groups(page).nth(1).locator('.dv-tab')).toContainText('Pim');
});

test('Ledge’s desk opens the chat in the right panel', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.ide-right')).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(page.locator('.ide-right')).toHaveCount(0);
  await page.locator('.ide-atelier').getByRole('button', { name: /desk|Ledge/ }).first().click();
  await expect(page.locator('.ide-right')).toBeVisible();
});

test('Settings › Workspace › Status bar: the limits hidden and shown, the alert stepped', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.ide-status .usage-foot')).toBeVisible();
  await page.keyboard.press('Control+,');
  await page.locator('.settings-nav').getByRole('button', { name: 'Workspace', exact: true }).click();
  const card = page.locator('.settings-page, .set-page, main').filter({ has: page.getByRole('heading', { name: 'Status bar' }) }).first();
  await page.getByRole('checkbox', { name: 'Accounts’ usage limits' }).uncheck();
  await expect(page.locator('.ide-status .usage-foot')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Accounts’ usage limits' }).check();
  await expect(page.locator('.ide-status .usage-foot')).toBeVisible();
  const alert = page.getByRole('group', { name: 'Alert at' });
  await expect(alert).toContainText('80');
  await page.getByRole('button', { name: 'Raise the alert threshold by 5 %' }).click();
  // The daemon keeps it and sends it back: the row shows what it holds.
  await expect(alert).toContainText('85');
  await card.screenshot({ path: 'e2e/.results/ide-lot6-status-bar.png' });
});

test('captures: the Atelier bar, and the Atelier and Settings in narrow groups (for design-ux)', async ({ page }) => {
  await boot(page);
  await abar(page).screenshot({ path: 'e2e/.results/ide-lot6-abar.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await abar(page).screenshot({ path: 'e2e/.results/ide-lot6-abar-dark.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  // Settings to the right of the Atelier: two groups; the window narrowed to put the Atelier near 720 px, then 480 px.
  await page.keyboard.press('Control+\\');
  await page.keyboard.press('Control+,');
  await expect(groups(page)).toHaveCount(2);
  for (const width of [720, 480]) {
    await page.setViewportSize({ width: 48 + 248 + 300 + width * 2, height: 1080 });
    await page.waitForTimeout(300);
    await groups(page).nth(0).screenshot({ path: `e2e/.results/ide-lot6-atelier-${width}.png` });
    await groups(page).nth(1).screenshot({ path: `e2e/.results/ide-lot6-settings-${width}.png` });
  }
  // Nothing scrolls the page sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
