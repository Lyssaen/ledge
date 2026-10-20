import { describe, it, expect } from 'vitest';
import { CapabilitiesByToolSchema, PhoneSessionSchema, PhoneSessionSchema as S, pendingKey, THREAD_BUDGET, THREAD_ITEMS_MAX, type Session, type ThreadItem } from '@ledge/protocol';
import { adapterFor } from '../src/adapters/index.js';
import { capabilities, toPhoneFullRequest, toPhoneItem, toPhoneSession, toPhoneThread } from '../src/mobile/project.js';

const T = '2026-10-20T10:00:00.000Z';
const session = (extra: Partial<Session> = {}): Session => ({
  id: 's1', name: 'one', tool: 'claude', cwd: '/home/x/repo', project: 'repo', title: 't', tmuxSession: 'ledge-s1', state: 'working', helpers: [],
  startedAt: T, lastActivityAt: T, source: 'launcher', ...extra
});
const msg = (n: number, text = 'hi'): ThreadItem => ({ kind: 'message', id: `m${n}`, at: T, turn: 0, text });

describe('toPhoneSession', () => {
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
});
