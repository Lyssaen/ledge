import type { Page } from '@playwright/test';
import type { ChatAction, ChatPoint, ChatTurn, HarnessUsage, HumanAsk, HumanChannel, OpenRigState, PointItem, PrDetail, PullRequest, RigGraph, RigRow, RigSpec, Session, ThreadItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { fleet, at, tool } from './thread';
import { VIDEO, EN } from './zz-rec';

// TEMPORARY: the Desktop stills of the marketing site in ENGLISH (desktop-*.png, 1440×900 at deviceScaleFactor 2), at 0.60.0.
// Master copy in apps/site/capture; run-stills.sh copies it into apps/desktop/e2e, runs it and removes it.
// The fixture texts are English only: run it with ZZ_LANG=en (the French stills of 0.58.0 came from an earlier, deleted spec).
test.skip(!EN, 'English only: ZZ_LANG=en');
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', launchOptions: { args: process.env.ZZ_GPU_OFF ? ['--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer'] : [] } });
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const min = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const topics: Record<string, string> = {
  otto: 'Wire the session list', nova: 'Fleet ssh reconnect', pim: 'Mascot motion', bix: 'Document the protocol',
  echo: 'Notification tests', luna: 'New home page', milo: 'Mobile layout', rio: 'Site accessibility'
};
const busy = fleet.map(s => ({
  ...s, topic: topics[s.id] ?? s.project, title: `${s.name} · ${topics[s.id] ?? s.project}`,
  ...(s.id === 'otto' ? { model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: min(0) }, pending: { kind: 'permission' as const, text: 'pnpm --filter desktop test', tool: 'Bash', source: 'hook' as const }, helpers: [{ id: 'h1', kind: 'Explore', task: 'Read the code', state: 'working' as const }] } : {}),
  ...(s.id === 'luna' ? { pending: { kind: 'question' as const, text: 'Which port for the home page locally: 3000 or 5173?', source: 'hook' as const } } : {}),
  ...(s.id === 'bix' ? { lastReply: { text: 'The protocol is documented: 14 messages, 3 examples.', at: min(-2) } } : {}),
  ...(s.id === 'nova' ? { model: 'claude-opus-5-5', context: { used: 61_000, window: 200_000, at: min(0) }, helpers: [{ id: 'n1', kind: 'Explore', task: 'Review the protocol', state: 'working' as const }, { id: 'n2', kind: 'general-purpose', task: 'Run the ssh tests', state: 'working' as const }] } : {})
})) as Session[];

const diffList = ['@@ -12,9 +12,14 @@ export function SessionList({ fleet }: Props) {', '   const sessions = useSessions(fleet);', '-  const sorted = sessions;', '+  const sorted = useMemo(', '+    () => [...sessions].sort(byProjectThenActivity),', '+    [sessions]', '+  );', '   return (', '     <ul className="session-list" role="list">', '-      {sorted.map(s => <li key={s.id}>{s.name}</li>)}', '+      {sorted.map(s => (', '+        <SessionRow key={s.id} session={s} onOpen={() => open(s.id)} />', '+      ))}', '     </ul>', '   );', ' }'].join('\n');
const diffRow = ['@@ -0,0 +1,18 @@', '+import type { Session } from \'@ledge/protocol\';', '+import { StateDot } from \'./StateDot\';', '+', '+interface Props { session: Session; onOpen(): void }', '+', '+/** One line of the list: the agent, its topic, its state. */', '+export function SessionRow({ session, onOpen }: Props) {', '+  return (', '+    <li className="session-row">', '+      <button type="button" onClick={onOpen}>', '+        <StateDot state={session.state} />', '+        <span className="name">{session.name}</span>', '+        <span className="topic">{session.topic}</span>', '+      </button>', '+    </li>', '+  );', '+}'].join('\n');
const diffTest = ['@@ -31,6 +31,15 @@ describe(\'SessionList\', () => {', '     expect(screen.getAllByRole(\'listitem\')).toHaveLength(3);', '   });', ' ', '+  it(\'sorts by project, then by last activity\', () => {', '+    render(<SessionList fleet={fleetOf(otto, luna, nova)} />);', '+    const names = screen.getAllByRole(\'listitem\').map(li => li.textContent);', '+    expect(names).toEqual([\'Nova\', \'Otto\', \'Luna\']);', '+  });', '+', '   it(\'opens a session on click\', async () => {', '-    await user.click(screen.getByText(\'Otto\'));', '+    await user.click(screen.getByRole(\'button\', { name: /Otto/ }));', '     expect(open).toHaveBeenCalledWith(\'otto\');', '   });'].join('\n');
const ottoThread: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(-600), turn: 1, text: 'Wire the session list to the fleet: sorted by project, then by activity, one row per agent.' },
  tool('t1', -590, 'Read', '/w/ledge/src/SessionList.tsx', { durationMs: 400 }),
  tool('t2', -580, 'Grep', 'useSessions', { durationMs: 300 }),
  tool('t3', -570, 'Edit', '/w/ledge/src/SessionList.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/SessionList.tsx', change: 'edit', diff: diffList }] }),
  tool('t3b', -565, 'Write', '/w/ledge/src/SessionRow.tsx', { durationMs: 180, files: [{ path: '/w/ledge/src/SessionRow.tsx', change: 'add', diff: diffRow }] }),
  tool('t3c', -562, 'Edit', '/w/ledge/src/SessionList.test.tsx', { durationMs: 210, files: [{ path: '/w/ledge/src/SessionList.test.tsx', change: 'edit', diff: diffTest }] }),
  { kind: 'reply', id: 'reply-1', at: at(-520), turn: 1, text: 'The list is wired: `SessionList` sorts by project, then by last activity, and each agent has its row (`SessionRow`). I added a test for the sort.' },
  { kind: 'prompt', id: 'prompt-2', at: at(-30), turn: 2, text: 'Great. Run the tests before you push.' },
  { kind: 'message', id: 'msg-2', at: at(-20), turn: 2, text: 'Running the desktop suite.' },
  { kind: 'permission', id: 'perm-2', at: at(-9), turn: 2, tool: 'Bash', text: 'pnpm --filter desktop test' },
  tool('t5', -8, 'Bash', 'pnpm --filter desktop test', { turn: 2, status: 'running' })
];
const novaThread: ThreadItem[] = [
  { kind: 'prompt', id: 'p1', at: at(-900), turn: 1, text: 'The fleet\'s ssh reconnect loops when the machine comes back. Find out why and fix it.' },
  tool('n1', -890, 'Read', '/w/ledge/src/fleet/reconnect.ts', { durationMs: 300 }),
  tool('n2', -880, 'Bash', 'pnpm vitest run fleet/reconnect', { status: 'failed', error: 'exit 1', durationMs: 5200 }),
  { kind: 'message', id: 'm1', at: at(-870), turn: 1, text: 'The retry delay starts from zero after every failure: it never grows.' },
  tool('n3', -860, 'Edit', '/w/ledge/src/fleet/reconnect.ts', { durationMs: 200, files: [{ path: '/w/ledge/src/fleet/reconnect.ts', change: 'edit', diff: '@@ -18,5 +18,6 @@ export function nextDelay(tries: number) {\n-  return BASE_MS;\n+  const grown = BASE_MS * 2 ** Math.min(tries, 6);\n+  return Math.min(grown, MAX_MS);\n }' }] }),
  tool('n4', -850, 'Bash', 'pnpm vitest run fleet/reconnect', { durationMs: 4100 }),
  { kind: 'reply', id: 'r1', at: at(-840), turn: 1, text: 'Fixed: the delay doubles on each try, capped at 30 s. The 12 tests of `fleet/reconnect` pass.' },
  { kind: 'prompt', id: 'p2', at: at(-60), turn: 2, text: 'Add a test for a machine that comes back after an hour.' },
  tool('n5', -50, 'Edit', '/w/ledge/src/fleet/reconnect.test.ts', { turn: 2, status: 'running' })
];
const usage = {
  harnesses: [
    { harness: 'claude', account: 'a1b2c3d4e5f6', status: 'ok', readAt: min(-1), windows: [{ kind: 'five_hour', pct: 62, resetsAt: min(130) }, { kind: 'seven_day', pct: 34, resetsAt: min(3000) }, { kind: 'model', model: 'Opus', pct: 71, resetsAt: min(3000) }] },
    { harness: 'codex', account: null, status: 'ok', readAt: min(-2), windows: [{ kind: 'five_hour', pct: 18, resetsAt: min(170) }, { kind: 'seven_day', pct: 41, resetsAt: min(3000) }] }
  ] as HarnessUsage[], alerts: [], prefs: { alert: 0.8 }
};

// OpenRig: a running team of five seats on Ledge, and the kernel.
const RIG = 'ledge-team';
const SEATS: [string, string, string, string][] = [['pilot.lead', 'pilot', 'orchestrator', 'claude-code'], ['dev.front', 'dev', 'implementer', 'claude-code'], ['dev.back', 'dev', 'implementer', 'codex'], ['review.qa', 'review', 'qa', 'codex'], ['review.design', 'review', 'reviewer', 'claude-code']];
const sess = (id: string) => `${id.replace('.', '-')}@${RIG}`;
const graph = {
  pods: [{ id: 'pilot', label: 'Steering' }, { id: 'dev', label: 'Development' }, { id: 'review', label: 'Review' }],
  seats: SEATS.map(([id, pod, role, runtime]) => ({ logicalId: id, pod, role, runtime, status: 'running', session: sess(id), attention: false })),
  links: [{ from: 'pilot.lead', to: 'dev.front', kind: 'delegates_to' }, { from: 'pilot.lead', to: 'dev.back', kind: 'delegates_to' }, { from: 'dev.front', to: 'review.design', kind: 'delegates_to' }, { from: 'dev.back', to: 'review.qa', kind: 'delegates_to' }]
} as RigGraph;
const node = (id: string, runtime: string, activity = 'running') => ({ logicalId: id, session: sess(id), runtime, model: null, sessionStatus: 'running', lifecycleState: 'running', activity, stopped: false, work: 1 });
const openrig = {
  installed: true, version: '0.7.10', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
  rigs: [
    { id: '1', name: RIG, status: 'running', lifecycleState: 'running', seats: 5, running: 5, attention: 0, uptime: '2h', snapshot: null, specPath: `/home/me/.ledge/rigs/${RIG}/rig.yaml`, nodes: SEATS.map(([id, , , rt], i) => node(id, rt, i === 3 ? 'idle' : 'running')) },
    { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: '2h', snapshot: null, nodes: [] }
  ]
} as unknown as OpenRigState;
const qrow = (n: number, state: string, from: string, to: string, summary: string, extra: Partial<RigRow> = {}): RigRow =>
  ({ id: `qitem-2026111409${n}0-1a2b3c4d5e6f7a8${n}`, state, summary, from, to, createdAt: min(-40 + n * 5), updatedAt: min(-30 + n * 5), at: min(0), ...extra }) as RigRow;
const queue: RigRow[] = [
  qrow(1, 'in-progress', sess('pilot.lead'), sess('dev.front'), 'Wire the session list to the fleet', { claimedAt: min(-30) }),
  qrow(2, 'in-progress', sess('pilot.lead'), sess('dev.back'), 'ssh reconnect: growing delay', { claimedAt: min(-25) }),
  qrow(3, 'pending', sess('dev.back'), sess('review.qa'), 'Review the reconnect fix'),
  qrow(4, 'pending', sess('dev.front'), sess('review.design'), 'Check the list against the mockup')
];
const specs = [{ name: 'starter', source: 'builtin', path: '/specs/starter.yaml', edges: 1, pods: [{ id: 'dev', members: [{ id: 'builder', runtime: 'claude-code', agent: 'x' }, { id: 'reviewer', runtime: 'codex', agent: 'x' }] }] }] as unknown as RigSpec[];

// « For you »: what OpenRig asks the person, and the requests waiting on the forges.
const NOW = min(-4);
const from = (role: string) => ({ seat: sess(role), rig: RIG, role });
const abase = { alert: false, priority: 'routine' as const, bodyTruncated: false, detail: null, evidenceRef: null, createdAt: NOW, updatedAt: NOW };
const ASKS = [
  { ...abase, id: 'qitem-urgent', kind: 'decision', priority: 'urgent', from: from('review.qa'), summary: 'The review blocks the merge: do we fix before or after the demo?', body: '',
    questions: [{ id: 'q', question: 'When?', options: [{ id: 'before', label: 'Before', recommended: true }, { id: 'after', label: 'After', recommended: false }], answer: null }] },
  { ...abase, id: 'qitem-192556', kind: 'decision', from: from('pilot.lead'), summary: 'Session list: sort by project, or by last activity?',
    body: 'Sorting by project keeps teams together; sorting by activity puts what just moved on top. The mockup shows the first.',
    questions: [{ id: 'q', question: 'Which sort?', options: [{ id: 'one', label: 'By project', recommended: true }, { id: 'two', label: 'By activity', recommended: false }], answer: null }] },
  { ...abase, id: 'qitem-news', kind: 'update', from: from('review.design'), summary: 'List mockup reviewed: two spacing gaps', body: '12 px of margin instead of 16 under the header, and the state icon is one pixel off.', questions: [] }
] as unknown as HumanAsk[];
const READY = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false } as HumanChannel;
const pr = (p: Partial<PullRequest> & Pick<PullRequest, 'id' | 'number' | 'ref' | 'title'>): PullRequest => ({
  forge: 'github', host: 'github.com', repo: 'ledge', url: `https://example.invalid/${p.number}`, state: 'open', branch: 'b', target: 'main', headSha: '3f9c2ab',
  pipeline: 'ok', approvals: { given: 1, required: 1 }, mergeable: true, openThreads: 0, updatedAt: min(0), sessions: [], ...p
}) as PullRequest;
const PRS = [
  pr({ id: 'github.com/ledge#312', number: 312, ref: '#312', title: 'ssh reconnect: growing delay', branch: 'fix/LEDGE-42-ssh-reconnect', sessions: ['nova'] }),
  pr({ id: 'gitlab.corp.lan/website#41', forge: 'gitlab', host: 'gitlab.corp.lan', repo: 'website', number: 41, ref: '!41', title: 'Home page: mobile layout', pipeline: 'fail', sessions: ['milo'] }),
  pr({ id: 'github.com/ledge#313', number: 313, ref: '#313', title: 'Mascot motion', pipeline: 'run', mergeable: false })
];
const detail = (cmd: string, jobs: PrDetail['jobs'] = []): Omit<PrDetail, 'pr'> => ({ description: '', author: '', reviewers: [], labels: [], issues: [], jobs, threads: [], files: [], commits: [], mergeCommand: cmd, mergeBlockers: [] }) as Omit<PrDetail, 'pr'>;

// The operator's point and an answered question, for the chat still.
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const SINCE = min(-40);
const item = (o: Partial<PointItem> & Pick<PointItem, 'id' | 'group'>): PointItem => ({ event: 1, tone: 'idle', who: 'Bix', text: '', at: min(-10), ...o });
const ITEMS: PointItem[] = [
  item({ id: 'rig.ask:q41', event: 12, group: 'atoi', tone: 'ask', who: 'pilot-lead', rig: RIG, text: 'Session list: sort by project, or by last activity?', at: min(-2), ref: { kind: 'rig.ask', qitem: 'q41' },
    answers: [{ id: 'project', label: 'By project', style: 'primary' }, { id: 'activity', label: 'By activity', style: 'plain' }], freeText: true, nav: [{ kind: 'rig', id: RIG }],
    settled: { at: min(-1), where: 'chat', answer: 'By project' } }),
  item({ id: 'session:bix', event: 9, group: 'done', who: 'Bix', text: 'finished “Document the protocol”', sub: 'PR #312 open, tests green', at: min(-12),
    suggestion: { action: 'session.archive', args: { session: 'bix' }, summary: 'Archive **Bix**', vars: { session: 'Bix' }, risk: 'reversible' } }),
  item({ id: 'task:t1', event: 4, group: 'ongoing', tone: 'work', who: 'Nova', text: 'has held “Fleet ssh reconnect” for 40 min', sub: 'context at 86 %' })
];
const POINT: ChatPoint = { since: SINCE, lead: `Since ${hhmm(SINCE)}, three things. **One was waiting for you.**`, leadBy: 'agent', items: ITEMS };
const handover: ChatAction = { action: 'session.handover', args: { session: 'nova' }, summary: 'Hand over **Nova**', vars: { session: 'Nova' }, risk: 'reversible' };
const TURNS = [
  { qid: 'point-1', question: '', askedAt: min(-3), steps: [], answeredAt: min(-3), by: 'ledge', point: POINT },
  { qid: 'q-1', question: 'How is Nova doing?', askedAt: min(-1), steps: [{ kind: 'sessions' }, { kind: 'pane', id: 'nova', name: 'Nova' }], answeredAt: min(-1),
    answer: '**Nova** fixed the ssh reconnect, but its context is at 86 %. I can hand it over to a fresh session.', actions: [handover] }
] as unknown as ChatTurn[];

async function boot(page: Page, o: { right?: boolean } = {}) {
  await page.addInitScript(([seen, layout]) => {
    try {
      localStorage.setItem('desktop.lang', 'en'); localStorage.setItem('desktop.theme', 'dark'); localStorage.setItem('ledge.ide.atoi.seen', seen!);
      if (!localStorage.getItem('ledge.ide.layout')) localStorage.setItem('ledge.ide.layout', layout!);
    } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: true, cmd: false, gitBash: false };
    // Headless WebGL draws xterm's glyphs at the wrong scale at deviceScaleFactor 2: the DOM renderer instead.
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) { return kind === 'webgl2' || kind === 'webgl' ? null : (get as (...a: unknown[]) => unknown).call(this, kind, ...rest); } as never;
  }, [String(Date.now() - 3_600_000), JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: false, bottomHeight: 240, right: o.right === true })]);
  const daemon = await fakeDaemon(page, busy, {
    projects: twoProjects, threads: { otto: ottoThread, nova: novaThread }, usage, machines: [{ id: 'local', label: 'WSL' }],
    openrig, rigSpecs: specs, rigGraphs: { [RIG]: graph }, rigSnapshots: { [RIG]: [{ id: '01M6XTDV03ZVK8BG4WYNVFRBPX', kind: 'auto-periodic', status: 'complete', createdAt: '2026-11-14 09:12:01' }] } as never,
    rigPermissions: { [RIG]: { policy: 'builtin:auto', seats: [] } }, rigQueues: { [RIG]: queue },
    asks: { channel: READY, asks: ASKS },
    forge: { prs: PRS, details: { [PRS[0]!.id]: detail('gh pr merge 312 --squash --match-head-commit 3f9c2ab'), [PRS[1]!.id]: detail('glab mr merge 41', [{ id: 'j', name: 'test', column: 0, columnName: 'test', status: 'fail' }] as never) } },
    daemon: { version: '0.60.0', install: 'npm', systemd: true, forge: true, openrigRig: true, openrigPolicy: true, openrigFresh: true, openrigAsks: true, ping: true } as never
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.agent-seat').first()).toBeVisible({ timeout: 30_000 });
  return daemon;
}
const nav = (page: Page) => page.getByRole('navigation', { name: 'Activity bar' });
const tree = (page: Page) => page.locator('.ide-explorer');
const openSession = async (page: Page, name: string) => {
  await tree(page).getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByRole('tabpanel', { name: new RegExp(`^${name}`) }).locator('.session-thread .turn').first()).toBeVisible({ timeout: 30_000 });
};
const shot = async (page: Page, name: string) => { await page.waitForTimeout(700); await page.screenshot({ path: `${VIDEO}desktop-${name}.png` }); };

test('atelier', async ({ page }) => {
  const daemon = await boot(page);
  await page.getByRole('button', { name: /Fit/ }).click();
  daemon.upsert({ ...busy.find(s => s.id === 'otto')!, lastMessage: { id: 'sent-1', to: 'Nova', peer: 'nova', summary: 'The list is wired, you can plug in the reconnect', at: new Date().toISOString() } } as never);
  await expect(page.locator('.exchange-wire path')).toHaveCount(1);
  await shot(page, 'atelier');
});
test('session changes', async ({ page }) => {
  await boot(page);
  await openSession(page, 'Otto');
  await page.getByRole('tabpanel', { name: /^Otto/ }).locator('.ide-bar .dchip').click();
  await expect(page.getByRole('tabpanel', { name: /^Changes · Otto/ }).locator('.file-title code').first()).toBeVisible();
  await shot(page, 'session-changes');
});
test('split', async ({ page }) => {
  await boot(page);
  await openSession(page, 'Otto');
  await tree(page).getByRole('button', { name: /^Nova/ }).first().click({ modifiers: ['Control'] });
  await expect(page.locator('.dv-groupview')).toHaveCount(2);
  await expect(page.getByRole('tabpanel', { name: /^Nova/ }).locator('.session-thread .turn').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+j');
  const panel = page.getByRole('region', { name: 'Bottom panel' });
  await expect(panel.locator('.ide-btile-tab').first()).toBeVisible();
  await page.evaluate(() => (window as unknown as { __ledgePtyEmit: (s: string) => void }).__ledgePtyEmit(
    '\x1b[32mme@wsl\x1b[0m:\x1b[34m~/w/ledge\x1b[0m$ pnpm --filter desktop test\r\n\r\n \x1b[32m✓\x1b[0m src/SessionList.test.tsx (4 tests) 212ms\r\n \x1b[32m✓\x1b[0m src/fleet/reconnect.test.ts (12 tests) 388ms\r\n \x1b[32m✓\x1b[0m src/ide/layout.test.ts (31 tests) 97ms\r\n\r\n Test Files  \x1b[32m3 passed\x1b[0m (3)\r\n      Tests  \x1b[32m47 passed\x1b[0m (47)\r\n   Duration  1.84s\r\n\r\n\x1b[32mme@wsl\x1b[0m:\x1b[34m~/w/ledge\x1b[0m$ '));
  await shot(page, 'split');
});
test('chat', async ({ page }) => {
  const daemon = await boot(page, { right: true });
  const panel = page.locator('.ledge-chat-panel');
  await expect(panel).toBeVisible();
  daemon.push({ type: 'chat.history', turns: TURNS });
  await expect(panel.locator('[data-point]')).toBeVisible();
  await expect(panel.locator('[data-action-card]')).toBeVisible();
  await shot(page, 'chat');
});
test('launch', async ({ page }) => {
  await boot(page, { right: true });
  await page.keyboard.press('n');
  const form = page.getByRole('dialog');
  await expect(form).toBeVisible();
  await form.getByRole('textbox').first().fill('Add a test for the fleet\'s ssh reconnect when the machine comes back after an hour');
  await shot(page, 'launch');
});
test('rigs', async ({ page }) => {
  await boot(page);
  await nav(page).getByRole('button', { name: 'OpenRig rigs' }).click();
  await page.getByRole('complementary', { name: 'Rigs' }).locator('.ide-rigs-row').filter({ hasText: RIG }).getByRole('button', { name: RIG, exact: true }).click();
  await expect(page.locator('.ide-rig .ide-rig-node')).toHaveCount(5);
  await shot(page, 'rigs');
});
test('for you', async ({ page }) => {
  await boot(page);
  await nav(page).getByRole('button', { name: 'For you', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: /^For you/ }).locator('.atoi-row').first()).toBeVisible();
  await shot(page, 'for-you');
});
