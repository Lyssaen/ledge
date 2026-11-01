import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, Escalation, LedgeDecision } from '@ledge/protocol';
import type { RemoteMessage, RemotePeers } from '../src/daemon/openrig/remote.js';
import { createRemoteBrainCoordinator, remoteBrainId } from '../src/daemon/brain/remoteCoordinator.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPendingJournal } from '../src/daemon/brain/remoteJournal.js';
import type { BrainEvent } from '../src/daemon/brain/inbox.js';

const esc = (machine = 'ec2'): Escalation => ({ id: 'e', machine, source: 'rig', rigId: 'r', from: 'build@r', intent: 'decision', state: 'pending', summary: 'Branch?', category: 'git', createdAt: new Date(0).toISOString(), questions: [{ id: 'q', question: 'Branch?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] });
let sent: Array<{ machine: string; msg: ClientMessage }>, events: BrainEvent[], records: LedgeDecision[], lines: unknown[], capable: boolean, online: boolean, active: boolean;
let deliver: (machine: string, m: RemoteMessage) => void, change: (machine: string, status: 'open' | 'unreachable' | 'unsupported' | 'removed') => void;
let c: ReturnType<typeof createRemoteBrainCoordinator>;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const result = (machine: string, rid: string, extra: Record<string, unknown>) => deliver(machine, { type: 'brain.delegate.result', rid, ...extra } as RemoteMessage);
function start(o: { journal?: ReturnType<typeof createPendingJournal>; flushStrict?: () => Promise<void> } = {}) {
  const remote = { status: () => online ? 'open' : 'unreachable', send(machine: string, msg: ClientMessage) { if (!online) return false; sent.push({ machine, msg }); return true; }, supportsBrainDelegate: () => capable,
    onMessage(fn: typeof deliver) { deliver = fn; return () => {}; }, onStatus(fn: typeof change) { change = fn; return () => {}; } } as unknown as RemotePeers;
  let n = 0;
  c = createRemoteBrainCoordinator({ remote, brainOn: () => active, inbox: { push(e) { events.push(e); return true; } },
    memory: { rules: () => [], record(d) { const r = { ...d, id: `d${records.length + 1}` }; records.push(r); return r; } },
    thread: { append(item) { lines.push(item); return { ...item, id: 'i', at: new Date(0).toISOString() } as never; }, ...(o.flushStrict ? { flushStrict: o.flushStrict } : {}) },
    ...(o.journal ? { journal: o.journal } : {}),
    mandate: () => parseMandate(DEFAULT_MANDATE), uuid: () => `rid-${++n}` });
}
async function granted(machine = 'ec2') {
  c.observe(esc(machine)); const m = sent.at(-1)!.msg; if (m.type !== 'brain.delegate.claim') throw Error('expected claim');
  const graceUntil = new Date(60_000).toISOString();
  c.observe({ ...esc(machine), state: 'grace', graceUntil });
  result(machine, m.rid, { ok: true, token: `token-${machine}`, graceUntil }); await flush();
  return remoteBrainId(machine, 'e');
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); sent = []; events = []; records = []; lines = []; capable = true; online = true; active = true; start(); });
afterEach(() => { c.close(); vi.useRealTimers(); });
describe('remote brain coordinator', () => {
  it('never sends delegation commands to an older peer', async () => { capable = false; c.observe(esc()); await flush(); expect(sent).toEqual([]); expect(events).toEqual([]); });
  it('schedules a candidate, and records only after a positive origin acknowledgement', async () => {
    const id = await granted(); expect(events).toMatchObject([{ kind: 'escalation', escalation: { id, state: 'grace' } }]);
    expect(await c.decide(id, { q: 'a' }, 'git', {})).toMatchObject({ ok: true, line: expect.stringContaining('après la grâce') });
    await vi.advanceTimersByTimeAsync(59_999); expect(sent).toHaveLength(1); expect(records).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); const m = sent.at(-1)!.msg; expect(m).toMatchObject({ type: 'brain.delegate.decide', id: 'e', token: 'token-ec2' }); if (m.type !== 'brain.delegate.decide') throw Error('expected decide'); expect(records).toHaveLength(0);
    result('ec2', m.rid, { ok: true, status: 'applied' }); await flush();
    expect(records).toMatchObject([{ escalationId: id, summary: 'Branch? → A', by: 'ledge' }]); expect(lines).toMatchObject([{ kind: 'decided', decisionId: 'd1' }]);
  });
  it('cancels a candidate on another answer without claiming an optimistic update is applied', async () => {
    const id = await granted(); await c.decide(id, { q: 'a' }, 'git', {});
    c.observe({ ...esc(), state: 'answered', answer: { by: 'user', answers: { q: 'b' }, at: new Date(1).toISOString() } });
    await vi.advanceTimersByTimeAsync(60_000); expect(sent).toHaveLength(1); expect(records).toEqual([]);
  });
  it('reports unknown, never applied, when the peer disconnects after the candidate was sent', async () => {
    const id = await granted(); await c.decide(id, { q: 'a' }, 'git', {}); await vi.advanceTimersByTimeAsync(60_000);
    online = false; change('ec2', 'unreachable'); await flush();
    expect(records).toEqual([]); expect(events.some(e => e.kind === 'state' && /confirm/.test(e.text))).toBe(true);
  });
  it('does not record an outcome the origin cannot prove', async () => {
    const id = await granted(); await c.decide(id, { q: 'a' }, 'git', {}); await vi.advanceTimersByTimeAsync(60_000);
    const m = sent.at(-1)!.msg; if (m.type !== 'brain.delegate.decide') throw Error('expected decide');
    result('ec2', m.rid, { ok: false, code: 'unknown', reason: 'lost acknowledgement' }); await flush();
    expect(records).toEqual([]); expect(lines).toEqual([]); expect(events.some(e => e.kind === 'state' && /confirm/.test(e.text))).toBe(true);
  });
  it('retains the pending proof if saving the thread fails, and reconciles after reconnection', async () => {
    c.close(); const dir = mkdtempSync(join(tmpdir(), 'brain-reconcile-')); const journal = createPendingJournal(join(dir, 'pending.json'));
    let fail = true; start({ journal, flushStrict: async () => { if (fail) throw Error('disk'); } });
    try {
      const id = await granted(); await c.decide(id, { q: 'a' }, 'git', {}); await vi.advanceTimersByTimeAsync(60_000);
      const m = sent.at(-1)!.msg; if (m.type !== 'brain.delegate.decide') throw Error('expected decide');
      result('ec2', m.rid, { ok: true, status: 'applied' }); await flush();
      expect(journal.all()).toHaveLength(1);
      fail = false; change('ec2', 'open'); const q = sent.at(-1)!.msg; if (q.type !== 'brain.delegate.query') throw Error('expected query');
      result('ec2', q.rid, { ok: true, status: 'applied' }); await flush();
      expect(journal.all()).toHaveLength(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not trust a grant that arrives after an answer was observed', async () => {
    c.observe(esc()); const m = sent.at(-1)!.msg; if (m.type !== 'brain.delegate.claim') throw Error('expected claim');
    c.observe({ ...esc(), state: 'answered', answer: { by: 'user', answers: { q: 'b' }, at: new Date(1).toISOString() } });
    result('ec2', m.rid, { ok: true, token: 't', graceUntil: new Date(60_000).toISOString() }); await flush();
    expect(c.list()).toEqual([]); expect(events).toEqual([]); expect(sent.at(-1)?.msg).toMatchObject({ type: 'brain.delegate.release', token: 't' });
  });
  it('qualifies equal native ids by machine', async () => {
    const a = await granted('ec2'); const b = await granted('nas'); expect(a).not.toBe(b); expect(c.list().map(e => e.id)).toEqual([a, b]);
  });
  it('keeps the lease until the origin acknowledges an advice release', async () => {
    const id = await granted(); const answer = c.ask(id, 'git', 'Ask the user'); const m = sent.at(-1)!.msg;
    expect(m).toMatchObject({ type: 'brain.delegate.release', id: 'e', advice: 'Ask the user' }); if (m.type !== 'brain.delegate.release') throw Error('expected release'); expect(c.has(id)).toBe(true);
    result('ec2', m.rid, { ok: true }); expect(await answer).toMatchObject({ ok: true }); expect(c.has(id)).toBe(false);
  });
});
