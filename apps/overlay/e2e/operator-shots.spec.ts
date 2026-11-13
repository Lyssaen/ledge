import type { Page } from '@playwright/test';
import type { NowPlaying, OperatorNotice } from '@ledge/protocol';
import { test, expect, surface, layer, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/**
 * Captures of the notch where Ledge is the only voice, to hold against board 6 of docs/mockups/ledge-operator.html (calm,
 * permission, point, rig question), dark and light, in French. Not a check: it runs only with OPERATOR_SHOTS=<folder>.
 */
const out = process.env.OPERATOR_SHOTS;
test.skip(!out, 'captures only: OPERATOR_SHOTS=<folder>');
test.use({ viewport: { width: 1000, height: 260 }, deviceScaleFactor: 2, lang: 'fr' });

const cover = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8a33c"/><stop offset=".55" stop-color="#c2452f"/><stop offset="1" stop-color="#3b1530"/></linearGradient></defs><rect width="48" height="48" fill="url(#g)"/></svg>').toString('base64')}`;
const TRACK: NowPlaying = { title: 'Lignes de fuite', artist: 'Atelier Nord', artwork: cover, playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe', name: 'Spotify' } };
const at = () => new Date().toISOString();
const POINT: OperatorNotice = { id: 'point:p1', kind: 'point', qid: 'p1', text: 'Deux choses pour toi : **pilot-lead** attend ta décision sur #309, et **Rex** a fini.', priority: 'routine', at: at() };
const RIG_ASK: OperatorNotice = { id: 'rig.ask:q9', kind: 'rig.ask', qid: 'p1', text: 'Fusionner #309 maintenant ?', who: 'pilot-lead', rig: 'ledge-dev', qitem: 'q9', options: [{ id: 'merge', label: 'Fusionner' }, { id: 'wait', label: 'Attendre qa' }], priority: 'urgent', at: at() };

async function open(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript(t => { localStorage.setItem('ledge.theme', t); localStorage.setItem('ledge.finished', 'none'); }, theme);
  const d = await fakeDaemon(page, [session('nova', { name: 'Nova' }), session('rex', { name: 'Rex', state: 'idle' })]);
  await ready(page, 2);
  return d;
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(500); // the size transition settles
  const s = (await surface(page).boundingBox())!;
  const pad = 40;
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: Math.max(0, s.x - pad), y: 0, width: Math.min(1000, s.width + 2 * pad), height: s.height + 24 } });
}

for (const theme of ['dark', 'light'] as const) {
  test(`calm: the activity line and the cover are unchanged (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    await page.evaluate(np => window.dispatchEvent(new CustomEvent('ledge:now-playing', { detail: np })), TRACK);
    await page.waitForTimeout(3200); // the track's own wake passes, so the line shows the session's action
    d.emit({ type: 'session.thread.item', id: 'nova', item: { id: 'i1', at: at(), turn: 1, kind: 'tool', tool: 'Edit', label: 'Edit packages/fleet/src/prs.ts', status: 'running', files: [] } });
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, `calm-${theme}`);
  });

  test(`permission: Ledge says what Nova wants to run (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    d.upsert(session('nova', { name: 'Nova', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm -r test -u', tool: 'Bash', source: 'hook' } }));
    await expect(layer(page, 'bubble').locator('[data-ledge-sentence]')).toBeVisible();
    await shot(page, `permission-${theme}`);
  });

  test(`point: one lead sentence, Plus tard and Voir le point (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    d.send({ type: 'operator.state', notices: [POINT] });
    await expect(layer(page, 'bubble').getByRole('button', { name: 'Voir le point' })).toBeVisible();
    await shot(page, `point-${theme}`);
  });

  test(`rig ask: the seat, its rig, the question and its options (${theme})`, async ({ page }) => {
    const d = await open(page, theme);
    d.send({ type: 'operator.state', notices: [RIG_ASK] });
    await expect(layer(page, 'bubble').getByRole('button', { name: 'Fusionner' })).toBeVisible();
    await shot(page, `rigask-${theme}`);
  });
}
