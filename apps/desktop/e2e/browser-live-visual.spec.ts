import type { Browser, Page } from '@playwright/test';
import type { BrowserLive, Session, ThreadItem } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, twoProjects, openAtelier } from './daemon';

// Visual review of docs/mockups/ledge-browser-live.html (design/html-viewer 44811d1e), not an assertion suite: a Claude
// session's browser through steps a to e (none, the button appears, live, closed, back), an OMP seat's (live beside its
// Terminal, tabs closed, stopped), and the boxes without a film (off, its confirmation, enabled), wide and narrow, dark and
// light. The frames are JPEG images of a page drawn here, as the daemon films the agent's Chrome.
// LEDGE_VISUAL=1 pnpm exec playwright test e2e/browser-live-visual.spec.ts   (from apps/desktop)
test.skip(!process.env.LEDGE_VISUAL, 'set LEDGE_VISUAL=1 to capture the live browser');
test.use({ deviceScaleFactor: 2, reducedMotion: 'reduce' });
test.setTimeout(180_000);

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const URL = 'http://localhost:8733/ledge-openrig-omp.html';
const TITLE = 'Sièges OMP dans Ledge';

/** The agent's page as its browser shows it (the mockup's `fake`): `tab` is the view it clicked. */
const pageHtml = (tab: number) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font:13px/1.45 system-ui,sans-serif;background:#f6f5f2;color:#1d1b16}
header{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #e3e0d8}header b{font-size:13px}
.seg{display:flex;gap:2px;padding:2px;border:1px solid #e3e0d8;border-radius:7px;background:#f1efe9}.seg span{padding:2px 9px;border-radius:5px;font-size:11px;color:#6b665a}
.seg .on{background:#fff;color:#1d1b16;box-shadow:0 1px 2px #0002}main{display:grid;grid-template-columns:190px 1fr;gap:16px;padding:16px}
.side{background:#1f1f22;color:#e8e8ea;border-radius:10px;padding:10px;font-size:11.5px}.side h4{margin:4px 6px 8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9a9aa2}
.row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px}.row.sel{background:#2d2d33}.dot{width:14px;height:14px;border-radius:50%;background:#e0784f}.dot.b{background:#6c8cff}
.row small{margin-left:auto;color:#9a9aa2}.card{background:#fff;border:1px solid #e3e0d8;border-radius:10px;padding:14px 16px}.card h3{margin:0 0 6px;font-size:14px}.card p{margin:0 0 10px;color:#55524a}
.term{background:#111;color:#cfe8cf;font:11px/1.5 ui-monospace,monospace;border-radius:8px;padding:10px 12px}.tui{background:#0d1117;color:#c9d1d9;font:11px/1.6 ui-monospace,monospace;border-radius:8px;padding:12px 14px;white-space:pre;margin:16px}
</style></head><body><header><b>${TITLE}</b><div class="seg"><span class="${tab === 1 ? 'on' : ''}">1 · Desktop</span><span class="${tab === 2 ? 'on' : ''}">2 · ledge tui</span><span>3 · ledge who</span><span>4 · Textes</span></div></header>
${tab === 1 ? `<main><div class="side"><h4>Rigs</h4><div class="row"><i class="dot b"></i>dev-omp<small>2</small></div><div class="row sel"><i class="dot"></i>Ivo<small>au travail</small></div><div class="row"><i class="dot"></i>Pia<small>inactif</small></div></div>
<div><div class="card"><h3>Ivo [dev-omp] · dev.agent · OMP · au travail</h3><p>Pas de fil pour ce siège. Sa vue Terminal montre son écran : ce que tu y tapes lui est envoyé.</p><div class="term">● ST7-412 · lecture de packages/ledge/src/daemon/omp/catalog.ts<br>● 3 tests verts · 1 en cours…<br>&gt; _</div></div></div></main>`
    : `<div class="tui">── RIGS ──────────────────────────────────
● dev-omp        2 sessions
  ● Ivo   dev.agent · omp      Au travail
  ○ Pia   design.ux · omp      Inactif
● split-omp      2 sessions sur 3
  ○ Ana   dev.agent · omp      Inactif
  · Tom   review.qa · omp      Arrêté</div>`}</body></html>`;

/** A filmed frame: the page at the agent's 1280×800, as a JPEG in base64. */
async function frameOf(browser: Browser, tab: number): Promise<string> {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.setContent(pageHtml(tab));
  const jpeg = await p.screenshot({ type: 'jpeg', quality: 70 });
  await p.close();
  return jpeg.toString('base64');
}

const OTTO = session('otto', { name: 'Otto', cwd: '/w/ledge', project: 'ledge', title: 'Otto · Maquette OMP', topic: 'Maquette OMP', state: 'working' });
const seat = (id: string, name: string, extra: Partial<Session> = {}): Session => session(id, { name, tool: 'omp', cwd: '/w/ledge', project: 'ledge', title: `${name} · design.maquettiste`, state: 'working', source: 'rig',
  tmuxSession: 'design-maquettiste@dev-omp', rig: { seat: 'design-maquettiste@dev-omp', name: 'dev-omp', role: 'design.maquettiste' }, ...extra });
const MIA = seat('mia', 'Mia');
const TOM = seat('tom', 'Tom', { state: 'exited', exitedAt: ago(2), tmuxSession: 'design-relecteur@dev-omp', rig: { seat: 'design-relecteur@dev-omp', name: 'dev-omp', role: 'design.relecteur' } });
const tool = (id: string, min: number, short: string, label: string, input: object, extra: Partial<ThreadItem> = {}): ThreadItem =>
  ({ kind: 'tool', id, at: ago(min), turn: 1, tool: `mcp__playwright__${short}`, label, input: JSON.stringify(input, null, 2), status: 'success', files: [], ...extra }) as ThreadItem;
const SHOT_ID = 'c'.repeat(64);
const thread = (): ThreadItem[] => [
  { kind: 'prompt', id: 'p1', at: ago(12), turn: 1, text: 'Vérifie la vue TUI de la maquette, puis capture-la.' },
  { kind: 'tool', id: 'w1', at: ago(11), turn: 1, tool: 'Write', label: 'docs/mockups/omp-seat/tui.tsx', status: 'success', files: [] } as ThreadItem,
  { kind: 'tool', id: 'b1', at: ago(10), turn: 1, tool: 'Bash', label: 'python3 -m http.server 8733', input: 'python3 -m http.server 8733', status: 'success', files: [] } as ThreadItem,
  tool('n1', 9, 'browser_navigate', URL, { url: URL }, { output: `- Page URL: ${URL}` } as Partial<ThreadItem>),
  tool('s1', 6, 'browser_take_screenshot', 'viewport', {}, { images: [{ id: SHOT_ID, mime: 'image/jpeg', width: 1280, height: 800, bytes: 40_000, preview: false }] } as Partial<ThreadItem>),
  tool('c1', 0.05, 'browser_click', '1 · Desktop', { element: '1 · Desktop', ref: 'e12' })
];
const live = (id: string, extra: Partial<BrowserLive> = {}): Omit<BrowserLive, 'type'> => ({ id, state: 'live', tabs: 1, url: URL, title: TITLE, since: ago(9), ...extra });
const closed = (id: string, extra: Partial<BrowserLive> = {}): Omit<BrowserLive, 'type'> =>
  ({ id, state: 'closed', tabs: 0, url: URL, title: TITLE, since: ago(9), closedAt: ago(1), closed: 'browser', image: { at: ago(3), url: URL, title: TITLE }, ...extra });

async function boot(page: Page, theme: 'dark' | 'light', width: number, frames: string[], browsers: Record<string, { live: Omit<BrowserLive, 'type'>; frame?: string }> = {}, grouping: 'projects' | 'rigs' = 'projects') {
  await page.setViewportSize({ width, height: 860 });
  await page.addInitScript(([t, g]) => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.grouping', g!); } catch { /* ignore */ } }, [theme, grouping]);
  const d = await fakeDaemon(page, [OTTO, MIA, TOM], { launcher: ['ledge'], projects: twoProjects, threads: { otto: thread() }, daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true },
    images: { [SHOT_ID]: { mime: 'image/jpeg', data: frames[1]! } }, browsers });
  await page.goto('/'); await openAtelier(page);
  return d;
}
const open = async (page: Page, name: string) => {
  await page.locator('aside.sidebar').getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await page.locator('.session-page').waitFor({ timeout: 30_000 });
};
const settle = async (page: Page) => {
  await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; a?.blur(); });
  await page.waitForTimeout(400);
};
const pill = (page: Page) => page.locator('.pane-heading .browser-pill');

for (const theme of ['dark', 'light'] as const) for (const [width, w] of [[1440, 'wide'], [1100, 'narrow']] as const) {
  test(`Claude session, steps a to e, ${w}, ${theme}`, async ({ page, browser }, info) => {
    const frames = [await frameOf(browser, 1), await frameOf(browser, 2)];
    const shot = async (n: string) => { await settle(page); await page.screenshot({ path: info.outputPath(`browser-live-${n}-${w}-${theme}.png`) }); };
    const d = await boot(page, theme, width, frames);
    await open(page, 'Otto');
    // a · no browser: the captures' button of today.
    await shot('a-none');
    // b · the button appears, live.
    d.browser(live('otto'), frames[0]);
    await expect(pill(page)).toHaveClass(/browser-pill-live/);
    await shot('b-appears');
    await page.locator('.session-page .pane-heading').screenshot({ path: info.outputPath(`browser-live-zoom-heading-live-${w}-${theme}.png`) });
    // c · Direct: the film, the last action.
    await pill(page).click();
    await expect(page.locator('.browser-screen.live img')).toBeVisible();
    d.browser(live('otto'), frames[0]);
    await shot('c-live');
    await page.locator('aside.side-pane').screenshot({ path: info.outputPath(`browser-live-zoom-pane-live-${w}-${theme}.png`) });
    // d · closed: the last image, grey and dated.
    d.browser(closed('otto'), frames[1]);
    await expect(page.locator('.browser-screen.closed img')).toBeVisible();
    await shot('d-closed');
    await page.locator('aside.side-pane').screenshot({ path: info.outputPath(`browser-live-zoom-pane-closed-${w}-${theme}.png`) });
    // e · back: Direct again, with its notice.
    d.browser(live('otto'), frames[1]);
    await expect(page.locator('.browser-toast')).toBeVisible();
    await shot('e-back');
    // Captures: the tab of PR #163, beside.
    await page.locator('.browser-switch').getByRole('tab', { name: /^Captures/ }).click();
    await shot('captures');
  });

  test(`OMP seat, live, tabs closed, stopped, ${w}, ${theme}`, async ({ page, browser }, info) => {
    const frames = [await frameOf(browser, 1), await frameOf(browser, 2)];
    const shot = async (n: string) => { await settle(page); await page.screenshot({ path: info.outputPath(`browser-live-omp-${n}-${w}-${theme}.png`) }); };
    const d = await boot(page, theme, width, frames, { tom: { live: closed('tom', { url: 'about:blank', closed: 'stopped', closedAt: ago(2), image: { at: ago(4) } }), frame: frames[1] } }, 'rigs');
    await open(page, 'Mia');
    d.preview('mia', ['● ST7-251 · bascule de lien : maquette', '  écrit designs/ST7-251-link-toggle/mockup.html', "● eval · browser.open({ name: 'maq', … })", '  Opened tab "maq2" on headless browser', '● eval · tab.run(({ page }) => page.click(…))', '> _']);
    await shot('none');
    d.browser(live('mia', { url: 'about:blank' }), frames[0]);
    await expect(pill(page)).toHaveClass(/browser-pill-live/);
    await pill(page).click();
    await expect(page.locator('.browser-screen.live img')).toBeVisible();
    await shot('live');
    d.browser(closed('mia', { url: 'about:blank', closed: 'tabs', image: { at: ago(3) } }), frames[1]);
    await expect(page.locator('.browser-screen.closed img')).toBeVisible();
    await shot('tabs-closed');
    await open(page, 'Tom');
    await pill(page).click();
    await expect(page.locator('.browser-screen.closed img')).toBeVisible();
    await shot('stopped');
  });
}

for (const theme of ['dark', 'light'] as const) test(`no film: off, its confirmation, enabled, closed without image, ${theme}`, async ({ page, browser }, info) => {
  const frames = [await frameOf(browser, 1), await frameOf(browser, 2)];
  const zoom = async (n: string) => { await settle(page); await page.locator('aside.side-pane').screenshot({ path: info.outputPath(`browser-live-state-${n}-${theme}.png`) }); };
  const d = await boot(page, theme, 1440, frames, { otto: { live: { id: 'otto', state: 'off', tabs: 1, since: ago(9) } } });
  await open(page, 'Otto');
  await pill(page).click();
  await expect(page.getByText('Le direct n’est pas activé.')).toBeVisible();
  await zoom('off');
  await page.getByRole('button', { name: 'Activer le direct…' }).click();
  await zoom('confirm');
  await page.getByRole('dialog').getByRole('button', { name: 'Activer' }).click();
  await expect.poll(() => d.received.some(m => m.type === 'browser.enable')).toBe(true);
  const rid = (d.received.find(m => m.type === 'browser.enable') as { rid: string }).rid;
  d.push({ type: 'browser.enabled', rid, outcome: 'enabled', path: '/home/gch/.config/playwright-mcp/config.json' });
  await expect(page.getByText('Direct activé pour les prochaines sessions.')).toBeVisible();
  await zoom('enabled');
  d.browser(closed('otto', { image: undefined }));
  await expect(page.getByText('Aucune image prise de cet onglet.')).toBeVisible();
  await zoom('closed-no-image');
  d.browser(live('otto', { url: 'about:blank', title: undefined }));
  await expect(page.getByText('En attente de la première image…')).toBeVisible();
  await zoom('waiting');
});
