import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Escalation, Projects, Rig } from '@ledge/protocol';
import { rigKey } from '../src/mobile/orchestrator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';
const at = '2026-11-01T10:00:00.000Z';
const rig = (machine: string): Rig => ({ id: 'same', machine, name: `rig-${machine}`, cwd: '/home/private/repo', projectId: null, offProject: true, lifecycle: 'running', kernel: false, seats: [{ ref: 'build@starter', address: '@build', name: 'build', runtime: 'codex', state: 'attention' }], repos: [] });
const project: Projects = { projects: [], rules: [] };
const escalation: Escalation = { id: 'q1', machine: 'remote', rigId: 'same', source: 'rig', from: 'build@starter', intent: 'decision', summary: 'Choose', questions: [{ id: 'q', question: 'Choose', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }], createdAt: at, state: 'pending' };
const rigs = [rig('local'), rig('remote')];
const data = () => ({ rigs: () => rigs, escalations: () => [escalation], escalation: (id: string) => id === escalation.id ? escalation : undefined, rules: () => [], decisions: () => [], projects: () => project, thread: () => ({ items: [] }), exchanges: () => [] });
afterEach(stopAll);
describe('phone OpenRig gateway', () => {
  it('sends bounded snapshots without routing or path information', async () => {
    const g = setup({ deps: { openrig: data() } }); g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot'); expect(snap).toMatchObject({ daemon: { openrig: true }, rigs: [{ key: rigKey('local', 'same') }, { key: rigKey('remote', 'same') }] });
    expect(JSON.stringify(snap)).not.toMatch(/machine|cwd|\/home\/private/);
  });
  it('refuses a rig act without a passkey before dispatch', async () => {
    const g = setup({ deps: { openrig: data() } }); const op = randomUUID(); g.send('dev1', { type: 'rig.act', op, key: rigKey('remote', 'same'), verb: 'down' }); await flush();
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'rejected', reason: 'confirm_required' }); expect(g.dispatched).toEqual([]);
  });
  it('forwards an answer without passkey as the user', async () => {
    const g = setup({ deps: { openrig: data() }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') reply({ type: 'rig.result', rid: msg.rid, ok: true }); } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.dispatched).toContainEqual({ type: 'escalation.answer', rid: op, id: 'q1', by: 'user', answers: { q: 'a' } });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'applied' });
  });
  it('never marks a queued remote answer as applied', async () => {
    const e = { ...escalation }; const d = { ...data(), escalation: () => e, escalations: () => [e] };
    const g = setup({ deps: { openrig: d }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') { Object.assign(e, { state: 'answered', answer: { by: 'user', answers: msg.answers, at, delivery: 'queued' } }); reply({ type: 'rig.result', rid: msg.rid, ok: true }); } } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.dispatched).toContainEqual({ type: 'escalation.answer', rid: op, id: 'q1', by: 'user', answers: { q: 'a' } });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'received' });
    expect(g.results('dev1').some(m => m.type === 'operation.result' && m.op === op && m.status === 'applied')).toBe(false);
  });
  it('returns the most recent 200 exchanges without paths', async () => {
    const exchanges = Array.from({ length: 350 }, (_, n) => ({ id: `x${n}`, machine: 'remote', rigId: 'same', from: '@a', to: '@b', kind: 'message' as const, text: `hello /home/private/${n}`, at }));
    const g = setup({ deps: { openrig: { ...data(), exchanges: () => exchanges } } });
    g.send('dev1', { type: 'rig.exchanges.request', key: rigKey('remote', 'same') }); await flush();
    const message = g.got('dev1').find(m => m.type === 'rig.exchanges');
    expect(message).toMatchObject({ cut: true });
    if (message?.type !== 'rig.exchanges') throw new Error('missing exchanges');
    expect(message.items).toHaveLength(200); expect(message.items[0]?.id).toBe('x150'); expect(message.items.at(-1)?.id).toBe('x349');
    expect(JSON.stringify(message)).not.toMatch(/machine|\/home\/private/);
  });

});
