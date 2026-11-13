import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// Visual review of « Vue par défaut d'une session » (#300, docs/mockups/ledge-session-view-default.html): the row in Settings ›
// General, zoomed, both themes, French and English, on Thread then Terminal (with its « saved » toast).
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/default-view-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the setting');
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });

for (const theme of ['light', 'dark'] as const) {
  for (const lang of ['fr', 'en'] as const) {
    test(`Settings › General, ${theme}, ${lang}`, async ({ page }, info) => {
      await seedAtelier(page);
      await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', l!); } catch { /* ignore */ } }, [theme, lang]);
      await fakeDaemon(page, eight, { projects: twoProjects });
      await page.goto('/');
      await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Control+Comma');
      const group = page.getByRole('radiogroup', { name: lang === 'fr' ? 'Vue par défaut d’une session' : 'Default session view' });
      await expect(group).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      // The default agent and the new row together, as the mockup frames them.
      const rows = page.locator('.set-row').filter({ has: page.getByRole('radiogroup', { name: lang === 'fr' ? 'Agent par défaut' : 'Default agent' }) });
      await rows.first().scrollIntoViewIfNeeded();
      const row = page.locator('.set-row').filter({ has: group });
      await row.screenshot({ path: info.outputPath(`row-thread-${theme}-${lang}.png`) });
      await page.locator('.set-card').first().screenshot({ path: info.outputPath(`card-thread-${theme}-${lang}.png`) });
      await group.locator('label', { hasText: 'Terminal' }).click();
      await expect(group.getByRole('radio', { name: 'Terminal' })).toBeChecked();
      await row.screenshot({ path: info.outputPath(`row-terminal-${theme}-${lang}.png`) });
      await page.screenshot({ path: info.outputPath(`page-terminal-${theme}-${lang}.png`) });
    });
  }
}
