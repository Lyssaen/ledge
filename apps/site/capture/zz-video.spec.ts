import type { Page } from '@playwright/test';
import type { HarnessUsage, Session, ThreadItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects, type ChatReply } from './zz-daemon';
import { eight } from './daemon';
import { tool } from './thread';
import { installCursor, Pointer, record, EN, L } from './zz-rec';

// TEMPORARY: short videos of the real IDE for the marketing site (CDP screencast + ffmpeg). The master copy lives in the scratchpad
// (video-spec/); run-desktop.sh copies it here, runs it and removes it. Animations on: no reducedMotion.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions: { args: process.env.ZZ_GPU_OFF ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] : [] } });
test.setTimeout(240_000);
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const now = () => new Date().toISOString();
const topics: Record<string, string> = L({
  otto: 'Câbler la liste des sessions', nova: 'Reconnexion ssh du fleet', pim: 'Mouvement des mascottes', bix: 'Documenter le protocole',
  echo: 'Tests des notifications', luna: 'Nouvelle page d\'accueil', milo: 'Mise en page mobile', rio: 'Accessibilité du site'
}, {
  otto: 'Wire the session list', nova: 'Fleet ssh reconnect', pim: 'Mascot motion', bix: 'Document the protocol',
  echo: 'Notification tests', luna: 'New home page', milo: 'Mobile layout', rio: 'Site accessibility'
});
/** Eight agents on two projects, all at work: the story makes one ask, one write, one finish. */
const calm: Session[] = eight.map(s => ({
  ...s, state: 'working' as const, topic: topics[s.id] ?? s.project, title: `${s.name} · ${topics[s.id] ?? s.project}`,
  ...(s.id === 'otto' ? { model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: min(0) } } : {}),
  ...(s.id === 'nova' ? { helpers: [{ id: 'n1', kind: 'Explore', task: L('Relire le protocole', 'Review the protocol'), state: 'working' as const }] } : {})
})) as Session[];
const usage = {
  harnesses: [
    { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: min(-1), windows: [{ kind: 'five_hour', pct: 62, resetsAt: min(130) }, { kind: 'seven_day', pct: 34, resetsAt: min(3000) }] },
    { harness: 'codex', account: null, status: 'ok', readAt: min(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: min(170) }, { kind: 'seven_day', pct: 41, resetsAt: min(3000) }] }
  ] as HarnessUsage[], alerts: [], prefs: { alert: 0.8 }
};
const diffList = ['@@ -12,9 +12,14 @@ export function SessionList({ fleet }: Props) {', '   const sessions = useSessions(fleet);', '-  const sorted = sessions;', '+  const sorted = useMemo(', '+    () => [...sessions].sort(byProjectThenActivity),', '+    [sessions]', '+  );', '   return ('].join('\n');
const diffRow = ['@@ -0,0 +1,6 @@', '+import type { Session } from \'@ledge/protocol\';', '+', '+export function SessionRow({ session }: { session: Session }) {', '+  return <li className="session-row">{session.name}</li>;', '+}'].join('\n');

const wait = (page: Page, ms: number) => page.waitForTimeout(ms);
const START = { x: 760, y: 600 };

async function boot(page: Page, o: { side: 'projects' | 'atoi'; threads?: Record<string, ThreadItem[]>; chat?: ChatReply }) {
  await page.addInitScript(([layout, lang]) => {
    try {
      localStorage.setItem('desktop.lang', lang!); localStorage.setItem('desktop.theme', 'dark');
      if (!localStorage.getItem('ledge.ide.layout')) localStorage.setItem('ledge.ide.layout', layout!);
    } catch { /* ignore */ }
  }, [JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: o.side, bottom: false, bottomHeight: 240, right: false }), EN ? 'en' : 'fr']);
  await installCursor(page, START);
  const daemon = await fakeDaemon(page, calm, { projects: twoProjects, usage, machines: [{ id: 'local', label: 'WSL' }], ...(o.threads ? { threads: o.threads } : {}), ...(o.chat ? { chat: o.chat } : {}) });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.agent-seat').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const pointer = new Pointer(page, START.x, START.y);
  await pointer.park();
  return { daemon, pointer };
}
const of = (id: string) => calm.find(s => s.id === id)!;

test('atelier', async ({ page }) => {
  const { daemon, pointer } = await boot(page, { side: 'atoi' });
  await page.getByRole('button', { name: /Ajuster|Fit/ }).click();
  await pointer.park();
  await wait(page, 1500);
  const stop = await record(page, 'atelier');
  await wait(page, 2600);
  // Otto asks: its mascot turns red, the request lands in « À toi ».
  daemon.upsert({ ...of('otto'), state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm --filter desktop test', tool: 'Bash', source: 'hook' } } as Session);
  const yes = page.locator('.ide-explorer').getByRole('button', { name: L('Oui', 'Yes'), exact: true });
  await expect(yes).toBeVisible();
  await wait(page, 1300);
  await pointer.click(yes, 900);
  await wait(page, 700);
  await pointer.to(330, 520, 700);
  await wait(page, 1200);
  // Otto writes to Nova: the dotted wire and the bubble.
  daemon.upsert({ ...of('otto'), lastMessage: { id: 'sent-1', to: 'Nova', peer: 'nova', summary: L('La liste est câblée, tu peux brancher la reconnexion', 'The list is wired, you can plug in the reconnect'), at: now() } } as Session);
  await expect(page.locator('.exchange-wire path')).toHaveCount(1);
  await wait(page, 3400);
  // Bix is done: green.
  daemon.upsert({ ...of('bix'), state: 'idle', lastActivityAt: now(), lastReply: { text: L('Le protocole est documenté : 14 messages, 3 exemples.', 'The protocol is documented: 14 messages, 3 examples.'), at: now() } } as Session);
  await wait(page, 3200);
  await stop();
});

test('session', async ({ page }) => {
  const first: ThreadItem[] = [{ kind: 'prompt', id: 'prompt-1', at: min(-0.2), turn: 1, text: L('Câble la liste des sessions sur le fleet : triée par projet puis par activité. Lance les tests avant de finir.', 'Wire the session list to the fleet: sorted by project, then by activity. Run the tests before you finish.') }];
  const { daemon, pointer } = await boot(page, { side: 'projects', threads: { otto: first } });
  await page.locator('.ide-explorer').getByRole('button', { name: /^Otto/ }).first().click();
  const pane = page.getByRole('tabpanel', { name: /^Otto/ });
  await expect(pane.locator('.session-thread .turn').first()).toBeVisible({ timeout: 30_000 });
  await pointer.to(900, 560, 300);
  await wait(page, 1200);
  const stop = await record(page, 'session');
  const T = (id: string, name: string, label: string, extra: Record<string, unknown> = {}) => ({ ...tool(id, 0, name, label, extra), at: now() }) as ThreadItem;
  const step = async (id: string, name: string, label: string, ms: number, done: Record<string, unknown> = {}) => {
    const running = T(id, name, label, { status: 'running' });
    daemon.item('otto', running);
    await wait(page, ms);
    daemon.item('otto', { ...running, status: 'success', durationMs: ms, ...done } as ThreadItem);
    await wait(page, 350);
  };
  await wait(page, 1000);
  await step('t1', 'Read', '/w/ledge/src/SessionList.tsx', 700);
  await step('t2', 'Grep', 'useSessions', 600);
  await step('t3', 'Edit', '/w/ledge/src/SessionList.tsx', 800, { files: [{ path: '/w/ledge/src/SessionList.tsx', change: 'edit', diff: diffList }] });
  await step('t4', 'Write', '/w/ledge/src/SessionRow.tsx', 700, { files: [{ path: '/w/ledge/src/SessionRow.tsx', change: 'add', diff: diffRow }] });
  daemon.item('otto', { kind: 'message', id: 'msg-1', at: now(), turn: 1, text: L('La liste est câblée. Je lance la suite du bureau.', 'The list is wired. Running the desktop suite.') });
  await wait(page, 900);
  // The pinned « Votre accord » card.
  daemon.item('otto', { kind: 'permission', id: 'perm-1', at: now(), turn: 1, tool: 'Bash', text: 'pnpm --filter desktop test' });
  daemon.upsert({ ...of('otto'), state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm --filter desktop test', tool: 'Bash', source: 'hook' } } as Session);
  const allow = pane.getByRole('button', { name: /^(Autoriser|Allow)/ });
  await expect(allow).toBeVisible();
  await wait(page, 1300);
  await pointer.click(allow, 900);
  daemon.item('otto', { kind: 'permission', id: 'perm-1', at: now(), turn: 1, tool: 'Bash', text: 'pnpm --filter desktop test', decision: 'accept' });
  const run = T('t5', 'Bash', 'pnpm --filter desktop test', { status: 'running' });
  daemon.item('otto', run);
  await wait(page, 600);
  await pointer.to(980, 430, 700);
  await wait(page, 1900);
  daemon.item('otto', { ...run, status: 'success', durationMs: 3200 } as ThreadItem);
  await wait(page, 800);
  daemon.item('otto', { kind: 'reply', id: 'reply-1', at: now(), turn: 1, text: L('C\'est fait : `SessionList` trie par projet puis par activité, chaque agent a sa ligne. Les 47 tests passent.', 'Done: `SessionList` sorts by project, then by activity, and each agent has its row. All 47 tests pass.') });
  daemon.upsert({ ...of('otto'), state: 'idle', lastActivityAt: now(), lastReply: { text: L('C\'est fait : les 47 tests passent.', 'Done: all 47 tests pass.'), at: now() } } as Session);
  await wait(page, 3000);
  await stop();
});

test('chat', async ({ page }) => {
  const chat: ChatReply = {
    steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'otto', name: 'Otto' }, { kind: 'pane', id: 'luna', name: 'Luna' }],
    text: '**Otto** attend ton accord pour lancer `pnpm test` sur Ledge. **Luna** te demande quel port utiliser pour la page d\'accueil. Les autres travaillent.\n\nJe peux démarrer une session pour corriger les tests qui échouent.',
    proposal: { cwd: '/w/ledge', project: 'ledge', tool: 'claude', prompt: 'Corrige les tests de l\'overlay qui échouent' }
  };
  const { daemon, pointer } = await boot(page, { side: 'projects', chat });
  // Two of them wait, as the answer says.
  daemon.upsert({ ...of('otto'), state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm test', tool: 'Bash', source: 'hook' } } as Session);
  daemon.upsert({ ...of('luna'), state: 'waiting_input', pending: { kind: 'question', text: 'Quel port pour la page d\'accueil : 3000 ou 5173 ?', source: 'hook' } } as Session);
  await page.getByRole('button', { name: /Ajuster/ }).click();
  await pointer.park();
  await wait(page, 1500);
  const stop = await record(page, 'chat');
  await wait(page, 700);
  await pointer.click(page.getByRole('button', { name: /Panneau de droite/ }), 900);
  const panel = page.getByRole('complementary', { name: 'Chat Ledge' });
  const field = panel.getByRole('textbox').first();
  await expect(field).toBeVisible();
  await wait(page, 450);
  await pointer.click(field, 800);
  await wait(page, 300);
  await page.keyboard.type('Qui a besoin de moi ?', { delay: 65 });
  await wait(page, 450);
  await page.keyboard.press('Enter');
  const launch = panel.getByRole('button', { name: /Lancer la session/ });
  await expect(launch).toBeVisible({ timeout: 20_000 });
  await wait(page, 1100);
  await pointer.click(launch, 800);
  await wait(page, 1500);
  const fresh = daemon.received.filter(m => m.type === 'session.launch').length ? session('launched-1', { name: 'Juno', tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: 'Juno · ledge', topic: 'Corriger les tests de l\'overlay', state: 'working', startedAt: now(), lastActivityAt: now() }) : null;
  if (fresh) daemon.upsert(fresh);
  await pointer.to(820, 640, 700);
  await wait(page, 2000);
  await stop();
});
