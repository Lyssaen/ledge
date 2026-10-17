import { describe, expect, it } from 'vitest';
import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { fakeSession, T0 } from '@ledge/fleet/test/mockDaemon';
import { atEnd, displayIds, exchanges, fmtDur, helperOf, kindOf, pendingPlan, planOf, subagentOf, summarize, timeMark, unreadFrom, verbOf, type Exchange } from '../src/session/thread';

const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const tool = (id: string, s: number, name: string, label: string, extra: Partial<ToolItem> = {}): ToolItem =>
  ({ kind: 'tool', id, at: at(s), turn: 1, tool: name, label, status: 'success', files: [], ...extra });
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(0), turn: 1, text: 'Câble la liste' },
  tool('t1', 1, 'Read', '/w/ledge/src/App.tsx', { durationMs: 400 }),
  tool('t2', 2, 'Grep', 'useKeys', { durationMs: 300 }),
  tool('t3', 3, 'Edit', '/w/ledge/src/App.tsx', { durationMs: 200, files: [{ path: '/w/ledge/src/App.tsx', change: 'edit', diff: '- a\n+ b' }] }),
  { kind: 'message', id: 'msg-1', at: at(4), turn: 1, text: 'Je lance les tests.' },
  { kind: 'permission', id: 'perm-1', at: at(5), turn: 1, tool: 'Bash', text: 'npm test', decision: 'accept' },
  tool('t4', 6, 'Bash', 'npm test', { status: 'failed', error: 'exit 1', durationMs: 6800 }),
  { kind: 'helper', id: 'h1', at: at(7), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'exited' },
  { kind: 'message', id: 'msg-h', at: at(7.5), turn: 1, helperId: 'h1', text: 'Je lis.' },
  { kind: 'reply', id: 'report-h1', at: at(7.8), turn: 1, helperId: 'h1', text: 'Rien à signaler.' },
  { kind: 'reply', id: 'reply-1', at: at(8), turn: 1, text: 'Deux tests échouent.' },
  { kind: 'prompt', id: 'prompt-2', at: at(60), turn: 2, text: 'Corrige-les' },
  { kind: 'permission', id: 'perm-2', at: at(61), turn: 2, tool: 'Bash', text: 'npm test' },
  tool('t5', 62, 'Bash', 'npm test', { turn: 2, status: 'running' })
];
const shape = (xs: Exchange[]) => xs.map(x => [x.prompt && `${x.prompt.from}:${x.prompt.text}`, ...x.segments.map(s =>
  s.kind === 'tools' ? `tools:${s.tools.map(t => t.id).join(',')}` : s.kind === 'say' ? `say:${s.item.id}` : `${s.kind}:${s.item.id}`)]);

describe('session thread model', () => {
  it('a flat thread by exchange: runs of actions fold, decided permissions and subagents stand between, the pending one is left out', () => {
    expect(shape(exchanges(items))).toEqual([
      ['you:Câble la liste', 'tools:t1,t2,t3', 'say:msg-1', 'decision:perm-1', 'tools:t4', 'helper:h1', 'say:reply-1'],
      ['you:Corrige-les', 'tools:t5']
    ]);
    expect(displayIds(exchanges(items))).toEqual(['prompt-1', 't1', 't2', 't3', 'msg-1', 'perm-1', 't4', 'h1', 'reply-1', 'prompt-2', 't5']);
  });
  it("a subagent's own thread: its task as the parent's instruction, what it said, its report", () => {
    expect(shape(exchanges(items, 'h1'))).toEqual([['parent:Lire le code', 'say:msg-h', 'say:report-h1']]);
    expect(exchanges(items, 'h1')[0]!.prompt!.id).toBe('h1');
  });
  it('a thread joined mid-session starts without a prompt', () => {
    expect(shape(exchanges([{ ...tool('t0', 0, 'Read', 'a'), turn: 0 }]))).toEqual([[null, 'tools:t0']]);
    expect(exchanges([{ ...tool('t0', 0, 'Read', 'a'), turn: 0 }])[0]!.key).toBe('turn-0');
  });
  it('a summary counts kinds, changed files, failures and time; a live run shows its running action', () => {
    const run = items.slice(1, 4) as ToolItem[];
    expect(summarize(run, Date.parse(at(10)), true)).toEqual({ count: 3, kinds: { read: 1, search: 1, command: 0, edit: 1 }, files: 1, failed: 0, cut: 0, ms: 900, running: null, todos: 0 });
    const t5 = items.at(-1) as ToolItem;
    expect(summarize([t5], Date.parse(at(70)), true)).toMatchObject({ ms: 8000, running: t5 });
    expect(summarize([t5], Date.parse(at(70)), false).running).toBeNull();
    expect(summarize([{ ...t5, status: 'unknown' }, items[6] as ToolItem], 0, true)).toMatchObject({ failed: 1, cut: 1 });
  });
  it('kinds and verbs', () => {
    expect(['Edit', 'Write', 'apply_patch', 'Grep', 'WebFetch', 'Read', 'Bash', 'Task'].map(kindOf)).toEqual(['edit', 'edit', 'edit', 'search', 'search', 'read', 'command', 'command']);
    expect(verbOf(tool('x', 0, 'apply_patch', 'a', { files: [{ path: 'a', change: 'add' }] }))).toBe('create');
    expect(verbOf(tool('x', 0, 'apply_patch', 'a', { files: [{ path: 'a', change: 'delete' }] }))).toBe('delete');
    expect(verbOf(tool('x', 0, 'Write', 'a', { files: [{ path: 'a', change: 'write' }] }))).toBe('edit');
  });
  it('durations as the mockup writes them, in both languages', () => {
    const ms = [400, 6800, 48_000, 134_000, 120_000, 5_700_000];
    expect(ms.map(m => fmtDur(m, 'fr'))).toEqual(['0,4 s', '6,8 s', '48 s', '2 min 14 s', '2 min', '1 h 35']);
    expect(ms.map(m => fmtDur(m, 'en'))).toEqual(['0.4 s', '6.8 s', '48 s', '2 min 14 s', '2 min', '1 h 35']);
  });
  it('a time mark: the hour today, the date before', () => {
    const now = new Date(2026, 9, 17, 18, 0).getTime();
    expect(timeMark(new Date(2026, 9, 17, 14, 32).toISOString(), now, 'fr')).toBe('14:32');
    expect(timeMark(new Date(2026, 9, 16, 9, 5).toISOString(), now, 'fr')).toBe('16 oct. · 09:05');
    expect(timeMark(new Date(2026, 9, 16, 9, 5).toISOString(), now, 'en')).toBe('Oct 16 · 09:05');
  });
  it('« Nouveau » starts after the last item seen; never on a first visit', () => {
    const ids = ['prompt-1', 't1', 't2'];
    expect([unreadFrom(ids, 't1'), unreadFrom(ids, null), unreadFrom(ids, 't2'), unreadFrom(ids, 'gone')]).toEqual(['t2', null, null, null]);
  });
  it('the end of the thread is within 60 px', () => {
    expect([atEnd({ scrollHeight: 1000, scrollTop: 441, clientHeight: 500 }), atEnd({ scrollHeight: 1000, scrollTop: 440, clientHeight: 500 })]).toEqual([true, false]);
  });
  it("a subagent from the session, else from the thread's row", () => {
    const otto = fakeSession('local:otto', { helpers: [{ id: 'h2', kind: 'Review', task: 'Relire', state: 'working' }] });
    expect(helperOf(otto, items, 'h2', 'Subagent')).toEqual({ id: 'h2', kind: 'Review', task: 'Relire', state: 'working' });
    expect(helperOf(otto, items, 'h1', 'Subagent')).toEqual({ id: 'h1', kind: 'Explore', task: 'Lire le code', state: 'exited' });
    expect(helperOf(otto, undefined, 'h9', 'Subagent')).toBeNull();
  });
  it('a subagent without a name of its own takes the translated one given', () => {
    const otto = fakeSession('local:otto');
    const row = { kind: 'helper' as const, id: 'h3', at: '2026-10-13T10:00:00.000Z', turn: 1, task: 'Relire', state: 'working' as const };
    expect(helperOf(otto, [row], 'h3', 'Sous-agent')).toEqual({ id: 'h3', kind: 'Sous-agent', task: 'Relire', state: 'exited' });
    expect(subagentOf(otto, undefined, 'h9', 'Subagent')).toEqual({ id: 'h9', kind: 'Subagent', task: '', state: 'exited' });
  });
});

const md = '# Plan : version 0.6.0\n\nPréparer la release.\n\n1. **Changelog** — résumer\n2. Monter les versions\n3. Construire\n4. Publier';
const exit = (id: string, status: ToolItem['status']): ToolItem => ({ kind: 'tool', id, at: T0, turn: 3, tool: 'ExitPlanMode', label: '# Plan : version 0.6.0', input: JSON.stringify({ plan: md }, null, 2), status, files: [] });
describe('plans', () => {
  it('a plan from ExitPlanMode: title, steps, status from the action', () => {
    expect(planOf(exit('p1', 'running'))).toEqual({ key: 'p1', title: 'Plan : version 0.6.0', markdown: md, steps: ['Changelog', 'Monter les versions', 'Construire', 'Publier'], status: 'proposed' });
    expect([planOf(exit('p1', 'success'))!.status, planOf(exit('p1', 'failed'))!.status, planOf(exit('p1', 'unknown'))!.status]).toEqual(['approved', 'revised', 'revised']);
    expect(planOf({ ...exit('p1', 'running'), tool: 'Bash' })).toBeNull();
    expect(pendingPlan({ kind: 'plan', text: '# Plan : version 0.6.0', body: md, source: 'pane' })).toMatchObject({ key: 'pending', status: 'proposed', steps: ['Changelog', 'Monter les versions', 'Construire', 'Publier'] });
  });
  it('ExitPlanMode leaves its run as a plan segment', () => {
    const xs = exchanges([{ kind: 'prompt', id: 'prompt-3', at: T0, turn: 3, text: 'Prépare la 0.6' }, { ...exit('r', 'success'), id: 'r', tool: 'Read', label: 'a' }, exit('p1', 'running')]);
    expect(xs[0]!.segments.map(s => s.kind)).toEqual(['tools', 'plan']);
  });
  it('a plan still running when a later one comes is revised (main thread or the same subagent); an approved one stays approved', () => {
    const statuses = (xs: Exchange[]) => xs.flatMap(x => x.segments.flatMap(s => (s.kind === 'plan' ? [s.plan.status] : [])));
    const p3: ThreadItem = { kind: 'prompt', id: 'prompt-3', at: T0, turn: 3, text: 'Prépare la 0.6' };
    expect(statuses(exchanges([p3, exit('p1', 'running'), exit('p2', 'running')]))).toEqual(['revised', 'proposed']);
    expect(statuses(exchanges([p3, exit('p1', 'running'), { ...p3, id: 'prompt-4', turn: 4 }, { ...exit('p2', 'running'), turn: 4 }]))).toEqual(['revised', 'proposed']);
    expect(statuses(exchanges([p3, exit('p1', 'success'), exit('p2', 'running')]))).toEqual(['approved', 'proposed']);
    // A subagent's plan supersedes neither the main thread's nor another's.
    const sub: ThreadItem[] = [p3, exit('p1', 'running'), { kind: 'helper', id: 'h1', at: T0, turn: 3, task: 'Planifier', agentType: 'Plan', state: 'working' }, { ...exit('hp', 'running'), helperId: 'h1' }];
    expect(statuses(exchanges(sub))).toEqual(['proposed']);
    expect(statuses(exchanges([...sub, { ...exit('hp2', 'running'), helperId: 'h1' }], 'h1'))).toEqual(['revised', 'proposed']);
  });
});
