import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation } from '@ledge/protocol';
import { createReceiptJournal } from '../src/daemon/brain/remoteJournal.js';
import { createRemoteBrainOwner, REMOTE_GRACE_MS } from '../src/daemon/brain/remoteOwner.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';

let dir: string; let e: Escalation;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); dir = mkdtempSync(join(tmpdir(), 'brain-proof-')); e = { id: 'e', machine: 'local', source: 'rig', from: 'build@r', intent: 'decision', state: 'pending', summary: 'Branch?', createdAt: new Date(0).toISOString(), questions: [{ id: 'q', question: 'Branch?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] }; });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });
const owner = () => createRemoteBrainOwner({ escalation: () => e, patch(_id, p) { e = { ...e, ...p }; return e; }, localBrainOn: () => false, mandate: () => parseMandate(DEFAULT_MANDATE), hasReplyRow: () => false,
  answer: async () => { e = { ...e, state: 'answered' }; return { ok: true, escalation: e }; }, token: () => 'secret', receipts: createReceiptJournal(join(dir, 'receipts.json')) });
it('persists proof before success and recovers it after the source daemon restarts', async () => {
  const a = owner(); a.claim('e', 'peer'); await vi.advanceTimersByTimeAsync(REMOTE_GRACE_MS);
  expect(await a.decide('e', 'peer', 'secret', { q: 'a' }, 'git', 'operation')).toMatchObject({ ok: true, status: 'applied' }); a.close();
  const b = owner();
  expect(b.query('operation', 'secret')).toEqual({ ok: true, status: 'applied' });
  expect(b.query('operation', 'wrong')).toMatchObject({ ok: false, code: 'unknown' });
  expect(b.query('missing', 'secret')).toMatchObject({ ok: false, code: 'unknown' }); b.close();
});
