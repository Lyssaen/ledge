import type { Page } from '@playwright/test';
import type { HarnessUsage, HumanAsk, HumanChannel, OpenRigState, RigGraph, RigRow, RigSpec, Session } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';
import { ottoThread } from './thread';
import { installCursor, Pointer, record, EN, L } from './zz-rec';
import { at as tAt, tool } from './thread';
import type { ThreadItem } from '@ledge/protocol';

// TEMPORARY: rig.mp4, Ledge driving OpenRig, for the marketing site. Master copy in apps/site/capture; run-rig.sh copies
// it into apps/desktop/e2e, runs it and removes it. The fake daemon answers `openrig.status`, `.graph` and `.asks` from objects this
// spec owns: the story mutates them and pushes `openrig.state` / `openrig.asksChanged`, as the daemon broadcasts them.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, launchOptions: { args: process.env.ZZ_GPU_OFF ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] : [] } });
test.setTimeout(240_000);
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const topics: Record<string, string> = L({
  otto: 'Câbler la liste des sessions', nova: 'Reconnexion ssh du fleet', pim: 'Mouvement des mascottes', bix: 'Documenter le protocole',
  echo: 'Tests des notifications', luna: 'Nouvelle page d\'accueil', milo: 'Mise en page mobile', rio: 'Accessibilité du site'
}, {
  otto: 'Wire the session list', nova: 'Fleet ssh reconnect', pim: 'Mascot motion', bix: 'Document the protocol',
  echo: 'Notification tests', luna: 'New home page', milo: 'Mobile layout', rio: 'Site accessibility'
});
const calm: Session[] = eight.map(s => ({ ...s, state: 'working' as const, topic: topics[s.id] ?? s.project, title: `${s.name} · ${topics[s.id] ?? s.project}`,
  // Otto has finished its turn: its thread is still (no live line turning under the modal's blur).
  ...(s.id === 'otto' ? { state: 'idle' as const, lastReply: { text: L('Deux tests échouent.', 'Two tests fail.'), at: min(-1) } } : {}) })) as Session[];
const usage = {
  harnesses: [
    { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: min(-1), windows: [{ kind: 'five_hour', pct: 62, resetsAt: min(130) }, { kind: 'seven_day', pct: 34, resetsAt: min(3000) }] },
    { harness: 'codex', account: null, status: 'ok', readAt: min(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: min(170) }, { kind: 'seven_day', pct: 41, resetsAt: min(3000) }] }
  ] as HarnessUsage[], alerts: [], prefs: { alert: 0.8 }
};

// OpenRig: the kernel and one team already running; « equipe-produit » is the spec the story launches.
const OLD = L('ledge-equipe', 'ledge-team'), NEW = L('equipe-produit', 'product-team');
const sessOf = (rig: string, id: string) => `${id.replace('.', '-')}@${rig}`;
type Seat = [id: string, pod: string, role: string, runtime: string];
const OLD_SEATS: Seat[] = [['pilot.lead', 'pilot', 'orchestrator', 'claude-code'], ['dev.build', 'dev', 'implementer', 'claude-code'], ['review.qa', 'review', 'qa', 'codex']];
const NEW_SEATS: Seat[] = [['pilot.lead', 'pilot', 'orchestrator', 'claude-code'], ['dev.front', 'dev', 'implementer', 'claude-code'], ['dev.front-2', 'dev', 'implementer', 'claude-code'], ['dev.back', 'dev', 'implementer', 'codex'], ['review.qa', 'review', 'qa', 'codex']];
const PODS = [{ id: 'pilot', label: L('Pilotage', 'Steering') }, { id: 'dev', label: L('Développement', 'Development') }, { id: 'review', label: L('Revue', 'Review') }];
/** Otto's finished thread in English (the stock `ottoThread` is French). */
const enThread: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: tAt(-600), turn: 1, text: 'Wire the list' },
  tool('t1', -590, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
  tool('t2', -580, 'Grep', 'useKeys', { durationMs: 300 }),
  tool('t3', -570, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
  { kind: 'message', id: 'msg-1', at: tAt(-560), turn: 1, text: 'Running the tests.' },
  { kind: 'permission', id: 'perm-1', at: tAt(-550), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
  tool('t4', -540, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
  { kind: 'reply', id: 'reply-1', at: tAt(-520), turn: 1, text: 'Two tests fail.' }
];
const node = (rig: string, id: string, runtime: string, activity = 'running') => ({ logicalId: id, session: sessOf(rig, id), runtime, model: null, sessionStatus: 'running', lifecycleState: 'running', activity, stopped: false, work: 1 });
const gseat = (rig: string, [id, pod, role, runtime]: Seat) => ({ logicalId: id, pod, role, runtime, status: 'running', session: sessOf(rig, id), attention: false });
const openrig = {
  installed: true, version: '0.7.10', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
  rigs: [
    { id: '1', name: OLD, status: 'running', lifecycleState: 'running', seats: 3, running: 3, attention: 0, uptime: '2h', snapshot: null, specPath: `/home/me/.ledge/rigs/${OLD}/rig.yaml`, nodes: OLD_SEATS.map(([id, , , rt]) => node(OLD, id, rt)) },
    { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: '2h', snapshot: null, nodes: [] }
  ] as Record<string, unknown>[]
};
const graphs: Record<string, RigGraph> = {
  [OLD]: { pods: PODS, seats: OLD_SEATS.map(s => gseat(OLD, s)), links: [{ from: 'pilot.lead', to: 'dev.build', kind: 'delegates_to' }, { from: 'dev.build', to: 'review.qa', kind: 'delegates_to' }] } as RigGraph,
  [NEW]: { pods: [], seats: [], links: [] } as unknown as RigGraph
};
const LINKS = [{ from: 'pilot.lead', to: 'dev.front', kind: 'delegates_to' }, { from: 'pilot.lead', to: 'dev.front-2', kind: 'delegates_to' }, { from: 'pilot.lead', to: 'dev.back', kind: 'delegates_to' }, { from: 'dev.back', to: 'review.qa', kind: 'delegates_to' }];
const specs = [
  { name: 'starter', source: 'builtin', path: '/specs/starter.yaml', edges: 1, pods: [{ id: 'dev', members: [{ id: 'builder', runtime: 'claude-code', agent: 'x' }, { id: 'reviewer', runtime: 'codex', agent: 'x' }] }] },
  { name: NEW, source: 'user', path: `/home/me/.openrig/specs/${NEW}.yaml`, edges: 3, pods: [{ id: 'pilot', members: [{ id: 'lead', runtime: 'claude-code', agent: 'x' }] }, { id: 'dev', members: [{ id: 'front', runtime: 'claude-code', agent: 'x' }, { id: 'back', runtime: 'codex', agent: 'x' }] }, { id: 'review', members: [{ id: 'qa', runtime: 'codex', agent: 'x' }] }] }
] as unknown as RigSpec[];
const queue: RigRow[] = [{ id: 'qitem-20261113093000-1a2b3c4d5e6f7a80', state: 'in-progress', summary: L('Découper le lot « liste des sessions » entre front et back', 'Split the “session list” batch between front and back'), from: 'operator-human@kernel', to: sessOf(NEW, 'pilot.lead'), createdAt: min(0), updatedAt: min(0), at: min(0), claimedAt: min(0) }] as unknown as RigRow[];
const READY = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false } as HumanChannel;
const ASK_ID = 'qitem-192556';
const ASK = {
  id: ASK_ID, kind: 'decision', alert: false, priority: 'routine', bodyTruncated: false, detail: null, evidenceRef: null, createdAt: min(0), updatedAt: min(0),
  from: { seat: sessOf(NEW, 'pilot.lead'), rig: NEW, role: 'pilot.lead' }, summary: L('Liste des sessions : tri par projet, ou par dernière activité ?', 'Session list: sort by project, or by last activity?'),
  body: L('Le tri par projet garde les équipes ensemble ; le tri par activité met en haut ce qui vient de bouger. La maquette montre le premier.', 'Sorting by project keeps teams together; sorting by activity puts what just moved on top. The mockup shows the first.'),
  questions: [{ id: 'q', question: L('Quel tri ?', 'Which sort?'), options: [{ id: 'project', label: L('Par projet', 'By project'), recommended: true }, { id: 'activity', label: L('Par activité', 'By activity'), recommended: false }], answer: null }]
} as unknown as HumanAsk;
const asks = { channel: READY, asks: [] as HumanAsk[] };

const START = { x: 820, y: 620 };
const wait = (page: Page, ms: number) => page.waitForTimeout(ms);

test('rig', async ({ page }) => {
  await page.addInitScript(([layout, lang]) => {
    try {
      localStorage.setItem('desktop.lang', lang!); localStorage.setItem('desktop.theme', 'dark');
      if (!localStorage.getItem('ledge.ide.layout')) localStorage.setItem('ledge.ide.layout', layout!);
    } catch { /* ignore */ }
  }, [JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 240, right: false }), EN ? 'en' : 'fr']);
  await installCursor(page, START);
  const daemon = await fakeDaemon(page, calm, {
    projects: twoProjects, usage, threads: { otto: EN ? enThread : ottoThread.filter(i => i.turn === 1) }, machines: [{ id: 'local', label: 'WSL' }],
    openrig: openrig as unknown as OpenRigState, rigSpecs: specs, rigGraphs: graphs,
    rigPermissions: { [OLD]: { policy: 'builtin:auto', seats: [] }, [NEW]: { policy: 'builtin:auto', seats: [] } },
    rigSnapshots: { [OLD]: [], [NEW]: [] }, rigQueues: { [OLD]: [], [NEW]: queue }, asks,
    daemon: { version: '0.58.0', install: 'npm', systemd: true, openrigRig: true, openrigPolicy: true, openrigFresh: true, openrigAsks: true, ping: true } as never
  });
  const state = () => daemon.push({ type: 'openrig.state', state: { ...openrig, at: new Date().toISOString() } });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.agent-seat').first()).toBeVisible({ timeout: 30_000 });
  // A session's thread beside the Rigs view: a still page under the modal (the Atelier's animations under its blur drop the
  // software renderer to a few frames a second).
  await page.locator('.ide-explorer').getByRole('button', { name: /^Otto/ }).first().click();
  await expect(page.getByRole('tabpanel', { name: /^Otto/ }).locator('.session-thread .turn').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.dv-tab').filter({ hasText: 'Atelier' }).getByRole('button').click().catch(() => {});
  await page.getByRole('navigation', { name: L('Barre d’activité', 'Activity bar') }).getByRole('button', { name: L('Rigs OpenRig', 'OpenRig rigs') }).click();
  const view = page.getByRole('complementary', { name: 'Rigs' });
  await expect(view.getByText(OLD)).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Recording only: the modal's `backdrop-filter: blur(5px)` costs the headless software renderer ~200 ms a frame (5 frames a second,
  // a jerky pointer). The same blur is put on what lies under the modal instead (a still layer, drawn once): same picture, ~25 fps.
  await page.addStyleTag({ content: '.modal-backdrop { backdrop-filter: none !important; } body :has(.modal-backdrop) > :not(:has(.modal-backdrop)):not(.modal-backdrop) { filter: blur(5px); }' });
  const pointer = new Pointer(page, START.x, START.y);
  await pointer.park();
  await wait(page, 1500);

  const stop = await record(page, 'rig');
  await wait(page, 500);
  // « + Lancer »: the modal, a spec, one more front seat, the folder, Lancer.
  await pointer.click(view.getByRole('button', { name: /Lancer|Launch/ }), 900);
  const dialog = page.getByRole('dialog', { name: L('Lancer un rig', 'Launch a rig') });
  await expect(dialog).toBeVisible();
  await wait(page, 400);
  await pointer.click(dialog.getByRole('button', { name: new RegExp(NEW) }), 800);
  await wait(page, 400);
  await pointer.click(dialog.getByRole('button', { name: L('Un siège de plus pour dev.front', 'One more seat for dev.front') }), 800);
  await wait(page, 600);
  await pointer.click(dialog.getByRole('button', { name: /^(Lancer|Launch)/ }).last(), 900);
  await expect.poll(() => daemon.received.some(m => m.type === 'openrig.launch' && !(m.launch as { plan?: boolean }).plan), { timeout: 15_000 }).toBe(true);
  const name = (daemon.received.filter(m => m.type === 'openrig.launch').pop() as { launch: { name: string } }).launch.name;
  if (name !== NEW) { graphs[name] = graphs[NEW]!; }
  // The rig starts, then its seats come up one after another.
  const rig: Record<string, unknown> = { id: '2', name, status: 'running', lifecycleState: 'running', seats: NEW_SEATS.length, running: 0, attention: 0, uptime: '0m', snapshot: null, specPath: `/home/me/.ledge/rigs/${name}/rig.yaml`, nodes: [] };
  openrig.rigs.splice(1, 0, rig);
  state();
  await expect(page.locator('.dv-tab').filter({ hasText: `Rig · ${name}` })).toBeVisible();
  await pointer.to(900, 640, 700);
  await wait(page, 700);
  const g = graphs[name]! as unknown as { pods: unknown[]; seats: unknown[]; links: unknown[] };
  for (let i = 0; i < NEW_SEATS.length; i++) {
    const seat = NEW_SEATS[i]!;
    g.seats = [...g.seats, gseat(name, seat)];
    g.pods = PODS.filter(p => (g.seats as { pod: string }[]).some(s => s.pod === p.id));
    const up = new Set((g.seats as { logicalId: string }[]).map(s => s.logicalId));
    g.links = LINKS.filter(l => up.has(l.from) && up.has(l.to));
    rig.nodes = [...(rig.nodes as unknown[]), node(name, seat[0], seat[3])];
    rig.running = i + 1;
    state();
    await wait(page, 650);
  }
  await expect(page.locator('.ide-rig .ide-rig-node')).toHaveCount(NEW_SEATS.length);
  await wait(page, 800);
  // The lead asks for a decision: « À toi » lights up.
  asks.asks = [ASK];
  daemon.push({ type: 'openrig.asksChanged', channel: READY, asks: asks.asks });
  const atoi = page.getByRole('navigation', { name: L('Barre d’activité', 'Activity bar') }).getByRole('button', { name: L('À toi', 'For you'), exact: true });
  await wait(page, 900);
  await pointer.click(atoi, 900);
  const see = page.locator('.ide-explorer').getByRole('button', { name: /^(Voir|View|See)$/ }).first();
  await expect(see).toBeVisible();
  await wait(page, 500);
  await pointer.click(see, 800);
  const line = page.getByRole('tabpanel', { name: /^(À toi|For you)/ }).locator(`.atoi-ask[data-ask="${ASK_ID}"]`);
  await expect(line).toBeVisible();
  await wait(page, 600);
  const open = line.getByRole('button', { name: L('Ouvrir', 'Open'), exact: true });
  if (await open.count()) { await pointer.click(open, 700); await wait(page, 600); }
  const option = line.getByRole('button', { name: L(/^Par projet/, /^By project/) });
  await expect(option).toBeVisible();
  await wait(page, 500);
  await pointer.click(option, 800);
  await expect.poll(() => daemon.received.some(m => m.type === 'openrig.answer'), { timeout: 10_000 }).toBe(true);
  await wait(page, 600);
  asks.asks = [];
  daemon.push({ type: 'openrig.asksChanged', channel: READY, asks: [] });
  await pointer.to(900, 640, 700);
  await wait(page, 1300);
  await stop();
});
