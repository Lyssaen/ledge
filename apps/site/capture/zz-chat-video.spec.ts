import type { Page } from '@playwright/test';
import type { ChatAction, ChatPoint, ChatTurn, ClientMessage, HarnessUsage, PointItem, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects, type ChatReply } from './zz-daemon';
import { eight } from './daemon';
import { installCursor, Pointer, record, EN, L } from './zz-rec';

// TEMPORARY: chat.mp4 at 0.60.0, Ledge the operator in the right panel (PR #316): « Le point » posted unasked, one « À toi » line
// answered in place, then a question answered with an action card. Master copy in apps/site/capture; run-chat.sh copies
// it into apps/desktop/e2e with zz-daemon.ts (e2e/daemon.ts, its chat answer paced), runs it and removes it.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions: { args: process.env.ZZ_GPU_OFF ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] : [] } });
test.setTimeout(240_000);
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const now = () => new Date().toISOString();
const RIG = L('ledge-equipe', 'ledge-team');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(EN ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
const topics: Record<string, string> = L({
  otto: 'Câbler la liste des sessions', nova: 'Reconnexion ssh du fleet', pim: 'Mouvement des mascottes', bix: 'Documenter le protocole',
  echo: 'Tests des notifications', luna: 'Nouvelle page d\'accueil', milo: 'Mise en page mobile', rio: 'Accessibilité du site'
}, {
  otto: 'Wire the session list', nova: 'Fleet ssh reconnect', pim: 'Mascot motion', bix: 'Document the protocol',
  echo: 'Notification tests', luna: 'New home page', milo: 'Mobile layout', rio: 'Site accessibility'
});
/** Eight agents on two projects: Bix and Echo have finished, the others work; Nova's context is nearly full. */
const fleet: Session[] = eight.map(s => ({
  ...s, state: 'working' as const, topic: topics[s.id] ?? s.project, title: `${s.name} · ${topics[s.id] ?? s.project}`,
  ...(s.id === 'bix' ? { state: 'idle' as const, lastReply: { text: L('Le protocole est documenté : 14 messages, 3 exemples.', 'The protocol is documented: 14 messages, 3 examples.'), at: min(-12) } } : {}),
  ...(s.id === 'echo' ? { state: 'idle' as const, lastReply: { text: L('14 tests ajoutés, tous verts.', '14 tests added, all green.'), at: min(-6) } } : {}),
  ...(s.id === 'nova' ? { model: 'claude-opus-5-5', context: { used: 172_000, window: 200_000, at: min(0) } } : {})
})) as Session[];
const usage = {
  harnesses: [
    { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: min(-1), windows: [{ kind: 'five_hour', pct: 62, resetsAt: min(130) }, { kind: 'seven_day', pct: 34, resetsAt: min(3000) }] },
    { harness: 'codex', account: null, status: 'ok', readAt: min(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: min(170) }, { kind: 'seven_day', pct: 41, resetsAt: min(3000) }] }
  ] as HarnessUsage[], alerts: [], prefs: { alert: 0.8 }
};

// The point, as the daemon writes it (packages/protocol/src/operator.ts; e2e/operator-point.spec.ts).
const SINCE = min(-40);
const item = (o: Partial<PointItem> & Pick<PointItem, 'id' | 'group'>): PointItem => ({ event: 1, tone: 'idle', who: 'Bix', text: '', at: min(-10), ...o });
const ASK = 'rig.ask:q41';
const ITEMS: PointItem[] = [
  item({ id: ASK, event: 12, group: 'atoi', tone: 'ask', who: 'pilot-lead', rig: RIG, text: L('Liste des sessions : tri par projet, ou par dernière activité ?', 'Session list: sort by project, or by last activity?'), at: min(-2), ref: { kind: 'rig.ask', qitem: 'q41' },
    answers: [{ id: 'project', label: L('Par projet', 'By project'), style: 'primary' }, { id: 'activity', label: L('Par activité', 'By activity'), style: 'plain' }], freeText: true, nav: [{ kind: 'rig', id: RIG }] }),
  item({ id: 'session:bix', event: 9, group: 'done', who: 'Bix', text: L('a fini « Documenter le protocole »', 'finished “Document the protocol”'), sub: L('PR #312 ouverte, tests verts', 'PR #312 open, tests green'), at: min(-12),
    suggestion: { action: 'session.archive', args: { session: 'bix' }, summary: L('Archiver **Bix**', 'Archive **Bix**'), vars: { session: 'Bix' }, risk: 'reversible' } }),
  item({ id: 'session:echo', event: 10, group: 'done', who: 'Echo', text: L('a fini « Tests des notifications »', 'finished “Notification tests”'), sub: L('14 tests ajoutés, tous verts', '14 tests added, all green'), at: min(-6) }),
  item({ id: 'task:t1', event: 4, group: 'ongoing', tone: 'work', who: 'Nova', text: L('tient « Reconnexion ssh du fleet » depuis 40 min', 'has held “Fleet ssh reconnect” for 40 min'), sub: L('contexte à 86 %', 'context at 86 %') }),
  item({ id: `rig:${RIG}`, event: 11, group: 'rigs', tone: 'work', who: RIG, text: L(': review.qa relit la PR #312', ': review.qa is reviewing PR #312'), nav: [{ kind: 'rig', id: RIG }] })
];
const point = (items: PointItem[] = ITEMS): ChatPoint => ({ since: SINCE, lead: L(`Depuis ${hhmm(SINCE)}, cinq choses. **Une t’attend.**`, `Since ${hhmm(SINCE)}, five things. **One is waiting for you.**`), leadBy: 'agent', items });
const POINT_AT = now();
const pointTurn = (p: ChatPoint): ChatTurn => ({ qid: 'point-1', question: '', askedAt: POINT_AT, steps: [], answeredAt: POINT_AT, by: 'ledge', point: p }) as ChatTurn;

const handover: ChatAction = { action: 'session.handover', args: { session: 'nova' }, summary: L('Passer le relais de **Nova**', 'Hand over **Nova**'), vars: { session: 'Nova' }, risk: 'reversible' };
const chat: ChatReply = {
  steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'nova', name: 'Nova' }],
  text: L('**Nova** a corrigé la reconnexion ssh : le délai double à chaque essai, les 12 tests passent. Elle ajoute un dernier test, mais son contexte est à 86 %.\n\nJe peux lui faire passer le relais à une session fraîche.',
    '**Nova** fixed the ssh reconnect: the delay doubles on each try, and the 12 tests pass. It is adding one last test, but its context is at 86 %.\n\nI can hand it over to a fresh session.'),
  actions: [handover]
};

type Of<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;
const START = { x: 760, y: 600 };
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const QUESTION = L('Où en est Nova ?', 'How is Nova doing?');
const BY_PROJECT = L('Par projet', 'By project');

test('chat', async ({ page }) => {
  await page.addInitScript(([layout, lang]) => {
    try {
      localStorage.setItem('desktop.lang', lang!); localStorage.setItem('desktop.theme', 'dark');
      if (!localStorage.getItem('ledge.ide.layout')) localStorage.setItem('ledge.ide.layout', layout!);
    } catch { /* ignore */ }
  }, [JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 240, right: true }), EN ? 'en' : 'fr']);
  await installCursor(page, START);
  const daemon = await fakeDaemon(page, fleet, { projects: twoProjects, usage, machines: [{ id: 'local', label: 'WSL' }], chat });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.agent-seat').first()).toBeVisible({ timeout: 30_000 });
  const panel = page.locator('.ledge-chat-panel');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: /Ajuster|Fit/ }).click();
  const pointer = new Pointer(page, START.x, START.y);
  await pointer.park();
  await wait(page, 1500);

  const stop = await record(page, 'chat');
  await wait(page, 1300);
  // Ledge posts the point of itself.
  daemon.push({ type: 'chat.history', turns: [pointTurn(point())] });
  const box = panel.locator('[data-point]');
  await expect(box).toBeVisible();
  await wait(page, 2400);
  // One « À toi » line answered in place: it keeps a receipt.
  const row = panel.locator(`[data-point-item="${ASK}"]`);
  await pointer.click(row.getByRole('button', { name: BY_PROJECT }), 900);
  await expect.poll(() => daemon.received.some(m => m.type === 'point.act'), { timeout: 10_000 }).toBe(true);
  await wait(page, 450);
  const settled = ITEMS.map(i => (i.id === ASK ? { ...i, settled: { at: now(), where: 'chat' as const, answer: BY_PROJECT } } : i));
  daemon.push({ type: 'chat.history', turns: [pointTurn(point(settled))] });
  await wait(page, 1500);
  // A question, its streamed answer and its action card.
  const field = panel.getByPlaceholder(L('Demander à Ledge…', 'Ask Ledge…'));
  await pointer.click(field, 800);
  await wait(page, 250);
  await page.keyboard.type(QUESTION, { delay: 65 });
  await wait(page, 400);
  await page.keyboard.press('Enter');
  const card = panel.locator('[data-action-card]');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await wait(page, 1200);
  await pointer.click(card.getByRole('button').last(), 800);
  await expect.poll(() => daemon.received.some(m => m.type === 'chat.act'), { timeout: 10_000 }).toBe(true);
  const act = daemon.received.find((m): m is Of<'chat.act'> => m.type === 'chat.act')!;
  const ask = daemon.received.find((m): m is Of<'chat.ask'> => m.type === 'chat.ask')!;
  await wait(page, 500);
  const at = now();
  daemon.push({ type: 'chat.acted', rid: act.rid, qid: act.qid, done: [0], failed: [] });
  daemon.push({ type: 'chat.history', turns: [pointTurn(point(settled)), { qid: ask.qid, question: QUESTION, askedAt: at, steps: chat.steps, answer: chat.text, answeredAt: at, actions: [{ ...handover, state: 'done', doneAt: at }] }] });
  await pointer.to(820, 640, 700);
  await wait(page, 2000);
  await stop();
});
