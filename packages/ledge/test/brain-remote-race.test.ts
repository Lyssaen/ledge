import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Escalation } from '@ledge/protocol';
import { createAnswers } from '../src/daemon/openrig/answer.js';
import { createRemoteBrainOwner, REMOTE_GRACE_MS } from '../src/daemon/brain/remoteOwner.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';
import type { EscalationPatch } from '../src/daemon/openrig/bridge.js';

let current: Escalation; let finish!: (r: { status: number; json: unknown }) => void;
let calls: number; let owner: ReturnType<typeof createRemoteBrainOwner>; let local: ReturnType<typeof createAnswers>;
const patch = (_: string, p: EscalationPatch) => { current = { ...current, ...p }; return current; };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0); calls = 0;
  current = { id: 'e', source: 'rig', machine: 'local', from: 'build@r', intent: 'decision', summary: 'Branch?', category: 'git', state: 'pending', createdAt: new Date(0).toISOString(), questions: [{ id: 'q', question: 'Branch?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] };
  local = createAnswers({ localMachine: 'local', path: { kind: 'approve-only' }, port: { escalation: () => current, patch, status: () => ({ machine: 'local', state: 'running' }), cli: () => ({ queueCreate: async () => ({ ok: true, qitemId: 'reply' }) }), http: () => ({ action: () => { calls++; return new Promise(resolve => { finish = resolve; }); } }), replyRow: () => undefined, setReplyRow() {} } });
  owner = createRemoteBrainOwner({ escalation: () => current, patch, localBrainOn: () => false, mandate: () => parseMandate(DEFAULT_MANDATE), hasReplyRow: () => false, token: () => 'token', answer: (id, a) => local.answer(id, a, 'ledge') });
});
afterEach(() => { owner.close(); vi.useRealTimers(); });
it('a user who begins first wins over a remote brain candidate', async () => {
  owner.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  const user = local.answer('e', { q: 'b' }, 'user');
  expect(await owner.decide('e', 'peer', 'token', { q: 'a' }, 'git')).toMatchObject({ ok: false, code: 'already_answered' });
  expect(calls).toBe(1); finish({ status: 200, json: { ok: true } }); expect(await user).toMatchObject({ ok: true });
});
it('a candidate which begins first blocks the user and remains unconfirmed until OpenRig acknowledges', async () => {
  owner.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  let resolved = false;
  const remote = owner.decide('e', 'peer', 'token', { q: 'a' }, 'git').then(r => { resolved = true; return r; });
  expect(await local.answer('e', { q: 'b' }, 'user')).toMatchObject({ ok: false, code: 'already_answered' });
  expect(resolved).toBe(false); expect(calls).toBe(1);
  finish({ status: 200, json: { ok: true } }); expect(await remote).toMatchObject({ ok: true, status: 'applied' });
});
it('a failed origin acknowledgement never confirms a candidate', async () => {
  owner.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  const remote = owner.decide('e', 'peer', 'token', { q: 'a' }, 'git');
  finish({ status: 500, json: { error: 'failed' } });
  expect(await remote).toMatchObject({ ok: false, code: 'failed' }); expect(current.state).toBe('grace');
});

it('a disconnect during delivery never restores an acknowledged answer to pending', async () => {
  owner.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  const remote = owner.decide('e', 'peer', 'token', { q: 'a' }, 'git');
  owner.disconnect('peer');
  expect(current.state).toBe('answered');
  finish({ status: 200, json: { ok: true } });
  expect(await remote).toMatchObject({ ok: true, status: 'applied' });
  expect(current.state).toBe('answered');
});
it('a disconnect during a failed delivery restores the question to the user', async () => {
  owner.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  const remote = owner.decide('e', 'peer', 'token', { q: 'a' }, 'git');
  owner.disconnect('peer'); finish({ status: 500, json: { error: 'failed' } });
  expect(await remote).toMatchObject({ ok: false });
  expect(current.state).toBe('pending');
});
