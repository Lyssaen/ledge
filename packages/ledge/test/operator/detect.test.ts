import { describe, it, expect } from 'vitest';
import { pendingKey, type ForgeStateMessage, type Goal, type HumanAsk, type OpenRigState, type Rig, type Session, type Task } from '@ledge/protocol';
import { fromAsks, fromForge, fromGoals, fromRigs, fromSession, fromTasks, settledSession } from '../../src/operator/detect.js';
import { STALE_TASK_MS } from '../../src/operator/constants.js';

const T0 = '2026-11-13T10:00:00.000Z';
const NOW = Date.parse(T0);
const mk = (over: Partial<Session> = {}): Session => ({
  id: 's1', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: 'ledge-s1',
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...over
});
const req = (text: string, kind: 'permission' | 'question' = 'permission'): NonNullable<Session['pending']> => ({ kind, text, source: 'hook' });

describe('fromSession', () => {
  it('a new permission makes one immediate session.request with the command in payload', () => {
    const a = mk({ state: 'idle', pending: req('Run ls -la') });
    const [e, ...rest] = fromSession(mk(), a, 0.8);
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ kind: 'session.request', subjectKind: 'session.request', subjectId: `s1#${pendingKey(a.pending!)}`, urgency: 'immediate', subjectName: 'Otto' });
    expect(e!.payload).toMatchObject({ command: 'Run ls -la' });
  });
  it('a question is a session.question on the same subject kind', () => {
    const q = mk({ pending: req('Which db?', 'question') });
    expect(fromSession(mk(), q, 0.8)[0]).toMatchObject({ kind: 'session.question', subjectKind: 'session.request', urgency: 'immediate' });
  });
  it('working to idle without pending makes session.finished with lastReply text in payload', () => {
    const done = mk({ state: 'idle', lastReply: { text: 'All done.', at: T0 } });
    expect(fromSession(mk(), done, 0.8)).toEqual([expect.objectContaining({ kind: 'session.finished', subjectKind: 'session', subjectId: 's1', urgency: 'grouped', payload: { text: 'All done.' } })]);
  });
  it('the same pending re-read makes nothing', () => {
    const a = mk({ pending: req('Run ls') });
    expect(fromSession(a, { ...a, lastActivityAt: '2026-11-13T10:05:00.000Z' }, 0.8)).toEqual([]);
  });
  it('tool use, sub-agent and model changes make nothing', () => {
    const a = mk();
    expect(fromSession(a, { ...a, running: [{ tool: 'Bash', label: 'ls', since: T0 }] as never }, 0.8)).toEqual([]);
    expect(fromSession(a, { ...a, helpers: [{ id: 'h', kind: 'x', task: 't', state: 'working' }] }, 0.8)).toEqual([]);
    expect(fromSession(a, { ...a, model: 'opus' }, 0.8)).toEqual([]);
  });
  it('error, exit and a context crossing the threshold are grouped, once', () => {
    expect(fromSession(mk(), mk({ state: 'error' }), 0.8).map(e => e.kind)).toEqual(['session.error']);
    expect(fromSession(mk(), mk({ state: 'exited' }), 0.8).map(e => e.kind)).toEqual(['session.exited']);
    const full = mk({ context: { used: 90, window: 100, at: T0 } });
    expect(fromSession(mk({ context: { used: 50, window: 100, at: T0 } }), full, 0.8).map(e => e.kind)).toEqual(['session.context_full']);
    expect(fromSession(full, { ...full, context: { used: 95, window: 100, at: T0 } }, 0.8)).toEqual([]);
  });
});

describe('settledSession', () => {
  const a = mk({ pending: req('Run ls') });
  it('a pending that disappears returns the subject id', () => {
    expect(settledSession(a, mk({ state: 'idle' }))).toEqual({ subjectId: `s1#${pendingKey(a.pending!)}`, where: 'terminal' });
  });
  it('maps who answered to where', () => {
    const gone = mk({ state: 'idle' });
    expect(settledSession(a, gone, { kind: 'device', id: 'd', name: 'Pixel' })?.where).toBe('phone');
    expect(settledSession(a, gone, { kind: 'pc' })?.where).toBe('desktop');
    expect(settledSession(mk({ pending: { ...req('x'), source: 'rpc' } }), gone, null)?.where).toBe('elsewhere');
  });
  it('an unchanged or absent pending settles nothing', () => {
    expect(settledSession(a, a)).toBeNull();
    expect(settledSession(mk(), mk())).toBeNull();
  });
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Fix it', giver: 'a', giverName: 'Pim', owner: 'b', ownerName: 'Otto', state: 'open', at: T0, updatedAt: T0, log: [], ...over
});

describe('fromTasks', () => {
  it('a task taken with no holder activity for 30 minutes makes one task.stale, once', () => {
    const taken = task({ state: 'taken' });
    const now = NOW + STALE_TASK_MS;
    expect(fromTasks([taken], [taken], now - 1, () => undefined, new Set())).toEqual([]);
    const [e, ...rest] = fromTasks([taken], [taken], now, () => undefined, new Set());
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ kind: 'task.stale', subjectKind: 'task', subjectId: 't1', urgency: 'grouped' });
    expect(fromTasks([taken], [taken], now, () => undefined, new Set(['t1']))).toEqual([]);
    expect(fromTasks([taken], [taken], now, id => (id === 'b' ? now - 1000 : undefined), new Set())).toEqual([]);
  });
  it('an opened task owned by Ledge makes immediate decision.asked', () => {
    expect(fromTasks([], [task({ owner: 'ledge', ownerName: 'Ledge' })], NOW, () => undefined, new Set())).toEqual([expect.objectContaining({ kind: 'decision.asked', urgency: 'immediate' })]);
  });
  it('a plain opened task, a brain proposal and a closed task', () => {
    expect(fromTasks([], [task()], NOW, () => undefined, new Set())[0]).toMatchObject({ kind: 'task.opened', urgency: 'grouped' });
    const brain = task({ owner: 'ledge', brain: { kind: 'fact', text: 'x' } as never });
    expect(fromTasks([], [brain], NOW, () => undefined, new Set())[0]!.kind).toBe('brain.proposed');
    expect(fromTasks([task()], [task({ state: 'done', result: 'ok' })], NOW, () => undefined, new Set())[0]).toMatchObject({ kind: 'task.closed', payload: { state: 'done', result: 'ok' } });
  });
});

const ask = (over: Partial<HumanAsk> = {}): HumanAsk => ({
  id: 'q1', kind: 'decision', alert: false, priority: 'routine', from: { seat: 'dev-build@starter', rig: 'starter', role: null },
  summary: 'Ship?', body: '', bodyTruncated: false, detail: null, evidenceRef: null, questions: [], createdAt: T0, updatedAt: T0, ...over
});

describe('fromAsks', () => {
  it('a routine rig ask is grouped, an urgent one immediate, a known one nothing', () => {
    expect(fromAsks([], [ask()])).toEqual([expect.objectContaining({ kind: 'rig.ask', subjectKind: 'rig.ask', subjectId: 'q1', urgency: 'grouped' })]);
    expect(fromAsks([], [ask({ priority: 'urgent' })])[0]!.urgency).toBe('immediate');
    expect(fromAsks([], [ask({ priority: 'critical' })])[0]!.urgency).toBe('immediate');
    expect(fromAsks([ask()], [ask()])).toEqual([]);
  });
});

const rig = (status: string, sessionStatus: string, stopped = false): Rig => ({
  id: '1', name: 'starter', status, lifecycleState: status, seats: 1, running: 1, attention: 0, uptime: null, snapshot: null,
  nodes: [{ logicalId: 'dev.build', session: 'dev-build@starter', runtime: 'claude-code', model: null, sessionStatus, lifecycleState: 'running', activity: 'idle', stopped, work: 0 }]
});
const rigs = (r: Rig): OpenRigState => ({ installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [r], at: T0 });

describe('fromRigs', () => {
  it('a seat that becomes unreachable makes rig.seat_unreachable once', () => {
    const up = rigs(rig('running', 'running'));
    const down = rigs(rig('running', 'detached'));
    expect(fromRigs(up, down)).toEqual([expect.objectContaining({ kind: 'rig.seat_unreachable', subjectKind: 'rig.seat', subjectId: 'starter/dev.build' })]);
    expect(fromRigs(down, down)).toEqual([]);
    expect(fromRigs(up, rigs(rig('running', 'running', true)))).toEqual([]);
    expect(fromRigs(undefined, down)).toEqual([]);
  });
  it('a rig leaving running makes rig.state', () => {
    expect(fromRigs(rigs(rig('running', 'running')), rigs(rig('stopped', 'running', true))).map(e => e.kind)).toEqual(['rig.state']);
  });
});

const forge = (pipeline: 'ok' | 'fail', state: 'open' | 'merged' = 'open', headSha = 'a'): ForgeStateMessage => ({
  type: 'forge.state', forges: [],
  prs: [{ id: 'gh/o/r#1', forge: 'github', host: 'gh', repo: 'o/r', number: 1, ref: '#1', url: 'https://x.test/1', title: 'PR', state, branch: 'b', target: 'main', headSha,
    pipeline, approvals: { given: 0 }, mergeable: true, openThreads: 0, updatedAt: T0, sessions: [] }]
});

describe('fromForge', () => {
  it('a failed pipeline on a followed PR makes forge.pipeline_failed, once per commit', () => {
    expect(fromForge(forge('ok'), forge('fail'))).toEqual([expect.objectContaining({ kind: 'forge.pipeline_failed', subjectKind: 'pr', subjectId: 'gh/o/r#1', urgency: 'grouped' })]);
    expect(fromForge(forge('fail'), forge('fail'))).toEqual([]);
    expect(fromForge(forge('fail'), forge('fail', 'open', 'b')).map(e => e.kind)).toEqual(['forge.pipeline_failed']);
  });
  it('a merge makes forge.merged', () => {
    expect(fromForge(forge('ok'), forge('ok', 'merged')).map(e => e.kind)).toEqual(['forge.merged']);
  });
});

describe('fromGoals', () => {
  const goal = (over: Partial<Goal> = {}): Goal => ({
    goalId: 'g-12345678', qitemId: 'q', text: 'Port the TUI', folder: null, sentAt: '2026-11-13T10:00:00.000Z', to: 'max@kernel', state: 'taken',
    proposal: null, question: null, trail: [], current: null, ...over
  });
  const proposal = (askId: string, text: string) => ({ askId, team: null, text, answer: null, answeredAt: null });
  it('says a new proposal, a new question and a state change once each, by goal', () => {
    expect(fromGoals([goal()], [goal()])).toEqual([]);
    const proposed = fromGoals([goal()], [goal({ state: 'proposed', proposal: proposal('a1', 'Two developers') })]);
    expect(proposed).toEqual([{ kind: 'rig.goal_update', subjectKind: 'rig.goal', subjectId: 'g-12345678', subjectName: 'max@kernel', urgency: 'grouped',
      payload: { goalId: 'g-12345678', goal: 'Port the TUI', state: 'proposed', text: 'Two developers' } }]);
    expect(fromGoals([goal()], [goal({ state: 'asking', question: { askId: 'k1', text: 'Which folder?' } })])[0]!.payload.text).toBe('Which folder?');
    expect(fromGoals([goal({ state: 'running' })], [goal({ state: 'done' })])[0]!.payload.text).toBe('running → done');
    // A goal the user just sent is no news, nor one that left the list.
    expect(fromGoals([], [goal()])).toEqual([]);
    expect(fromGoals([goal()], [])).toEqual([]);
  });
});
