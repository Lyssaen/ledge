import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation } from '@ledge/protocol';
import { createAnswerReceipts } from '../src/mobile/answerReceipts.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

const dirs: string[] = [];
const file = () => { const dir = mkdtempSync(join(tmpdir(), 'phone-receipts-')); dirs.push(dir); return join(dir, 'receipts.json'); };
const e: Escalation = { id: 'q1', machine: 'remote', source: 'rig', from: '@build', intent: 'decision', summary: 'Question', questions: [], createdAt: '2026-11-01T10:00:00.000Z', state: 'pending' };
const view = { rigs: () => [], escalations: () => [e], escalation: (id: string) => id === e.id ? e : undefined, escalationAmbiguous: () => false, rules: () => [], decisions: () => [], projects: () => ({ projects: [], rules: [] }), thread: () => ({ items: [] }), exchanges: () => [] };
afterEach(() => { stopAll(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('durable phone answer receipts', () => {
  it('persists the pending operation and a later proof across two daemon restarts', async () => {
    const path = file(); const op = randomUUID(); const message = { type: 'escalation.answer', op, id: 'q1', answers: { text: 'secret answer' } };
    const first = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) }, dispatch: async (m, reply) => { if (m.type === 'escalation.answer') reply({ type: 'rig.result', rid: m.rid, ok: true }); } });
    first.send('dev1', message); await flush(); expect(first.results('dev1').at(-1)).toMatchObject({ op, status: 'received' });
    expect(statSync(path).mode & 0o777).toBe(0o600); expect(readFileSync(path, 'utf8')).not.toContain('secret answer'); first.gw.stop();
    const second = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) } });
    // The queued peer confirms before this phone reconnects to the restarted daemon.
    second.gw.answerSettled({ rid: op, machine: 'remote', id: 'q1', answers: { text: 'secret answer' } }, { status: 'applied' }); await flush(); second.gw.stop();
    const third = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) } });
    third.send('dev1', message); await flush(); expect(third.results('dev1').at(-1)).toMatchObject({ op, status: 'applied' }); expect(third.dispatched).toEqual([]);
    third.send('dev2', message); third.send('dev1', { ...message, answers: { text: 'other' } }); await flush();
    expect(third.results('dev2').at(-1)).toMatchObject({ status: 'rejected', reason: 'conflict' }); expect(third.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'conflict' });
  });
  it('records a direct proven remote result before acknowledging it', async () => {
    const path = file(); const op = randomUUID(); const msg = { type: 'escalation.answer', op, id: 'q1', answers: { text: 'go' } };
    const first = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) }, dispatch: async (m, reply) => { if (m.type === 'escalation.answer') reply({ type: 'rig.result', rid: m.rid, ok: true, confirmed: true }); } });
    first.send('dev1', msg); await flush(); expect(first.results('dev1').at(-1)).toMatchObject({ op, status: 'applied' }); first.gw.stop();
    const next = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) } }); next.send('dev1', msg); await flush();
    expect(next.results('dev1').at(-1)).toMatchObject({ op, status: 'applied' }); expect(next.dispatched).toEqual([]);
  });
  it('does not dispatch if the pending journal cannot be written', async () => {
    const journal = createAnswerReceipts(file()); const broken = { ...journal, putPending() { throw new Error('disk unavailable'); } };
    const g = setup({ deps: { openrig: view, answerReceipts: broken } }); const op = randomUUID();
    g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { text: 'go' } }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'rejected', reason: 'unavailable' }); expect(g.dispatched).toEqual([]);
  });
  it('answers read-only receipt queries only for the original device and exact answer', async () => {
    const path = file(); const op = randomUUID(); const answer = { type: 'escalation.answer' as const, op, id: 'q1', answers: { text: 'go' } };
    const g = setup({ deps: { openrig: view, answerReceipts: createAnswerReceipts(path) }, dispatch: async (m, reply) => { if (m.type === 'escalation.answer') reply({ type: 'rig.result', rid: m.rid, ok: true, confirmed: true }); } });
    g.send('dev1', answer); await flush();
    g.send('dev1', { type: 'answer.receipt.request', answer }); g.send('dev2', { type: 'answer.receipt.request', answer });
    g.send('dev1', { type: 'answer.receipt.request', answer: { ...answer, answers: { text: 'other' } } }); await flush();
    expect(g.got('dev1').filter(m => m.type === 'answer.receipt')).toMatchObject([{ op, status: 'applied' }, { op, status: 'unknown' }]);
    expect(g.got('dev2').find(m => m.type === 'answer.receipt')).toMatchObject({ op, status: 'unknown' }); expect(g.dispatched).toHaveLength(1);
  });
  it('never claims success when durable proof cannot be written', async () => {
    const path = file(); const journal = createAnswerReceipts(path); const broken = { ...journal, markApplied() { throw new Error('disk unavailable'); } };
    const g = setup({ deps: { openrig: view, answerReceipts: broken }, dispatch: async (m, reply) => { if (m.type === 'escalation.answer') reply({ type: 'rig.result', rid: m.rid, ok: true }); } });
    const op = randomUUID(); const msg = { type: 'escalation.answer', op, id: 'q1', answers: { text: 'go' } };
    g.send('dev1', msg); await flush(); g.gw.answerSettled({ rid: op, machine: 'remote', id: 'q1', answers: { text: 'go' } }, { status: 'applied' }); await flush();
    expect(g.results('dev1').some(m => m.type === 'operation.result' && m.op === op && m.status === 'applied')).toBe(false);
    expect(createAnswerReceipts(path).get(op)?.status).toBe('received');
  });
  it('refuses new remote answers when the journal cannot be trusted', async () => {
    const path = file(); writeFileSync(path, '{broken'); expect(() => createAnswerReceipts(path)).toThrow();
    const g = setup({ deps: { openrig: view, answerReceipts: null } }); const op = randomUUID();
    g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { text: 'go' } }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'rejected', reason: 'unavailable' }); expect(g.dispatched).toEqual([]);
  });
});
