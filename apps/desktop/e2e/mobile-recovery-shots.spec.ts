import type { Page } from '@playwright/test';
import { DEFAULT_RELAY_URL, type MobileState } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// Passkey recovery on Desktop (docs/mockups/ledge-mobile-passkey/passkey-reinstall.html, 5 and 6): the toasts, the tab's dot and
// the wells of Settings › Mobile access, in both languages and both themes, zoomed (device scale 2). The daemon is faked: it
// pushes the `mobile` state and the `mobile.recovery` events. SHOTS=<folder> keeps a clipped screenshot of each state.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(90_000);
const SHOTS = process.env.SHOTS;

const LINKED = '2026-10-16T08:00:00.000Z';
const todayAt = (h: number, min: number) => { const d = new Date(); d.setHours(h, min, 0, 0); return d.toISOString(); };
const ONLINE: MobileState = { enabled: true, relayUrl: DEFAULT_RELAY_URL, account: { login: 'octocat', accountId: '42' }, signin: null, signinError: null, link: { state: 'online' }, devices: [], pairings: [] };
const IPAD = { id: 'fp-ipad', label: 'iPad · Safari', kind: 'tablet' as const, approvedAt: LINKED, online: true };
const IPHONE = { id: 'fp-iphone', label: 'iPhone · Safari', approvedAt: '2026-11-02T08:00:00.000Z', online: false };

const STATES: Array<[string, MobileState]> = [
  ['6a-recovered', { ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }, IPHONE] }],
  ['6c-acknowledged', { ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4) } }, IPHONE] }],
  ['6d-refused', { ...ONLINE, devices: [{ ...IPAD, refused: { at: todayAt(18, 12), model: 'iPad' } }, IPHONE] }],
  ['6e-blocked', { ...ONLINE, devices: [IPAD, IPHONE], recovery: { blocked: { since: todayAt(18, 20), failures: 3 } } }],
  ['6-all', { ...ONLINE, devices: [{ ...IPAD, recovered: { at: todayAt(18, 4), pending: true } }, { ...IPHONE, refused: { at: todayAt(18, 12) } }], recovery: { blocked: { since: todayAt(18, 20), failures: 3 } } }]
];

async function boot(page: Page, lang: 'fr' | 'en', theme: 'dark' | 'light') {
  await page.addInitScript(a => { try { localStorage.setItem('desktop.lang', a.lang); localStorage.setItem('desktop.theme', a.theme); } catch { /* ignore */ } }, { lang, theme });
  await seedAtelier(page);
  const d = await fakeDaemon(page, eight, { projects: twoProjects } as never);
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  return d;
}

const pad = (b: { x: number; y: number; width: number; height: number }, p = 16) => ({ x: Math.max(0, b.x - p), y: Math.max(0, b.y - p), width: b.width + p * 2, height: b.height + p * 2 });
async function shot(page: Page, name: string, box: { x: number; y: number; width: number; height: number } | null) {
  if (!SHOTS || !box) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${SHOTS}/desktop-recover-${name}.png`, clip: pad(box) });
}

for (const lang of ['fr', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    const mobileTab = lang === 'fr' ? 'Accès mobile' : 'Mobile access';
    test(`${lang} · ${theme}: toasts 5 a and 5 b, the wells 6 a–e, the tab's dot`, async ({ page }) => {
      const d = await boot(page, lang, theme);
      // 5 a and 5 b: the toasts, over whatever is open.
      d.push({ type: 'mobile', state: STATES[0]![1] });
      d.push({ type: 'mobile.recovery', event: 'recovered', id: 'fp-ipad', at: todayAt(18, 4) });
      const toast = page.locator('.toast-region .toast').first();
      await expect(toast).toBeVisible();
      await shot(page, `5a-${lang}-${theme}`, await toast.boundingBox());
      d.push({ type: 'mobile', state: STATES[2]![1] });
      d.push({ type: 'mobile.recovery', event: 'refused', id: 'fp-ipad', at: todayAt(18, 12) });
      const warn = page.locator('.toast-region .toast.warn').first();
      await expect(warn).toBeVisible();
      await shot(page, `5b-${lang}-${theme}`, await warn.boundingBox());

      // The toasts last 10 s (P9): the wells are taken once they have gone.
      await expect(page.locator('.toast-region .toast')).toHaveCount(0, { timeout: 15_000 });
      await page.keyboard.press('Control+,');
      const nav = page.locator('.settings-nav');
      await nav.getByRole('button', { name: new RegExp(`^${mobileTab}`) }).click();
      await expect(page.getByRole('heading', { level: 1, name: mobileTab })).toBeVisible();
      for (const [name, state] of STATES) {
        d.push({ type: 'mobile', state });
        const ipad = page.getByRole('article', { name: 'iPad · Safari' });
        await expect(ipad).toBeVisible();
        await page.waitForTimeout(150);
        const list = ipad.locator('xpath=..');
        await list.scrollIntoViewIfNeeded();
        const card = await list.boundingBox();
        const block = name === '6e-blocked' || name === '6-all' ? await page.locator('.set-well', { hasText: lang === 'fr' ? /bloqu/i : /blocked/i }).first().boundingBox() : null;
        const top = block ? Math.min(block.y, card!.y) : card!.y;
        const bottom = card!.y + card!.height;
        await shot(page, `${name}-${lang}-${theme}`, { x: card!.x, y: top, width: card!.width, height: bottom - top });
        if (name === '6-all') await expect(nav.getByRole('img', { name: lang === 'fr' ? 'Accès mobile : 3 points à vérifier' : 'Mobile access: 3 things to check' })).toBeVisible();
        await shot(page, `dot-${name}-${lang}-${theme}`, await nav.getByRole('button', { name: new RegExp(`^${mobileTab}`) }).boundingBox());
      }
      // 6 b: « Révoquer » in the well asks first.
      d.push({ type: 'mobile', state: STATES[0]![1] });
      const ipad = page.getByRole('article', { name: 'iPad · Safari' });
      await ipad.getByRole('button', { name: lang === 'fr' ? 'Révoquer' : 'Revoke' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'iPad · Safari' })).toBeVisible();
      await shot(page, `6b-revoke-${lang}-${theme}`, await ipad.boundingBox());
    });
  }
}
