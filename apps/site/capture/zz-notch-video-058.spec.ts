import type { Session } from '@ledge/protocol';
import { test, expect, layer, expectMode, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';
import { installCursor, Pointer, record } from './zz-rec';

// TEMPORARY: a short video of the real notch for the marketing site. Master copy in apps/site/capture; run-overlay.sh
// copies it here, runs it and removes it. A CDP screencast ignores deviceScaleFactor, so the page itself is drawn twice as large
// (the body scaled by 2 and pulled back to the centre in a 2000×1200 viewport, as a 1000×600 screen at 2x): the video is the 1240×460 crop of its top centre,
// 620×230 CSS px of the notch.
const W = 2000, H = 1200, Z = 2, CW = 620, CH = 230;
test.use({ viewport: { width: W, height: H }, deviceScaleFactor: 1, lang: 'fr' });
test.setTimeout(180_000);

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const now = () => new Date().toISOString();
const fleet: Session[] = [
  session('otto', { name: 'Otto', project: 'ledge', startedAt: ago(18) }),
  session('nova', { name: 'Nova', project: 'ledge', startedAt: ago(12) }),
  session('pim', { name: 'Pim', tool: 'codex', project: 'website', startedAt: ago(8) }),
  session('bix', { name: 'Bix', project: 'ledge', startedAt: ago(14) })
];
let n = 0;
const item = (id: string, x: Record<string, unknown>) => ({ type: 'session.thread.item', id, item: { id: `i${++n}`, at: now(), turn: 1, ...x } });

test('notch', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('ledge.theme', 'dark'); } catch { /* ignore */ } });
  const START = { x: W / 2 + 190 * Z, y: 185 * Z, k: Z };
  await installCursor(page, START);
  const d = await fakeDaemon(page, fleet);
  await ready(page, 4);
  await page.addStyleTag({ content: `html, body { background: #1b1c17 !important; } body { transform: translate(${-W / 2}px, 0) scale(${Z}); transform-origin: 0 0; margin: 0; }` });
  await page.evaluate(() => document.fonts.ready);
  const pointer = new Pointer(page, START.x, START.y);
  await pointer.park();
  await page.waitForTimeout(7000); // whatever the arrival woke has gone back to rest
  const stop = await record(page, 'notch', { crop: { x: (W - CW * Z) / 2, y: 0, w: CW * Z, h: CH * Z } });
  const wait = (ms: number) => page.waitForTimeout(ms);
  await wait(500);
  // A message between agents wakes the notch with its activity line; an action follows on the same line.
  d.emit(item('nova', { kind: 'sent', to: 'otto', peer: 'otto', text: 'Reconnexion corrigée, tu peux lancer les tests', status: 'delivered' }));
  await wait(1700);
  d.emit(item('nova', { kind: 'tool', tool: 'Edit', label: 'Edit src/fleet/reconnect.ts', status: 'running', files: [] }));
  await wait(1300);
  // Otto asks: the bubble stretches open.
  d.upsert({ ...fleet[0]!, state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm --filter desktop test', tool: 'Bash', source: 'hook' } });
  await expectMode(page, 'bubble');
  const allow = layer(page, 'bubble').getByRole('button', { name: 'Autoriser' });
  await expect(allow).toBeVisible();
  await wait(1200);
  await pointer.click(allow, 700);
  await wait(250);
  d.upsert({ ...fleet[0]!, state: 'working', lastActivityAt: now() });
  await expectMode(page, 'handle');
  await pointer.to(START.x, START.y, 700);
  await wait(1300);
  // Bix is done: the « a terminé » bubble, then back to rest.
  d.upsert({ ...fleet[3]!, state: 'idle', lastActivityAt: now(), lastReply: { text: 'Le protocole est documenté : 14 messages, 3 exemples.', at: now() } });
  await expectMode(page, 'bubble');
  await wait(1800);
  const ok = layer(page, 'bubble').getByRole('button', { name: 'OK', exact: true });
  if (await ok.count()) { await pointer.click(ok, 800); await pointer.to(START.x, START.y, 700); }
  await expectMode(page, 'handle', );
  await wait(1500);
  await stop();
});
