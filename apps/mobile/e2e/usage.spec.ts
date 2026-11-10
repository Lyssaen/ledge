// The harnesses' limits and a session's indicators on the phone (docs/mockups/ledge-harness-usage.html, phone 1–3): « Le point »
// with « LIMITES » and a reached window in « À toi », the Agents line, the thread's chips. Light and dark, iPhone 13.
// SHOTS=<dir> saves a capture of each screen there; compare with ledge-harness-usage-phone-*.png.
import { devices, expect, test, type Page } from '@playwright/test';
import type { PhoneHarnessUsage, PhoneSession } from '@ledge/protocol';
import { copy } from '../src/copy';
import { startHarness, waiting, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _webkit, ...iPhone13 } = devices['iPhone 13'];
test.use(iPhone13);
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const monday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const usage: PhoneHarnessUsage[] = [{
  harness: 'claude', status: 'ok', readAt: at(-1),
  windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(60) }, { kind: 'seven_day', pct: 58, resetsAt: monday() }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: monday() }, { kind: 'model', model: 'Fable', pct: 20, resetsAt: monday() }]
}];
const otto = (): PhoneSession => ({ ...waiting(), model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) });
const nova = (): PhoneSession => ({ ...waiting(), id: 'nova', name: 'Nova', topic: 'Trier par activité', state: 'working', pending: undefined, model: 'fable', effort: 'high', context: { used: 176_000, window: 200_000, at: at(0) }, startedAt: at(-220) } as PhoneSession);

let h: Harness;
test.beforeEach(async () => { h = await startHarness(); Object.assign(h.daemon, { sessions: [otto(), nova()], chat: true, usage }); });
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/usage-${name}.png` });
}
async function pair(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); } catch { /* ignore */ } }, theme);
  await page.goto(h.url);
  await page.getByRole('link', { name: copy.login.github }).click();
  // The app without a key opens on the choice (passkey-reinstall.html, 1 a): the code.
  await page.getByRole('button', { name: copy.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: copy.compare.same }).click();
  h.pc.ok();
  await page.getByRole('link', { name: copy.compare.seePending }).click();
}
const nav = (page: Page) => page.getByRole('navigation', { name: copy.nav.label });

for (const theme of ['dark', 'light'] as const) {
  test(`limits and indicators on the phone, ${theme}`, async ({ page }) => {
    await pair(page, theme);
    // 1 · « Le point »: the reached window in « À toi », « LIMITES » with the logo.
    await nav(page).getByRole('link', { name: 'Ledge' }).click();
    const limits = page.getByRole('group', { name: copy.chat.point.limitsLabel });
    await expect(limits).toContainText('84 %');
    await expect(limits.locator('svg.harness-claude')).toBeVisible();
    await expect(page.getByLabel('Claude · Opus atteinte')).toContainText('100 %');
    await expect(page.getByLabel('Claude · 5 h à 84 %')).toContainText('84 %');
    await limits.scrollIntoViewIfNeeded();
    await shot(page, `point-${theme}`);
    // 2 · Agents: one line of indicators.
    await nav(page).getByRole('link', { name: copy.nav.sessions }).click();
    await expect(page.locator('[data-indicators]').first()).toContainText('Opus 5.5 · élevé · contexte 46 %');
    await shot(page, `agents-${theme}`);
    // 3 · The thread's chips.
    await page.locator('[data-indicators]').first().click();
    await expect(page.locator('[data-chips]')).toContainText('Opus 5.5 · élevé');
    await shot(page, `thread-${theme}`);
  });
}

test('Cursor limits on the phone: month, Cursor and others', async ({ page }) => {
  const resetsAt = new Date(Date.now() + 24 * 86_400_000).toISOString();
  Object.assign(h.daemon, { usage: [{ harness: 'cursor', status: 'ok', readAt: at(-1), windows: [{ kind: 'month', pct: 81, resetsAt }, { kind: 'pool', pool: 'cursor', pct: 41, resetsAt }, { kind: 'pool', pool: 'other', pct: 100, resetsAt }] }] satisfies PhoneHarnessUsage[] });
  await pair(page, 'dark');
  await nav(page).getByRole('link', { name: 'Ledge' }).click();
  const limits = page.getByRole('group', { name: copy.chat.point.limitsLabel });
  await expect(limits).toContainText('Mois');
  await expect(limits).toContainText('Cursor Agent');
  await expect(limits).toContainText('Autres');
  await expect(limits).toContainText('81 %');
  await expect(limits).toContainText('reprend le ');
  await expect(page.getByRole('group', { name: copy.chat.point.yoursLabel })).toContainText('Cursor · Autres 100 %');
  await limits.scrollIntoViewIfNeeded();
  await shot(page, 'point-cursor-over');
});
