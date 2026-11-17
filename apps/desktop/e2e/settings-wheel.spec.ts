import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// Settings › Workspace › Terminaux, the wheel (docs/mockups/terminal-wheel, spec 2026-11-17-terminal-wheel): like Windows by
// default with the stepper greyed, then a speed chosen and said saved. SHOTS=<folder> keeps the card, zoomed, in each state.
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
test.setTimeout(60_000);

const SHOTS = process.env.SHOTS;

async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.addInitScript(t => {
    try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ }
  }, theme);
  await seedAtelier(page);
  await fakeDaemon(page, eight, { projects: twoProjects } as never);
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press('Control+,');
  await page.locator('.settings-nav').getByRole('button', { name: 'Espace de travail', exact: true }).click();
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: like Windows by default, then 8 lines per notch`, async ({ page }) => {
    await boot(page, theme);
    const card = page.locator('.set-card').filter({ has: page.getByRole('heading', { name: 'Terminaux' }) });
    const group = page.getByRole('radiogroup', { name: 'Défilement à la molette' });
    await expect(group.getByRole('radio', { name: 'Comme Windows' })).toBeChecked();
    const more = page.getByRole('button', { name: 'Une ligne de plus par cran' });
    await expect(more).toHaveAttribute('aria-disabled', 'true');
    // The two radios share a left edge, and the stepper's line sits on its radio's middle.
    const r1 = await group.getByRole('radio').nth(0).boundingBox();
    const r2 = await group.getByRole('radio').nth(1).boundingBox();
    const stepper = await page.getByRole('group', { name: 'Lignes par cran' }).boundingBox();
    expect(Math.abs(r1!.x - r2!.x)).toBeLessThan(1);
    expect(Math.abs((r2!.y + r2!.height / 2) - (stepper!.y + stepper!.height / 2))).toBeLessThan(2);
    if (SHOTS) await card.screenshot({ path: `${SHOTS}/wheel-${theme}-1-system.png` });

    await group.getByRole('radio', { name: 'Un nombre de lignes par cran' }).click();
    for (let i = 0; i < 5; i++) await more.click();
    await expect(page.getByRole('group', { name: 'Lignes par cran' }).getByRole('status')).toHaveText('8');
    await expect(page.locator('.toast-region')).toContainText('Défilement à la molette : 8 lignes par cran');
    if (SHOTS) {
      await card.screenshot({ path: `${SHOTS}/wheel-${theme}-2-fixed.png` });
      await page.locator('.toast-region .toast').last().screenshot({ path: `${SHOTS}/wheel-${theme}-2-toast.png` });
    }
  });
}
