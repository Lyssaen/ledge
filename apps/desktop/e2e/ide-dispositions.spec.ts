import type { Locator, Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';
import { fleet } from './thread';

// Lot 10: the status bar's dispositions, Settings › Espace de travail › « Au démarrage », the palette (v27 and the states validated
// in docs/mockups/ledge-ide-layouts-palette.html). Captured zoomed (×2), in French, dark and light.
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

const sessions: Session[] = [
  fleet.find(s => s.id === 'otto')!,
  session('nova', { name: 'Nova', project: 'ledge', cwd: '/w/ledge', state: 'working', model: 'claude-opus-5-5' })
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.ide.enabled', 'true'); } catch { /* ignore */ } });
  await seedAtelier(page);
});

const shot = (name: string) => (process.env.LEDGE_SHOTS ? `${process.env.LEDGE_SHOTS}/${name}` : test.info().outputPath(name));
const box = async (l: Locator) => (await l.boundingBox())!;
const tabOf = (page: Page, name: string) => page.locator('.dv-tab').filter({ has: page.locator('.tab-name', { hasText: new RegExp(`^${name}`) }) });

async function boot(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(t => {
    try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
  }, theme);
  await fakeDaemon(page, sessions, { projects: twoProjects });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
}
async function open(page: Page, name: string) {
  const button = page.getByRole('navigation', { name: 'Barre d’activité' }).getByRole('button', { name: 'Projets', exact: true });
  if (!(await button.getAttribute('class'))?.includes('on')) await button.click();
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(tabOf(page, name)).toHaveClass(/dv-active-tab/);
}
const lay = (page: Page) => page.locator('.ide-lay');
const menu = (page: Page) => page.getByRole('menu', { name: 'Dispositions' });
async function save(page: Page, name: string) {
  await lay(page).click();
  await menu(page).getByRole('menuitem', { name: /^Enregistrer (la disposition actuelle|sous un nouveau nom)…$/ }).click();
  await page.getByRole('textbox', { name: 'Nom de la disposition' }).fill(name);
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
}
/** The bottom right corner: the status bar's end and the menu above it. */
async function corner(page: Page, name: string) {
  const s = await box(page.locator('.ide-status'));
  await page.screenshot({ path: shot(name), clip: { x: s.width - 560, y: s.y - 300, width: 560, height: 300 + s.height } });
}
/** The menu opens upward, its right edge on the button's, the button centred in the status bar. */
async function aligned(page: Page) {
  const b = await box(lay(page)), m = await box(menu(page)), s = await box(page.locator('.ide-status'));
  expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(1);
  expect(m.y + m.height).toBeLessThanOrEqual(b.y);
  expect(Math.abs(b.y + b.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(1);
}

for (const theme of ['dark', 'light'] as const) {
  test(`lot 10 (${theme}): no disposition, saved, changed (•), a name taken`, async ({ page }) => {
    await boot(page, theme);
    await expect(lay(page)).toHaveText(/^Disposition▴$/);
    await lay(page).click();
    await expect(menu(page)).toContainText('Aucune disposition enregistrée.');
    await aligned(page);
    await corner(page, `lot10-${theme}-1-aucune.png`);
    await page.keyboard.press('Escape');

    await open(page, 'Otto');
    await save(page, 'Revue Pim + Nova');
    await open(page, 'Nova');
    await expect(lay(page)).toHaveText('Revue Pim + Nova•▴');
    await lay(page).click();
    await expect(menu(page).getByRole('menuitem', { name: /^Revue Pim \+ Nova/ })).toContainText('1 groupe · actuelle · modifiée');
    await aligned(page);
    await corner(page, `lot10-${theme}-2-modifiee.png`);

    await menu(page).getByRole('menuitem', { name: 'Enregistrer sous un nouveau nom…' }).click();
    await page.getByRole('textbox', { name: 'Nom de la disposition' }).fill('Revue Pim + Nova');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ide-lay-hint')).toHaveText('« Revue Pim + Nova » existe déjà : Entrée pour la remplacer.');
    await corner(page, `lot10-${theme}-3-nom-pris.png`);
    // The field and its hint start where the menu's items do.
    const f = await box(page.locator('.ide-lay-save')), h = await box(page.locator('.ide-lay-hint')), it = await box(menu(page).getByRole('menuitem').first());
    expect(Math.abs(f.x - (it.x + 2))).toBeLessThanOrEqual(6);
    expect(h.x).toBeGreaterThanOrEqual(it.x);
  });

  test(`lot 10 (${theme}): Settings › « Au démarrage » and the dispositions`, async ({ page }) => {
    await boot(page, theme);
    await open(page, 'Otto');
    await save(page, 'Revue Pim + Nova');
    await save(page, 'Terminaux');
    await lay(page).click();
    await menu(page).getByRole('menuitem', { name: /Gérer les dispositions/ }).click();
    await expect(page.getByRole('heading', { name: 'Espace de travail' })).toBeVisible();
    const boot_ = page.getByRole('radiogroup', { name: 'Au démarrage' });
    await boot_.getByRole('radio', { name: /^La disposition/ }).check();
    const card = page.locator('.set-boot').locator('xpath=ancestor::*[contains(@class,"set-card") or contains(@class,"card")][1]');
    const target = (await card.count()) ? card : boot_;
    await target.scrollIntoViewIfNeeded();
    const c = await box(target);
    await page.screenshot({ path: shot(`lot10-${theme}-4-demarrage.png`), clip: { x: c.x - 8, y: c.y - 8, width: Math.min(c.width + 16, 1000), height: c.height + 16 } });
    // The radios line up on their left edge.
    const xs = await boot_.getByRole('radio').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(1);
    // The dispositions' buttons line up from one row to the next.
    for (const name of ['Appliquer', 'Supprimer']) {
      const bx = await page.getByRole('button', { name: new RegExp(`^${name} «`) }).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().x)));
      expect(bx).toHaveLength(2);
      expect(new Set(bx).size).toBe(1);
    }
  });

  test(`lot 10 (${theme}): the palette — rigs and OpenRig, dispositions`, async ({ page }) => {
    await boot(page, theme);
    await open(page, 'Otto');
    await save(page, 'Revue Pim + Nova');
    await page.keyboard.press('Control+k');
    const pal = page.getByRole('dialog', { name: 'Palette' });
    await expect(pal).toBeVisible();
    await page.keyboard.type('>openrig');
    await expect(pal.getByRole('option')).toHaveCount(6);
    let p = await box(pal);
    await page.screenshot({ path: shot(`lot10-${theme}-5-palette-openrig.png`), clip: { x: p.x - 8, y: p.y - 8, width: p.width + 16, height: p.height + 16 } });
    await page.getByRole('combobox', { name: 'Palette' }).fill('>dispo');
    await expect(pal.getByRole('option').first()).toContainText('Disposition : Revue Pim + Nova');
    p = await box(pal);
    await page.screenshot({ path: shot(`lot10-${theme}-6-palette-dispositions.png`), clip: { x: p.x - 8, y: p.y - 8, width: p.width + 16, height: p.height + 16 } });
    // Centred, its hints right-aligned on one edge.
    const vw = page.viewportSize()!.width;
    expect(Math.abs(p.x + p.width / 2 - vw / 2)).toBeLessThanOrEqual(1);
    const rights = await pal.locator('.ide-pal-r').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().right)));
    expect(new Set(rights).size).toBeLessThanOrEqual(1);
  });
}
