import type { Page } from '@playwright/test';
import type { ClientMessage, OperatorNotice, Session } from '@ledge/protocol';
import { test, expect, layer, surface, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { installCursor, Pointer, record, VIDEO, EN, L } from './zz-rec';

// TEMPORARY: the notch at 0.60.0, where Ledge is its only voice (PR #316), for the marketing site: notch.mp4 and three stills.
// Master copy in apps/site/capture; run-overlay.sh copies it into apps/overlay/e2e, runs it and removes it.
// ZZ_GPU_OFF=1 launches Chromium with the flags this machine needs when headless screenshots hang.
const GPU_OFF = process.env.ZZ_GPU_OFF ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] : [];
test.use({ launchOptions: { args: GPU_OFF } });
test.setTimeout(180_000);

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const now = () => new Date().toISOString();
const RIG = L('ledge-equipe', 'ledge-team');
const fleet: Session[] = [
  session('otto', { name: 'Otto', project: 'ledge', startedAt: ago(18) }),
  session('nova', { name: 'Nova', project: 'ledge', startedAt: ago(12) }),
  session('pim', { name: 'Pim', tool: 'codex', project: 'website', startedAt: ago(8) }),
  session('bix', { name: 'Bix', project: 'ledge', startedAt: ago(14) })
];
const asking = (): Session => ({ ...fleet[0]!, state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm --filter desktop test', tool: 'Bash', source: 'hook' } });
const POINT = (): OperatorNotice => ({ id: 'point:p1', kind: 'point', qid: 'p1', text: L('Trois choses pour toi : **Bix** et **Pim** ont fini, et **pilot-lead** attend ta décision sur #312.', 'Three things for you: **Bix** and **Pim** are done, and **pilot-lead** is waiting for your decision on #312.'), priority: 'routine', at: now() });
const RIG_ASK = (): OperatorNotice => ({ id: 'rig.ask:q9', kind: 'rig.ask', qid: 'p1', text: L('Fusionner #312 maintenant ?', 'Merge #312 now?'), who: 'pilot-lead', rig: RIG, qitem: 'q9', options: [{ id: 'merge', label: L('Fusionner', 'Merge') }, { id: 'wait', label: L('Attendre qa', 'Wait for qa') }], priority: 'urgent', at: now() });
let n = 0;
const item = (id: string, x: Record<string, unknown>) => ({ type: 'session.thread.item', id, item: { id: `i${++n}`, at: now(), turn: 1, ...x } });
const has = (list: ClientMessage[], type: ClientMessage['type']) => list.some(m => m.type === type);

test.describe('video', () => {
  // A CDP screencast ignores deviceScaleFactor, so the page itself is drawn twice as large (the body scaled by 2 and pulled back to
  // the centre in a 2000×1200 viewport, as a 1000×600 screen at 2x): the video is the 1240×460 crop of its top centre, 620×230 CSS px.
  const W = 2000, H = 1200, Z = 2, CW = 620, CH = 230;
  test.use({ viewport: { width: W, height: H }, deviceScaleFactor: 1, lang: EN ? 'en' : 'fr' });

  test('notch', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); } catch { /* ignore */ } });
    const START = { x: W / 2 + 190 * Z, y: 185 * Z, k: Z };
    await installCursor(page, START);
    const d = await fakeDaemon(page, fleet);
    await ready(page, 4);
    await page.addStyleTag({ content: `html, body { background: #1b1c17 !important; } body { transform: translate(${-W / 2}px, 0) scale(${Z}); transform-origin: 0 0; margin: 0; }` });
    const pointer = new Pointer(page, START.x, START.y);
    await pointer.park();
    await page.waitForTimeout(7000); // whatever the arrival woke has gone back to rest
    const stop = await record(page, 'notch', { crop: { x: (W - CW * Z) / 2, y: 0, w: CW * Z, h: CH * Z } });
    const wait = (ms: number) => page.waitForTimeout(ms);
    await wait(900);
    // A permission is said at once: Ledge's sentence, Refuser / Autoriser.
    d.upsert(asking());
    await expectMode(page, 'bubble');
    const allow = layer(page, 'bubble').getByRole('button', { name: L('Autoriser', 'Approve') });
    await expect(allow).toBeVisible();
    await wait(1700);
    await pointer.click(allow, 750);
    await wait(250);
    d.upsert({ ...fleet[0]!, state: 'working', lastActivityAt: now() });
    await expectMode(page, 'handle');
    await pointer.to(START.x, START.y, 650);
    await wait(1300);
    // Later Ledge speaks: the point (two sessions finished, a rig waits). « Plus tard » sets it aside.
    // (No session is turned idle here: its « a terminé » activity line would cross the point's bubble.)
    const point = POINT();
    d.send({ type: 'operator.state', notices: [point] });
    const later = layer(page, 'bubble').getByRole('button', { name: L('Plus tard', 'Later'), exact: true });
    await expect(later).toBeVisible();
    await wait(2400);
    await pointer.click(later, 750);
    await expectMode(page, 'handle');
    await pointer.to(START.x, START.y, 650);
    await wait(900);
    // The rig's urgent question, answered in place.
    d.send({ type: 'operator.state', notices: [RIG_ASK(), point] });
    const merge = layer(page, 'bubble').getByRole('button', { name: L('Fusionner', 'Merge') });
    await expect(merge).toBeVisible();
    await wait(1700);
    await pointer.click(merge, 750);
    await expect.poll(() => has(d.received, 'point.act')).toBe(true);
    await wait(300);
    d.send({ type: 'operator.state', notices: [] });
    await expectMode(page, 'handle');
    await pointer.to(START.x, START.y, 650);
    await wait(1300);
    await stop();
  });
});

test.describe('stills', () => {
  // Sharp stills on a transparent background: the notch alone, at deviceScaleFactor 2.
  test.use({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: 2, lang: EN ? 'en' : 'fr' });
  async function open(page: Page) {
    await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); } catch { /* ignore */ } });
    const d = await fakeDaemon(page, fleet);
    await ready(page, 4);
    await page.addStyleTag({ content: 'html, body { background: transparent !important; }' });
    return d;
  }
  async function shot(page: Page, name: string) {
    await page.waitForTimeout(1800); // the size transition and the text's fade settle
    const s = (await surface(page).boundingBox())!;
    const pad = 16;
    await page.screenshot({ path: `${VIDEO}${name}.png`, omitBackground: true, clip: { x: Math.max(0, s.x - pad), y: 0, width: s.width + 2 * pad, height: s.height + pad } });
  }
  test('handle', async ({ page }) => {
    const d = await open(page);
    d.emit(item('nova', { kind: 'sent', to: 'otto', peer: 'otto', text: L('Reconnexion corrigée, tu peux lancer les tests', 'Reconnect fixed, you can run the tests'), status: 'delivered' }));
    await expect(layer(page, 'handle').locator('[data-line]')).toBeVisible();
    await shot(page, 'notch60-handle');
  });
  test('ask', async ({ page }) => {
    const d = await open(page);
    d.upsert(asking());
    await expect(layer(page, 'bubble').getByRole('button', { name: L('Autoriser', 'Approve') })).toBeVisible();
    await shot(page, 'notch60-ask');
  });
  test('point', async ({ page }) => {
    const d = await open(page);
    d.send({ type: 'operator.state', notices: [POINT()] });
    await expect(layer(page, 'bubble').getByRole('button', { name: L('Voir le point', 'See the point') })).toBeVisible();
    await shot(page, 'notch60-point');
  });
});
