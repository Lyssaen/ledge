import type { Page } from '@playwright/test';
import { test } from './fixtures';
import { fakeDaemon, twoProjects, openAtelier } from './daemon';
import { fleet, ottoThread, tool } from './thread';

// Visual review of Fil | Terminal (docs/mockups/ledge-session-fil-terminal.html, v3), not an assertion suite: the screens the
// mockup draws, in both themes, and zooms on the heading. Compare with the mockup's ledge-session-fil-terminal-*.png.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/session-view-toggle-visual.spec.ts
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the Fil | Terminal screens');
test.use({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
test.setTimeout(120_000);

const threads = {
  otto: [
    ...ottoThread,
    tool('t6', -7, 'Write', '/w/ledge/src/list/sessionSort.ts', { turn: 2, files: [{ path: '/w/ledge/src/list/sessionSort.ts', change: 'add', diff: '+ export const sortSessions = (s) => s;' }] }),
    tool('t7', -6, 'Edit', '/w/ledge/src/i18n/fr.ts', { turn: 2, files: [{ path: '/w/ledge/src/i18n/fr.ts', change: 'edit', diff: '- a\n+ b' }] })
  ]
};
const omp = fleet.map(s => (s.id === 'pim' ? { ...s, tool: 'omp' as const, backend: 'omp-rpc' as const } : s));

async function boot(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, omp, { launcher: ['ledge'], projects: twoProjects, threads });
  await page.goto('/'); await openAtelier(page);
}
const open = async (page: Page, name: string) => {
  await page.getByRole('tree').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.locator('.session-page').waitFor({ timeout: 30_000 });
  await page.locator('.session-thread').focus().catch(() => {});
};
// The thread's scroller, focused by the script to keep the keys on the page, is not drawn with its focus ring.
const settle = async (page: Page) => {
  await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; if (a?.hasAttribute('data-thread-focus')) a.blur(); });
  await page.waitForTimeout(400);
};

for (const theme of ['dark', 'light'] as const) for (const lang of ['fr', 'en'] as const) {
  test(`Fil | Terminal, ${theme}, ${lang}`, async ({ page }, info) => {
    const shot = async (n: string) => { await settle(page); await page.screenshot({ path: info.outputPath(`fil-terminal-${n}-${theme}-${lang}.png`) }); };
    const zoom = async (n: string, sel: string) => { await settle(page); await page.locator(sel).first().screenshot({ path: info.outputPath(`fil-terminal-zoom-${n}-${theme}-${lang}.png`) }); };
    await boot(page, theme, lang);
    await open(page, 'Otto');
    // a3: the thread, the panel hidden.
    await shot('a3-thread');
    await zoom('heading-thread', '.session-page .pane-heading');
    // a1: the panel on Modifications, no shell yet.
    await page.keyboard.press('o');
    await page.locator('.right-panel').waitFor();
    await shot('a1-thread-changes');
    await zoom('panel-changes', '.right-panel');
    // a4: the file list unfolded.
    await page.locator('.right-panel .file-list-toggle').click();
    await shot('a4-thread-changes-list');
    await page.keyboard.press('Escape');
    // a2: a shell in the panel.
    await page.locator('.right-panel .term-add').click();
    await shot('a2-thread-shell');
    await zoom('panel-shell-heading', '.right-panel .pane-heading');
    // b1: Terminal + the panel on a shell (the keyboard back in the agent's screen).
    await page.locator('#session-tab-terminal').click();
    await shot('b1-terminal-shell');
    await zoom('heading-terminal', '.session-page .pane-heading');
    // b2: Terminal + Modifications, Otto waits for an approval: the badge on Fil.
    await page.locator('.right-panel [role=tab]').first().click();
    await shot('b2-terminal-changes');
    // b3: Terminal, the panel hidden.
    await page.locator('#session-tab-terminal').click();
    await page.keyboard.press('Control+Backquote');
    await page.locator('.session-thread').focus().catch(() => {});
    await page.keyboard.press('o');
    await page.locator('#session-tab-terminal').click();
    await shot('b3-terminal-alone');
    // The OMP session: no agent screen.
    await open(page, 'Pim');
    await page.locator('#session-tab-terminal').click();
    await shot('omp');
    await zoom('omp', '.agent-view');
    // Enlarged panel: the left view hidden, the switch stays.
    await page.keyboard.press('o').catch(() => {});
    await page.locator('#session-tab-thread').click();
    await page.locator('.session-thread').focus();
    if (await page.locator('.right-panel').count() === 0) await page.keyboard.press('o');
    await page.locator('.right-panel').getByRole('button', { name: lang === 'fr' ? 'Agrandir le panneau' : 'Enlarge the panel' }).click();
    await shot('maxed');
    await page.locator('.right-panel').getByRole('button', { name: lang === 'fr' ? 'Réduire le panneau' : 'Shrink the panel' }).click();
    // The keyboard help.
    await page.locator('.session-thread').focus();
    await page.keyboard.press('?');
    await shot('help');
  });
}
