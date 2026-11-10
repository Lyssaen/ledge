import type { Page } from '@playwright/test';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// IDE lot 11, « Ouvrir dans… »: docs/mockups/ledge-ide-interactive.html (v26) and its states, docs/mockups/ledge-ide-open-in.html,
// at the mockup's size. The native side is faked: `__ledgeEditors` says what this PC has, `__ledgeOpenInEditor` what opening did.
// SHOTS=<folder> keeps a clipped screenshot of each state, to set beside the planche.
test.use({ viewport: { width: 1920, height: 1080 } });
// The first test of a run pays Vite's first compile of the IDE chunk: on a loaded machine that is past 20 s.
test.setTimeout(60_000);

type Outcome = { kind: 'opened' } | { kind: 'missing' } | { kind: 'zedWsl' } | { kind: 'failed'; reason: string };
const SHOTS = process.env.SHOTS;

async function boot(page: Page, o: { lang: 'fr' | 'en'; theme: 'dark' | 'light'; editor?: string; outcome?: Outcome; installed?: Record<string, boolean> }): Promise<void> {
  await page.addInitScript(a => {
    try {
      localStorage.setItem('desktop.lang', a.lang); localStorage.setItem('desktop.theme', a.theme);
      if (a.editor) localStorage.setItem('ledge.ide.openIn', JSON.stringify(a.editor));
    } catch { /* ignore */ }
    const w = window as unknown as { __ledgeEditors?: unknown; __ledgeOpenInEditor?: (x: unknown) => unknown; __ledgeOpened?: unknown[] };
    w.__ledgeEditors = a.installed ?? { cursor: true, vscode: true, zed: true };
    w.__ledgeOpened = [];
    w.__ledgeOpenInEditor = x => { w.__ledgeOpened!.push(x); return a.outcome ?? { kind: 'opened' }; };
  }, o);
  await seedAtelier(page);
  await fakeDaemon(page, eight, { projects: twoProjects } as never);
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
}

const shot = async (page: Page, name: string, box: { x: number; y: number; width: number; height: number }) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: box });
};
/** Nova's tab, opened from the explorer, then its right-click menu. */
async function tabMenu(page: Page): Promise<void> {
  await page.locator('.ide-explorer').getByRole('button', { name: /^Nova/ }).first().click();
  const tab = page.locator('.ide-dockview .dv-tab').filter({ hasText: 'Nova' });
  await expect(tab).toHaveCount(1);
  await tab.click({ button: 'right' });
}
const toastBox = async (page: Page) => (await page.locator('.toast-region .toast').boundingBox())!;
const around = (b: { x: number; y: number; width: number; height: number }, pad = 24) => ({ x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 });

for (const [lang, theme] of [['fr', 'dark'], ['en', 'light']] as const) {
  const t = lang === 'fr'
    ? { openIn: (e: string) => `Ouvrir dans ${e}`, missing: 'Cursor n’est pas installé sur ce PC : choisissez un autre éditeur.', zedWsl: 'Zed n’ouvre pas les dossiers WSL : choisissez Cursor ou VS Code.', settings: 'Réglages', failed: 'VS Code n’a pas pu s’ouvrir : la distribution WSL ne répond pas.', field: 'Ouvrir dans…', notInstalled: 'non installé', noWsl: 'pas les dossiers WSL' }
    : { openIn: (e: string) => `Open in ${e}`, missing: 'Cursor isn’t installed on this PC: choose another editor.', zedWsl: 'Zed can’t open WSL folders: choose Cursor or VS Code.', settings: 'Settings', failed: 'VS Code couldn’t open: the WSL distribution isn’t answering.', field: 'Open in…', notInstalled: 'not installed', noWsl: 'no WSL folders' };

  test.describe(`${lang} · ${theme}`, () => {
    test('1 · the tab menu opens the worktree in Cursor; nothing shows in Ledge', async ({ page }) => {
      await boot(page, { lang, theme });
      await tabMenu(page);
      const menu = page.getByRole('menu');
      const entry = menu.getByRole('menuitem', { name: t.openIn('Cursor') });
      await expect(entry).toBeVisible();
      await entry.hover();
      await shot(page, `${lang}-${theme}-1-tab-menu`, around((await menu.boundingBox())!));
      await entry.click();
      expect(await page.evaluate(() => (window as unknown as { __ledgeOpened: unknown[] }).__ledgeOpened)).toEqual([{ editor: 'cursor', path: '/w/ledge' }]);
      await expect(page.locator('.toast-region .toast')).toHaveCount(0);
    });

    test('2 · Cursor missing: the toast with its Settings button, which opens Settings › Workspace', async ({ page }) => {
      await boot(page, { lang, theme, outcome: { kind: 'missing' } });
      await tabMenu(page);
      await page.getByRole('menu').getByRole('menuitem', { name: t.openIn('Cursor') }).click();
      await expect(page.locator('.toast-region')).toContainText(t.missing);
      const button = page.locator('.toast-region').getByRole('button', { name: t.settings });
      await expect(button.locator('kbd')).toHaveCount(0);
      await shot(page, `${lang}-${theme}-2-missing`, around(await toastBox(page)));
      await button.click();
      await expect(page.getByRole('radiogroup', { name: t.field })).toBeVisible();
    });

    test('3 + 5 · Settings: « not installed » once known, « no WSL folders » under Zed', async ({ page }) => {
      await boot(page, { lang, theme, installed: { cursor: false, vscode: true, zed: false } });
      await page.keyboard.press('Control+,');
      await page.locator('.settings-nav').getByRole('button', { name: lang === 'fr' ? 'Espace de travail' : 'Workspace', exact: true }).click();
      const group = page.getByRole('radiogroup', { name: t.field });
      await expect(group).toContainText(t.notInstalled);
      await expect(group.locator('label').nth(2)).toContainText(`${t.notInstalled} · ${t.noWsl}`);
      // The grey note sits on the radio's line, at its name's baseline.
      const name = await group.locator('label').first().boundingBox();
      const note = await group.locator('.set-radio-note').first().boundingBox();
      expect(Math.abs((name!.y + name!.height / 2) - (note!.y + note!.height / 2))).toBeLessThan(3);
      const row = group.locator('xpath=ancestor::*[contains(@class,"set-row")][1]');
      await shot(page, `${lang}-${theme}-3-settings`, around((await (await row.count() ? row : group).boundingBox())!, 16));
    });

    test('4 · Zed on a WSL folder: the toast with its Settings button', async ({ page }) => {
      await boot(page, { lang, theme, editor: 'zed', outcome: { kind: 'zedWsl' } });
      await tabMenu(page);
      await page.getByRole('menu').getByRole('menuitem', { name: t.openIn('Zed') }).click();
      await expect(page.locator('.toast-region')).toContainText(t.zedWsl);
      await expect(page.locator('.toast-region').getByRole('button', { name: t.settings })).toBeVisible();
      await shot(page, `${lang}-${theme}-4-zed-wsl`, around(await toastBox(page)));
    });

    test('7 · a failed launch says why, without a button', async ({ page }) => {
      await boot(page, { lang, theme, editor: 'vscode', outcome: { kind: 'failed', reason: 'distro' } });
      await tabMenu(page);
      await page.getByRole('menu').getByRole('menuitem', { name: t.openIn('VS Code') }).click();
      await expect(page.locator('.toast-region')).toContainText(t.failed);
      await expect(page.locator('.toast-region').getByRole('button')).toHaveCount(0);
      await shot(page, `${lang}-${theme}-7-failed`, around(await toastBox(page)));
    });

    test('9 · the explorer\'s menu: the entry last', async ({ page }) => {
      await boot(page, { lang, theme });
      await page.locator('.ide-explorer').getByRole('button', { name: /^Nova/ }).first().click({ button: 'right' });
      const menu = page.getByRole('menu');
      const items = menu.getByRole('menuitem');
      const labels = await items.evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
      expect(labels.indexOf(t.openIn('Cursor'))).toBe(lang === 'fr' ? labels.indexOf('Son terminal') + 1 : labels.indexOf('Its terminal') + 1);
      await menu.getByRole('menuitem', { name: t.openIn('Cursor') }).hover();
      await shot(page, `${lang}-${theme}-9-explorer`, around((await menu.boundingBox())!));
    });
  });
}
