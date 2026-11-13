import { expect, type Page } from '@playwright/test';
import type { HarnessUsage, UsageStateMessage } from '@ledge/protocol';
import { test, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { fleet } from './thread';

test.beforeEach(async ({ page }) => {
  await seedAtelier(page);
});

// Visual review of the harnesses' limits in the IDE, not an assertion suite: the status bar's right end (docs/mockups/
// ledge-ide-interactive.html v27, « Barre d'état : limites d'usage »; the chips and details of ledge-harness-usage.html v2 B), its
// states, each detail open above it, several harnesses, an alert told once in a toast (usageTold.ts), in both themes; compare
// with v27. The old footer's other places are gone in the IDE: no heading row on a session (lot 3, option A), no « À toi » card for
// an alert (a toast, the user 2026-11-09); under 1280 px the IDE's states are still to be drawn (plan 4.1 point 5).
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/usage-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the usage screens');
test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const monday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d.toISOString(); };
const claude = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({
  harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: at(-0.7),
  windows: [{ kind: 'five_hour', pct: 62, resetsAt: at(130) }, { kind: 'seven_day', pct: 34, resetsAt: monday() }, { kind: 'model', model: 'Opus', pct: 71, resetsAt: monday() }, { kind: 'model', model: 'Fable', pct: 12, resetsAt: monday() }],
  ...o
});
const over = claude({ windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(65) }, { kind: 'seven_day', pct: 58, resetsAt: monday() }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: monday() }, { kind: 'model', model: 'Fable', pct: 20, resetsAt: monday() }] });
const codex: HarnessUsage = { harness: 'codex', account: null, status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: at(170) }, { kind: 'seven_day', pct: 41, resetsAt: monday() }] };
const inDays = (n: number) => { const d = new Date(Date.now() + n * 86_400_000); d.setHours(13, 43, 0, 0); return d.toISOString(); };
const thursday = () => { const d = new Date(); d.setDate(d.getDate() + ((11 - d.getDay()) % 7 || 7)); d.setHours(14, 0, 0, 0); return d.toISOString(); };
const cursor = (o: Partial<HarnessUsage> = {}): HarnessUsage => ({ harness: 'cursor', account: 'c0ffee000001', status: 'ok', readAt: at(-0.7), windows: [], ...o });
const cursorMonth = (a: number, b: number, c: number, resetsAt = inDays(24)) => [{ kind: 'month' as const, pct: a, resetsAt }, { kind: 'pool' as const, pool: 'cursor' as const, pct: b, resetsAt }, { kind: 'pool' as const, pool: 'other' as const, pct: c, resetsAt }];
const STATES: Record<string, HarnessUsage[]> = {
  cursorMonth: [cursor({ windows: cursorMonth(12, 8, 56) })],
  cursorOver: [cursor({ windows: cursorMonth(81, 41, 100) })],
  cursorWeek: [cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: thursday() }] })],
  cursorUnread: [cursor({ readAt: at(-1) })],
  cursorExpired: [cursor({ status: 'expired', cause: 'refused' })],
  cursorStale: [cursor({ status: 'stale', readAt: at(-22) })],
  cursorUnreachable: [cursor({ status: 'unreachable', readAt: at(-25) })],
  claudeCursor: [claude(), cursor({ windows: cursorMonth(12, 8, 56) })],
  threeHarnesses: [claude(), codex, cursor({ windows: cursorMonth(81, 41, 100) })],
  ok: [claude()], over: [over], codex: [claude(), codex],
  loading: [claude({ status: 'loading', readAt: null, windows: [] })], expired: [claude({ status: 'expired', cause: 'refused', windows: [] })],
  // #301: a refused Claude next to Codex (only Codex shows); a Claude token past its time on this machine, values kept stale.
  refusedCodex: [claude({ status: 'expired', cause: 'refused', windows: [] }), codex],
  localExpired: [claude({ status: 'stale', cause: 'local_expired', readAt: at(-12) })],
  // « Comptes lus »: one row per state worth seeing.
  accounts: [claude({ status: 'expired', cause: 'refused', windows: [] }), codex, cursor({ status: 'stale', readAt: at(-22), windows: cursorMonth(12, 8, 56) })],
  stale: [claude({ status: 'stale', readAt: at(-12) })], unreachable: [claude({ status: 'unreachable', readAt: at(-25) })]
};
const ALERTS: UsageStateMessage['alerts'] = [
  { id: 'claude|a1b2c3d4e5f6|five_hour|-|threshold|x', harness: 'claude', account: 'a1b2c3d4e5f6', window: over.windows[0]!, level: 'threshold', at: at(0) },
  { id: 'claude|a1b2c3d4e5f6|model|Opus|full|x', harness: 'claude', account: 'a1b2c3d4e5f6', window: over.windows[2]!, level: 'full', at: at(-12) }
];
let alerts: UsageStateMessage['alerts'] = [];
const usage = (harnesses: HarnessUsage[]): Omit<UsageStateMessage, 'type' | 'machineId'> => ({ harnesses, alerts, prefs: { alert: 0.8 } });

// Nova as Ledge launched it, near « Contexte max »' 85 % it is not: 46 %; open 1 h 12 ago.
const sessions = fleet.map(s => (s.name === 'Nova' ? { ...s, model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) }
  : s.name === 'Pim' ? { ...s, context: { used: 176_000, window: 200_000, at: at(0) } } : s));

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en', harnesses: HarnessUsage[], shown = true) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, sessions, { launcher: ['ledge'], projects: twoProjects, usage: usage(harnesses) });
  await page.goto('/');
  // The IDE's chunk compiles on Vite's first visit: under load it takes a while.
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  if (shown) await limits(page).locator('.ugroup').first().waitFor();
}
/** The status bar's usage limits (IdeStatusBar's `usage`). */
const limits = (page: Page) => page.locator('.ide-status .usage-foot');
const chip = (page: Page, name: RegExp) => limits(page).getByRole('button', { name });
// The status bar's right end and what opens above it, zoomed.
const zoom = async (page: Page, path: string) => {
  const vp = page.viewportSize()!;
  await page.waitForTimeout(300);
  await page.screenshot({ path, clip: { x: vp.width - 960, y: vp.height - 460, width: 960, height: 460 } });
};

for (const theme of ['dark', 'light'] as const) {
  test(`usage in the status bar, ${theme}`, async ({ page }, info) => {
    await boot(page, theme, 'fr', STATES.ok!);
    await page.screenshot({ path: info.outputPath(`usage-overview-ok-${theme}.png`) });
    const vp = page.viewportSize()!;
    await page.screenshot({ path: info.outputPath(`usage-bar-${theme}.png`), clip: { x: 0, y: vp.height - 40, width: vp.width, height: 40 } });
    await chip(page, /Claude Code/).click();
    await page.screenshot({ path: info.outputPath(`usage-overview-open-${theme}.png`) });
    await zoom(page, info.outputPath(`usage-zoom-open-${theme}.png`));
    // A session's tab keeps the same bar.
    await page.keyboard.press('Escape');
    await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();
    await page.locator('.session-page').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`usage-session-${theme}.png`) });
  });

  for (const st of ['over', 'codex', 'loading', 'refusedCodex', 'localExpired', 'stale', 'unreachable', 'cursorMonth', 'cursorOver', 'claudeCursor', 'threeHarnesses'] as const) {
    test(`usage in the status bar, ${st}, ${theme}`, async ({ page }, info) => {
      await boot(page, theme, 'fr', STATES[st]!);
      if (st === 'over') await chip(page, /Claude Code/).click();
      await zoom(page, info.outputPath(`usage-zoom-${st}-${theme}.png`));
      // The Cursor chip's detail, for the states that have one.
      if (['cursorMonth', 'cursorOver', 'threeHarnesses'].includes(st)) {
        await chip(page, /Cursor/).click();
        await zoom(page, info.outputPath(`usage-zoom-${st}-open-${theme}.png`));
      }
      // Never past the bar: the limits end before the disposition, inside the window.
      const vp = page.viewportSize()!, box = (await limits(page).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    });
  }

  test(`a usage alert told once in a toast; the detail's « Réglages », ${theme}`, async ({ page }, info) => {
    alerts = ALERTS;
    try {
      await boot(page, theme, 'fr', STATES.over!);
      const toast = page.locator('.toast');
      await expect(toast).toBeVisible();
      await page.screenshot({ path: info.outputPath(`usage-alert-toast-${theme}.png`) });
      await chip(page, /Claude Code/).click();
      await page.locator('.usage-pop').getByRole('button', { name: 'Réglages' }).click();
      await page.getByRole('combobox', { name: 'Alerte de limite d’usage' }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: info.outputPath(`usage-alert-setting-${theme}.png`) });
    } finally { alerts = []; }
  });
}

// #301 (docs/mockups/ledge-usage-sign-in.html): a refused account leaves the bar (nothing left: no limits at all); « Comptes lus » in
// Settings › General says which account to sign in again.
for (const theme of ['dark', 'light'] as const) {
  for (const lang of ['fr', 'en'] as const) {
    test(`#301: a refused account alone leaves no limits, ${theme}, ${lang}`, async ({ page }, info) => {
      await boot(page, theme, lang, STATES.expired!, false);
      await page.waitForTimeout(500);
      await expect(limits(page)).toHaveCount(0);
      await zoom(page, info.outputPath(`usage-301-refused-alone-${theme}-${lang}.png`));
    });

    test(`#301: refused hidden in the bar, « Comptes lus », ${theme}, ${lang}`, async ({ page }, info) => {
      await boot(page, theme, lang, STATES.accounts!);
      await zoom(page, info.outputPath(`usage-301-bar-${theme}-${lang}.png`));
      await page.keyboard.press('Control+Comma');
      const row = page.locator('.set-row').filter({ hasText: lang === 'fr' ? 'Comptes lus' : 'Accounts read' });
      await row.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await row.screenshot({ path: info.outputPath(`usage-301-accounts-${theme}-${lang}.png`) });
      await page.locator('.set-card').first().screenshot({ path: info.outputPath(`usage-301-card-${theme}-${lang}.png`) });
    });
  }
}

test('usage in the status bar, English', async ({ page }, info) => {
  await boot(page, 'light', 'en', STATES.over!);
  await chip(page, /Claude Code/).click();
  await zoom(page, info.outputPath('usage-zoom-over-light-en.png'));
});
