import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Escalation } from '@ledge/protocol';
import type { AnswerResult } from '../src/daemon/openrig/answer.js';
import { createRemoteBrainOwner, REMOTE_GRACE_MS, REMOTE_LEASE_MS } from '../src/daemon/brain/remoteOwner.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';
const escalation = (): Escalation => ({ id: 'e1', source: 'rig', machine: 'local', rigId: 'r1', from: 'build@r', intent: 'decision', summary: 'Which branch?', category: 'git', state: 'pending', createdAt: new Date(0).toISOString(), questions: [{ id: 'q', question: 'Branch?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] });
let current: Escalation; let localBrain: boolean; let calls: number; let replyRow: boolean;
let deliver: (id: string, answers: Record<string, string>) => Promise<AnswerResult>;
let owner: ReturnType<typeof createRemoteBrainOwner>;
function setup() { owner = createRemoteBrainOwner({
  escalation: id => id === current.id ? current : undefined,
  patch(id, patch) { if (id !== current.id) return undefined; current = { ...current, ...patch }; return current; },
  localBrainOn: () => localBrain, mandate: () => parseMandate(DEFAULT_MANDATE), hasReplyRow: () => replyRow,
  answer: async (id, answers) => { calls++; return deliver(id, answers); }, token: () => 'lease-1'
}); }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); current = escalation(); localBrain = false; calls = 0; replyRow = false; deliver = async () => ({ ok: true, escalation: { ...current, state: 'answered' } }); setup(); });
afterEach(() => { owner.close(); vi.useRealTimers(); });
describe('remote brain arbitration at the escalation origin', () => {
  it('grants only one owner and holds an origin-clock grace', () => {
    expect(owner.claim('e1', 'peer-a')).toMatchObject({ ok: true, token: 'lease-1', graceUntil: new Date(REMOTE_GRACE_MS).toISOString() });
    expect(current.state).toBe('grace'); expect(owner.claim('e1', 'peer-b')).toMatchObject({ ok: false });
    localBrain = true; expect(owner.claim('missing', 'peer-c')).toMatchObject({ ok: false });
  });
  it('rejects an early or invalid candidate without writing; applies only after grace and positive acknowledgement', async () => {
    owner.claim('e1', 'peer-a');
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'git')).toMatchObject({ ok: false, code: 'too_early' });
    await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'architecture')).toMatchObject({ ok: false, code: 'mandate' });
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'bad' }, 'git')).toMatchObject({ ok: false, code: 'invalid' });
    expect(calls).toBe(0); expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'git')).toMatchObject({ ok: true, status: 'applied' }); expect(calls).toBe(1);
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'git')).toMatchObject({ ok: false });
  });
  it('does not call a reply known before this attempt or turn a refusal into applied', async () => {
    owner.claim('e1', 'peer-a'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS); replyRow = true;
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'git')).toMatchObject({ ok: false, code: 'unknown' }); expect(calls).toBe(0);
    replyRow = false; deliver = async () => ({ ok: false, code: 'already_answered', reason: 'closed elsewhere' });
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'b' }, 'git')).toMatchObject({ ok: false, code: 'already_answered' });
  });
  it('releases on owner disconnect or lease expiry without reviving an answered escalation', async () => {
    owner.claim('e1', 'peer-a'); owner.disconnect('peer-a'); expect(current.state).toBe('pending');
    owner.claim('e1', 'peer-b'); await vi.advanceTimersByTimeAsync(REMOTE_LEASE_MS); expect(current.state).toBe('pending');
    owner.claim('e1', 'peer-c'); current = { ...current, state: 'answered' }; owner.disconnect('peer-c'); expect(current.state).toBe('answered');
  });
  it('allows at most one candidate to be applying at a time', async () => {
    owner.claim('e1', 'peer-a'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
    let finish!: (result: AnswerResult) => void; deliver = () => new Promise(resolve => { finish = resolve; });
    const first = owner.decide('e1', 'peer-a', 'lease-1', { q: 'a' }, 'git');
    expect(await owner.decide('e1', 'peer-a', 'lease-1', { q: 'b' }, 'git')).toMatchObject({ ok: false, code: 'already_answered' });
    finish({ ok: true, escalation: { ...current, state: 'answered' } }); expect(await first).toMatchObject({ ok: true, status: 'applied' }); expect(calls).toBe(1);
  });
});
