import type { Page } from '@playwright/test';
import type { HarnessUsage, UsageStateMessage } from '@ledge/protocol';
import { test } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet } from './thread';

// Visual review of the harnesses' limits (docs/mockups/ledge-harness-usage.html, v2 variant B), not an assertion suite: the
// footer on every screen, its states, the detail, a narrow window, in both themes. Compare with ledge-harness-usage-*.png.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/usage-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the usage screens');
test.use({ deviceScaleFactor: 2, reducedMotion: 'reduce' });
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
const STATES: Record<string, HarnessUsage[]> = {
  ok: [claude()], over: [over], codex: [claude(), codex],
  loading: [claude({ status: 'loading', readAt: null, windows: [] })], expired: [claude({ status: 'expired', windows: [] })],
  stale: [claude({ status: 'stale', readAt: at(-12) })], unreachable: [claude({ status: 'unreachable', readAt: at(-25) })]
};
const usage = (harnesses: HarnessUsage[]): Omit<UsageStateMessage, 'type' | 'machineId'> => ({ harnesses, alerts: [], prefs: { alert: 0.8 } });

// Nova as Ledge launched it, near « Contexte max »' 85 % it is not: 46 %; open 1 h 12 ago.
const sessions = fleet.map(s => (s.name === 'Nova' ? { ...s, model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) } : s));

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en', harnesses: HarnessUsage[]) {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, sessions, { launcher: ['ledge'], projects: twoProjects, usage: usage(harnesses) });
  await page.goto('/'); await openAtelier(page);
}
const footer = (page: Page) => page.locator('.workspace-footer');
// The footer and what opens above it, zoomed: the right half of the window's bottom.
const zoom = async (page: Page, path: string) => {
  const vp = page.viewportSize()!;
  await page.waitForTimeout(300);
  await page.screenshot({ path, clip: { x: vp.width / 2, y: vp.height - 420, width: vp.width / 2, height: 420 } });
};

for (const theme of ['dark', 'light'] as const) {
  test(`usage footer, ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 860 });
    await boot(page, theme, 'fr', STATES.ok!);
    await footer(page).locator('.ugroup').first().waitFor();
    await page.screenshot({ path: info.outputPath(`usage-overview-ok-${theme}.png`) });
    await footer(page).getByRole('button', { name: /Claude Code/ }).click();
    await page.screenshot({ path: info.outputPath(`usage-overview-open-${theme}.png`) });
    await zoom(page, info.outputPath(`usage-zoom-open-${theme}.png`));
    // A session page has it too.
    await page.keyboard.press('Escape');
    await page.getByRole('tree').getByRole('button', { name: /^Nova/ }).click();
    await page.locator('.session-page').waitFor({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath(`usage-session-${theme}.png`) });
    // The heading's line and its tooltip, zoomed.
    await page.locator('.session-meta').hover();
    await page.waitForTimeout(300);
    const head = (await page.locator('.pane-heading').first().boundingBox())!;
    await page.screenshot({ path: info.outputPath(`usage-zoom-header-${theme}.png`), clip: { x: head.x, y: head.y, width: 900, height: 200 } });
  });

  for (const st of ['over', 'codex', 'loading', 'expired', 'stale', 'unreachable'] as const) {
    test(`usage footer ${st}, ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1440, height: 860 });
      await boot(page, theme, 'fr', STATES[st]!);
      await footer(page).locator('.ugroup').first().waitFor();
      if (st === 'over') await footer(page).getByRole('button', { name: /Claude Code/ }).click();
      await zoom(page, info.outputPath(`usage-zoom-${st}-${theme}.png`));
    });
  }

  test(`usage footer narrow, ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await boot(page, theme, 'fr', STATES.ok!);
    await footer(page).locator('.ugroup').first().waitFor();
    await page.screenshot({ path: info.outputPath(`usage-narrow-${theme}.png`) });
  });
}

test('usage footer, English', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await boot(page, 'light', 'en', STATES.over!);
  await footer(page).getByRole('button', { name: /Claude Code/ }).click();
  await zoom(page, info.outputPath('usage-zoom-over-light-en.png'));
});
