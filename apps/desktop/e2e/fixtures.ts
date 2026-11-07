import { test as base, expect, type Page } from '@playwright/test';

/** Opens the New project dialog from Settings › Projects (same dialog as the explorer's +). */
export async function openNewProject(page: Page): Promise<void> {
  await page.keyboard.press('Control+Comma');
  await expect(page.getByRole('heading', { level: 1, name: 'General' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Projects/ }).click();
  const card = page.locator('section.set-card').filter({ has: page.getByRole('heading', { level: 2, name: 'Projects' }) });
  await card.getByRole('button', { name: 'New project' }).click();
}

/** Every spec runs in English (stored before the app boots) and any console or page error fails the test (spec §12). */
export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    await page.addInitScript(() => { try { localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    // Quiesce the app before the page is torn down. Playwright 1.49.1 WebSocketRoute teardown race: a daemon that stays down keeps the fleet
    // redialling every 200-500 ms, and a route handler still inside playwright's internal `ensureOpened()` when the page closes rejects
    // unhandled ("Target page, context or browser has been closed"). about:blank stops the redials; the 100 ms settle lets a dispatched handler finish.
    await page.goto('about:blank').catch(() => {});
    await page.waitForTimeout(100);
    expect(errors, 'no console or page errors').toEqual([]);
  }, { auto: true }]
});
export { expect };

/** The IDE workspace these specs start from: the atelier alone, as a first run had it before the welcome. Kept across reloads:
 *  only an empty storage gets it. */
export async function seedAtelier(page: Page): Promise<void> {
  const atelier = JSON.stringify(JSON.stringify({ version: 1, windows: ['main'], groups: [{ id: 'g1', window: 'main', tabs: [{ kind: 'atelier', ref: 'main' }], active: 0, link: null }], focus: 'g1', next: 2 }));
  await page.addInitScript(w => { try { if (localStorage.getItem('ledge.ide.workspace') === null) localStorage.setItem('ledge.ide.workspace', w); } catch { /* ignore */ } }, atelier);
}
