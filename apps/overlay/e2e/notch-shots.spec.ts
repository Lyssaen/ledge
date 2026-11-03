import type { Page } from '@playwright/test';
import type { NowPlaying } from '@ledge/protocol';
import { test, expect, surface, layer, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/**
 * Captures of the closed notch, to hold against the mockup's (docs/mockups/ledge-notch-activity-*.png). Not a check:
 * it runs only with NOTCH_SHOTS=<folder>, and writes there one zoomed PNG per state, dark and light.
 */
const out = process.env.NOTCH_SHOTS;
test.skip(!out, 'captures only: NOTCH_SHOTS=<folder>');
test.use({ viewport: { width: 1000, height: 160 }, deviceScaleFactor: 3 });

const cover = (a: string, b: string, c: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="48" height="48" fill="url(#g)"/></svg>`).toString('base64')}`;
const TRACK: NowPlaying = { title: 'Lignes de fuite', artist: 'Atelier Nord', artwork: cover('#e8a33c', '#c2452f', '#3b1530'), playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe', name: 'Spotify' } };
const WEB: NowPlaying = { title: 'Live coding session #41 — building a notch in Tauri', artist: '', artwork: cover('#f2e6d0', '#b78ad9', '#4b2a7a'), playing: true, can: { previous: false, playPause: true, next: true }, player: { id: 'Chrome' } };
const at = () => new Date().toISOString();
const fleet = [session('otto'), session('nova', { name: 'Nova' }), session('pim', { name: 'Pim', tool: 'codex' })];

async function open(page: Page, theme: 'dark' | 'light', opts: { dnd?: boolean } = {}) {
  await page.addInitScript(([t, dnd]) => { localStorage.setItem('ledge.theme', t as string); localStorage.setItem('ledge.finished', 'none'); if (dnd) localStorage.setItem('desktop.dnd', '1'); }, [theme, !!opts.dnd] as const);
  const d = await fakeDaemon(page, fleet);
  await ready(page, 3);
  return d;
}
const play = (page: Page, np: NowPlaying | null) => page.evaluate(s => window.dispatchEvent(new CustomEvent('ledge:now-playing', { detail: s })), np);
let n = 0;
const item = (id: string, x: Record<string, unknown>) => ({ type: 'session.thread.item', id, item: { id: `i${++n}`, at: at(), turn: 1, ...x } });
async function shot(page: Page, name: string) {
  await page.waitForTimeout(450); // the size transition settles
  const s = (await surface(page).boundingBox())!;
  const pad = 40;
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: Math.max(0, s.x - pad), y: 0, width: Math.min(1000, s.width + 2 * pad), height: s.height + 24 } });
}

for (const theme of ['dark', 'light'] as const) {
  test(`rest: Ledge alone, then the bars while a track plays (${theme})`, async ({ page }) => {
    await open(page, theme);
    await shot(page, `rest-${theme}`);
    await play(page, TRACK);
    // A track that starts wakes the notch for 5 s; then the filet keeps its bars.
    await expect(layer(page, 'handle').locator('[data-eq]')).toBeVisible({ timeout: 8000 });
    await shot(page, `rest-music-${theme}`);
  });

  test(`rest: a permission waits, Ledge's mark turns red over DND grey (${theme})`, async ({ page }) => {
    const d = await open(page, theme, { dnd: true });
    await play(page, TRACK);
    d.upsert(session('pim', { name: 'Pim', tool: 'codex', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm up --latest && pnpm test', source: 'hook' } }));
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, `wake-permission-dnd-${theme}`);
    await expect(surface(page)).not.toHaveAttribute('data-awake', 'true', { timeout: 8000 });
    await shot(page, `rest-pending-${theme}`);
    // Hovered: the request's dot takes the update dot's place on Ledge.
    await surface(page).hover();
    await expect(layer(page, 'handle').locator('[data-pending-dot]')).toBeVisible();
    await shot(page, `reopen-${theme}`);
  });

  test(`awake: a message, then an action replaces it after its 3 s (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    await play(page, TRACK);
    d.emit(item('otto', { kind: 'sent', to: 'nova', peer: 'nova', text: 'Maquette validée, tu peux brancher la ligne d’activité', status: 'delivered' }));
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, `wake-message-${theme}`);
    await page.waitForTimeout(2700);
    d.emit(item('otto', { kind: 'tool', tool: 'Edit', label: 'Edit apps/overlay/src/surface/Handle.tsx', status: 'running', files: [] }));
    await expect(layer(page, 'handle').locator('[data-line]')).toHaveAttribute('title', /edits/);
    await shot(page, `wake-tool-${theme}`);
  });

  test(`awake: a long message is cut, the cover never (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    await play(page, TRACK);
    d.emit(item('pim', { kind: 'sent', to: 'dev-front@ledge-dev-2', text: 'Relis la fiche de passation avant de commencer : la pochette ne doit jamais être coupée, c’est la ligne qui cède la place, et le survol garde l’encoche éveillée', status: 'delivered' }));
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, `long-${theme}`);
  });

  test(`music: a new track wakes it; the cover's hover opens plain controls (${theme})`, async ({ page }) => {
    await open(page, theme);
    await play(page, TRACK);
    await page.waitForTimeout(300);
    await play(page, { ...TRACK, title: 'Sous la verrière', artist: 'Halles 72', artwork: cover('#9fd3c7', '#3a7a8c', '#162a3d') });
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, `track-${theme}`);
    await layer(page, 'handle').locator('[data-music]').hover();
    await expect(layer(page, 'handle').locator('[data-music][data-open]')).toBeVisible();
    await shot(page, `hover-${theme}`);
  });

  test(`music: refused controls, then paused, on hover (${theme})`, async ({ page }) => {
    await open(page, theme);
    await play(page, WEB);
    await surface(page).hover();
    await layer(page, 'handle').locator('[data-music]').hover();
    await page.waitForTimeout(900);
    await shot(page, `refused-${theme}`);
    await play(page, { ...TRACK, playing: false });
    await page.waitForTimeout(300);
    await shot(page, `paused-${theme}`);
  });

  test(`awake: thinking, a sub-agent's search (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    d.emit(item('nova', { kind: 'sent', to: 'otto', peer: 'otto', text: 'Je regarde', status: 'delivered' }));
    await page.waitForTimeout(3100);
    d.emit(item('nova', { kind: 'prompt', text: 'go' }));
    await expect(layer(page, 'handle').locator('[data-line]')).toHaveAttribute('title', /thinking/);
    await shot(page, `thinking-${theme}`);
    d.emit(item('otto', { kind: 'tool', tool: 'Glob', label: 'Glob apps/overlay/**/*.tsx', status: 'running', files: [], helperId: 'h1' }));
    await expect(layer(page, 'handle').locator('[data-line]')).toHaveAttribute('title', /searches/);
    await shot(page, `helper-${theme}`);
  });
}
