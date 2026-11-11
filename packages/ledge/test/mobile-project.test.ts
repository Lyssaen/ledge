import { describe, it, expect } from 'vitest';
import { CapabilitiesByToolSchema, PhoneSessionSchema, PhoneSessionSchema as S, pendingKey, THREAD_BUDGET, THREAD_ITEMS_MAX, type Session, type ThreadItem } from '@ledge/protocol';
import { adapterFor } from '../src/adapters/index.js';
import { toPhoneTurn } from '../src/mobile/chat.js';
import { capabilities, toPhoneFullRequest, toPhoneItem, toPhoneSession, toPhoneThread } from '../src/mobile/project.js';
import { checklistSummary, toPhoneChecklist } from '../src/mobile/project.js';
import type { Todo } from '@ledge/protocol';

const T = '2026-10-20T10:00:00.000Z';
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's1', name: 'one', tool: 'claude', cwd: '/home/x/repo', project: 'repo', title: 't', tmuxSession: 'ledge-s1', state: 'working', helpers: [],
  startedAt: T, lastActivityAt: T, source: 'launcher', ...extra
});
const msg = (n: number, text = 'hi'): ThreadItem => ({ kind: 'message', id: `m${n}`, at: T, turn: 0, text });

describe('a task card on the phone (issue #92)', () => {
  it('keeps task, taskOp and outgoing on a notice', () => {
    const item: ThreadItem = { kind: 'notice', id: 'task-t1-0', at: T, turn: 0, notice: 'other', task: 't1', taskOp: 'pass', outgoing: true, name: 'Nova', summary: 'Relire', text: 'Tâche « Relire » passée à Nova' };
    expect(toPhoneItem(item).item).toMatchObject({ task: 't1', taskOp: 'pass', outgoing: true, name: 'Nova' });
  });
});

describe('toPhoneSession', () => {
  it('carries the context, the one it relieves, and its relief\'s state only (context handover spec §3.2)', () => {
    const p = toPhoneSession(session({ context: { used: 170_000, window: 200_000, at: T }, relieves: { id: 'x', name: 'Pim', at: T }, handover: { state: 'done', at: T, to: 'y', toName: 'Nova', auto: true } }), T);
    expect(p).toMatchObject({ context: { used: 170_000, window: 200_000 }, relieves: { name: 'Pim' }, handover: { state: 'done', toName: 'Nova' } });
    expect(p.handover).toEqual({ state: 'done', toName: 'Nova' });
    expect(PhoneSessionSchema.safeParse(p).success).toBe(true);
  });

  it('keeps only whitelisted keys', () => {
    const s = { ...session({ topic: 'x', pending: { kind: 'permission', text: 'ok?', tool: 'Bash', source: 'hook' } }), secret: 'x' } as Session;
    const p = toPhoneSession(s, T);
    expect(Object.keys(p).every(k => k in S.shape)).toBe(true);
    for (const k of ['cwd', 'tmuxSession', 'secret']) expect(p).not.toHaveProperty(k);
    expect(() => PhoneSessionSchema.parse(p)).not.toThrow();
  });

  it('keys and classifies the pending request', () => {
    const pending = { kind: 'permission', text: 'Bash: git push', tool: 'Bash', source: 'hook' } as const;
    const p = toPhoneSession(session({ pending: { ...pending } }), T);
    expect(p.pending?.key).toBe(pendingKey(pending));
    expect(p.pending).toMatchObject({ risk: 'high', riskReason: 'pushes' });
    expect(p.pending).not.toHaveProperty('cut');
  });

  it('cuts a body to SNAPSHOT_BODY_MAX in the projection, and to PENDING_BODY_MAX on demand, and says so', () => {
    const s = session({ pending: { kind: 'plan', text: 'plan', body: 'a'.repeat(100_000), source: 'hook' } });
    const p = toPhoneSession(s, T);
    expect(p.pending?.body).toHaveLength(2_048);
    expect(p.pending?.cut).toBe(true);
    const full = toPhoneFullRequest(s);
    expect(full?.body).toHaveLength(65_536);
    expect(full?.cut).toBe(true);
  });

  it('carries what it is running and a forced close, and an older phone ignores both without dropping the session', () => {
    const doing = { tool: 'Bash', label: 'pnpm --filter desktop test', since: T };
    const p = toPhoneSession(session({ doing }), T);
    expect(p.doing).toEqual(doing);
    const ended = toPhoneSession(session({ state: 'exited', exitedAt: T, closedHow: 'killed' }), T);
    expect(ended).toMatchObject({ exitedAt: T, closedHow: 'killed' });
    expect(toPhoneSession(session(), T)).not.toHaveProperty('doing');
    expect(toPhoneSession(session(), T)).not.toHaveProperty('closedHow');
    // A phone built before these fields parses the same object with a schema that lacks them: they are stripped, not refused.
    const older = PhoneSessionSchema.omit({ doing: true, closedHow: true });
    for (const x of [p, ended]) {
      const r = older.safeParse(x);
      expect(r.success).toBe(true);
      expect(r.data).not.toHaveProperty('doing');
      expect(r.data).not.toHaveProperty('closedHow');
    }
  });

  it('clips a label no source should have let grow', () => {
    const p = toPhoneSession(session({ doing: { tool: 'T'.repeat(300), label: 'x'.repeat(5_000), since: T } }), T);
    expect(p.doing!.tool).toHaveLength(100);
    expect(p.doing!.label).toHaveLength(120);
  });

  it('computes unread', () => {
    const reply = (at: string) => ({ text: 'r', at });
    expect(toPhoneSession(session({ lastReply: reply('2026-10-20T10:00:01.000Z') }), T).unread).toBe(true);
    expect(toPhoneSession(session({ lastReply: reply('2026-10-20T09:00:00.000Z') }), T).unread).toBe(false);
    expect(toPhoneSession(session(), T).unread).toBe(false);
  });
});

describe('toPhoneThread', () => {
  it('keeps the newest 200 in chronological order within the budget', () => {
    const items = Array.from({ length: 1000 }, (_, i) => msg(i));
    const r = toPhoneThread(items);
    expect(r.items.length).toBeLessThanOrEqual(THREAD_ITEMS_MAX);
    expect(r.more).toBe(true);
    expect(r.items[0]!.id).toBe('m800');
    expect(r.items.at(-1)!.id).toBe('m999');
    expect(Buffer.byteLength(JSON.stringify(r.items))).toBeLessThanOrEqual(THREAD_BUDGET);
  });

  it('stops at the byte budget', () => {
    const items = Array.from({ length: 150 }, (_, i) => msg(i, 'é'.repeat(8_192)));
    const r = toPhoneThread(items);
    expect(r.items.length).toBeLessThan(150);
    expect(r.more).toBe(true);
    expect(r.items.at(-1)!.id).toBe('m149');
    expect(Buffer.byteLength(JSON.stringify(r.items))).toBeLessThanOrEqual(THREAD_BUDGET);
    expect(r.cut).toEqual([]);
  });

  it('is not "more" when everything fits', () => {
    expect(toPhoneThread([msg(1), msg(2)])).toMatchObject({ more: false, cut: [] });
  });

  it('cuts a tool output, drops the diff and reports the id', () => {
    const tool: ThreadItem = { kind: 'tool', id: 't1', at: T, turn: 0, tool: 'Edit', label: 'Edit a', output: 'o'.repeat(10_000), status: 'success', files: [{ path: 'a', change: 'edit', diff: '@@ secret' }] };
    const r = toPhoneThread([tool]);
    const out = r.items[0] as Extract<ThreadItem, { kind: 'tool' }>;
    expect(out.output).toHaveLength(2_048);
    expect(out.files).toEqual([{ path: 'a', change: 'edit' }]);
    expect(r.cut).toEqual(['t1']);
    expect(toPhoneItem(tool).cut).toBe(true);
  });
});

describe('capabilities', () => {
  it('follows the adapters', () => {
    const c = capabilities();
    expect(() => CapabilitiesByToolSchema.parse(c)).not.toThrow();
    expect(c.claude.freeTextAnswer).toBe(!!adapterFor('claude').freeText);
  });
  it('gives OMP, which has no adapter, no free text and no accept/deny, but its own questions', () => {
    expect(capabilities().omp).toEqual({ freeTextAnswer: false, decide: false, questions: true });
  });
  it('lets every other tool accept and deny, and ask no OMP question', () => {
    const c = capabilities();
    for (const tool of ['claude', 'codex', 'cursor'] as const) expect(c[tool]).toMatchObject({ decide: true, questions: false });
  });
});

describe('images on the phone projection', () => {
  const ref = { id: 'a'.repeat(64), mime: 'image/png' as const, width: 10, height: 10, bytes: 100, preview: true };
  it('a prompt item keeps its images', () => {
    const item: ThreadItem = { kind: 'prompt', id: 'p1', at: T, turn: 1, text: 'look', images: [ref] };
    expect(toPhoneItem(item).item).toEqual({ kind: 'prompt', id: 'p1', at: T, turn: 1, text: 'look', images: [ref] });
  });
  it('a tool row keeps its images and imagesDropped', () => {
    const item: ThreadItem = { kind: 'tool', id: 't1', at: T, turn: 1, tool: 'shot', label: 'shot', status: 'success', files: [], images: [ref], imagesDropped: true };
    expect(toPhoneItem(item).item).toMatchObject({ kind: 'tool', images: [ref], imagesDropped: true });
  });
  it('a prompt item without images stays as it was', () => {
    expect(toPhoneItem({ kind: 'prompt', id: 'p1', at: T, turn: 1, text: 'look' }).item).not.toHaveProperty('images');
  });
  it('a chat turn keeps its attachments', () => {
    const t = toPhoneTurn({ qid: '8b4f6d3e-0000-4000-8000-000000000000', question: 'q', askedAt: T, steps: [], attachments: [ref] } as never);
    expect(t.attachments).toEqual([ref]);
    expect(toPhoneTurn({ qid: 'x', question: 'q', askedAt: T, steps: [] } as never)).not.toHaveProperty('attachments');
  });
});

describe('a session\'s model on the phone (#58)', () => {
  it('projects model, effort, modelNext', () => {
    const p = toPhoneSession(session({ model: 'opus', effort: 'high', modelNext: { model: 'sonnet' } }), T);
    expect(p).toMatchObject({ model: 'opus', effort: 'high', modelNext: { model: 'sonnet' } });
    expect(p.modelNext).toEqual({ model: 'sonnet' });
    expect(PhoneSessionSchema.safeParse(p).success).toBe(true);
    // None set: none sent.
    const bare = toPhoneSession(session(), T);
    for (const k of ['model', 'effort', 'modelNext']) expect(bare).not.toHaveProperty(k);
    // Clipped like the other strings: no source swells a snapshot.
    const long = toPhoneSession(session({ model: 'm'.repeat(500), effort: 'e'.repeat(50), modelNext: { model: 'n'.repeat(500), effort: 'f'.repeat(50) } }), T);
    expect([long.model?.length, long.effort?.length, long.modelNext?.model?.length, long.modelNext?.effort?.length]).toEqual([200, 20, 200, 20]);
  });

  it('canSwitch only for a launcher session not exited', () => {
    expect(toPhoneSession(session(), T).canSwitch).toBe(true);
    expect(toPhoneSession(session({ state: 'idle' }), T).canSwitch).toBe(true);
    expect(toPhoneSession(session({ state: 'exited' }), T)).not.toHaveProperty('canSwitch');
    expect(toPhoneSession(session({ source: 'hook_only' }), T)).not.toHaveProperty('canSwitch');
    expect(PhoneSessionSchema.safeParse(toPhoneSession(session(), T)).success).toBe(true);
  });
});

describe('the checklist for the phone', () => {
  const todo = (text: string, status: Todo['status'] = 'pending'): Todo => ({ text, status });

  it('is null without a list', () => {
    expect(toPhoneChecklist(null)).toBeNull();
    expect(checklistSummary(null)).toBeUndefined();
  });

  it('caps the tasks and counts the whole list', () => {
    const todos = Array.from({ length: 80 }, (_, i) => todo(`t${i}`, i < 3 ? 'completed' : 'pending'));
    const c = toPhoneChecklist(todos)!;
    expect(c.tasks).toHaveLength(50);
    expect(c).toMatchObject({ done: 3, total: 80, cut: true });
  });

  it('clips a long text', () => {
    const c = toPhoneChecklist([todo('x'.repeat(300))])!;
    expect(c.tasks[0]!.text).toHaveLength(200);
    expect(c.cut).toBe(true);
    expect(toPhoneChecklist([todo('short')])).toEqual({ tasks: [{ text: 'short', status: 'pending' }], done: 0, total: 1 });
  });

  it('sums up with the first task in progress', () => {
    expect(checklistSummary([todo('a', 'completed'), todo('A', 'in_progress'), todo('B', 'in_progress'), todo('b')])).toEqual({ done: 1, total: 4, current: 'A' });
    expect(checklistSummary([todo('a', 'completed'), todo('b', 'completed')])).toEqual({ done: 2, total: 2 });
  });

  it('clips the current task', () => {
    const s = checklistSummary([todo('x'.repeat(300), 'in_progress')])!;
    expect(s.current!.length).toBe(200);
    expect(s.cut).toBe(true);
  });

  it('shows a current task past the cap', () => {
    const todos = [...Array.from({ length: 60 }, (_, i) => todo(`t${i}`, 'completed')), todo('late', 'in_progress')];
    expect(checklistSummary(todos)).toEqual({ done: 60, total: 61, current: 'late', cut: true });
  });

  it('rides on the session only when given', () => {
    expect(toPhoneSession(session(), T)).not.toHaveProperty('checklist');
    const p = toPhoneSession(session(), T, { done: 1, total: 2, current: 'A' });
    expect(p.checklist).toEqual({ done: 1, total: 2, current: 'A' });
    expect(PhoneSessionSchema.safeParse(p).success).toBe(true);
  });
});

describe('OpenRig on the phone (docs/mockups/ledge-openrig-messages.html)', () => {
  it('keeps the rig side of a received, sent or notice item, its texts shortened', async () => {
    const { THREAD_TEXT_MAX } = await import('@ledge/protocol');
    const at = '2026-11-02T21:12:00.000Z';
    const rig = { kind: 'handoff' as const, from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', sentAt: at, gen: '45f7085e', qitem: 'qitem-1-a', count: 2, packet: { id: 'rig-3', index: 0, count: 2 }, raw: 'x'.repeat(THREAD_TEXT_MAX + 50) };
    const notice: ThreadItem = { kind: 'notice', id: 'rig-3-0', at, turn: 3, notice: 'other', name: 'pilot-lead@ledge-dev-2', text: 'Queue handoff', rig };
    const out = toPhoneItem(notice);
    expect(out.cut).toBe(true);
    expect(out.item).toMatchObject({ kind: 'notice', rig: { ...rig, raw: expect.any(String) } });
    expect(out.item.kind === 'notice' && out.item.rig!.raw.length).toBeLessThanOrEqual(THREAD_TEXT_MAX + 1);
    const received: ThreadItem = { kind: 'received', id: 'rig-4-0', at, turn: 4, from: 'pilot-lead@ledge-dev-2', text: 'Salut', rig: { kind: 'message', raw: 'From: …' } };
    expect(toPhoneItem(received).item).toEqual(received);
    const sent: ThreadItem = { kind: 'sent', id: 'toolu_1', at, turn: 4, to: 'a@b', text: 'x', status: 'delivered', rig: { kind: 'message', to: 'a@b', command: 'rig send a@b "x"', raw: 'rig send a@b "x"\nSent to a@b' } };
    expect(toPhoneItem(sent).item).toEqual(sent);
  });
});
