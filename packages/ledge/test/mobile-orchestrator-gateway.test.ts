import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Escalation, Projects, Rig } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { rigKey } from '../src/mobile/orchestrator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';
const at = '2026-11-01T10:00:00.000Z';
const rig = (machine: string): Rig => ({ id: 'same', machine, name: `rig-${machine}`, cwd: '/home/private/repo', projectId: null, offProject: true, lifecycle: 'running', kernel: false, seats: [{ ref: 'build@starter', address: '@build', name: 'build', runtime: 'codex', state: 'attention' }], repos: [] });
const project: Projects = { projects: [], rules: [] };
const escalation: Escalation = { id: 'q1', machine: 'remote', rigId: 'same', source: 'rig', from: 'build@starter', intent: 'decision', summary: 'Choose', questions: [{ id: 'q', question: 'Choose', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }], createdAt: at, state: 'pending' };
const rigs = [rig('local'), rig('remote')];
const data = () => ({ rigs: () => rigs, escalations: () => [escalation], escalation: (id: string) => id === escalation.id ? escalation : undefined, escalationAmbiguous: () => false, rules: () => [], decisions: () => [], projects: () => project, thread: () => ({ items: [] }), exchanges: () => [] });
afterEach(stopAll);
describe('phone OpenRig gateway', () => {
  it('sends bounded snapshots without routing or path information', async () => {
    const g = setup({ deps: { openrig: data() } }); g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot'); expect(snap).toMatchObject({ daemon: { openrig: true }, rigs: [{ key: rigKey('local', 'same') }, { key: rigKey('remote', 'same') }] });
    expect(JSON.stringify(snap)).not.toMatch(/machine|cwd|\/home\/private/);
  });
  it('exposes the local OpenRig status without installation commands or remote details', async () => {
    const view = { ...data(), statuses: () => [{ machine: 'local', state: 'unsupported' as const, version: '1.2', install: '/home/private/install.sh' }, { machine: 'remote', state: 'running' as const }] };
    const g = setup({ deps: { openrig: view } }); g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot'); expect(snap).toMatchObject({ openrigStatus: { state: 'unsupported', version: '1.2' } });
    expect(JSON.stringify(snap)).not.toContain('/home/private');
  });
  it('lists idle projects by safe identity without sending their repository paths', async () => {
    const projects: Projects = { projects: [{ id: 'website', name: 'Website', color: 'blue', description: '', repos: [{ machine: 'local', path: '/home/private/website' }], rigs: [] }], rules: [] };
    const g = setup({ deps: { openrig: { ...data(), projects: () => projects } } });
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap).toMatchObject({ projects: [{ id: 'website', name: 'Website', hasLocalRepo: true }] });
    expect(JSON.stringify(snap)).not.toContain('/home/private');
  });
  it('refuses a rig act without a passkey before dispatch', async () => {
    const g = setup({ deps: { openrig: data() } }); const op = randomUUID(); g.send('dev1', { type: 'rig.act', op, key: rigKey('remote', 'same'), verb: 'down' }); await flush();
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'rejected', reason: 'confirm_required' }); expect(g.dispatched).toEqual([]);
  });
  it('forwards an answer without passkey as the user', async () => {
    const g = setup({ deps: { openrig: data() }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') reply({ type: 'rig.result', rid: msg.rid, ok: true }); } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.dispatched).toContainEqual({ type: 'escalation.answer', rid: op, id: 'q1', by: 'user', answers: { q: 'a' } });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'received' });
  });
  it('refuses duplicate ids across local and remote machines without dispatch', async () => {
    const local = { ...escalation, machine: 'local' };
    const view = { ...data(), escalations: () => [local, escalation], escalation: () => local, escalationAmbiguous: () => true };
    const g = setup({ deps: { openrig: view } }); const op = randomUUID();
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    expect(g.got('dev1').find(m => m.type === 'snapshot')).toMatchObject({ escalations: [] });
    g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'invalid' }); expect(g.dispatched).toEqual([]);
  });
  it('does not attach an ambiguous escalation to a conversation', async () => {
    const view = { ...data(), escalationAmbiguous: () => true }; const g = setup({ deps: { openrig: view } });
    const op = randomUUID(); g.send('dev1', { type: 'ledge.say', op, text: 'En parler', about: 'q1' }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'invalid' }); expect(g.dispatched).toEqual([]);
  });
  it('refuses a collision remembered after an aggregate replaced its former owner', async () => {
    const view = { ...data(), escalationAmbiguous: () => true };
    const g = setup({ deps: { openrig: view } }); const op = randomUUID();
    g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'invalid' }); expect(g.dispatched).toEqual([]);
  });
  it('a remote success without a visible queue overlay stays received', async () => {
    const g = setup({ deps: { openrig: data() }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') reply({ type: 'rig.result', rid: msg.rid, ok: true }); } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.dispatched).toHaveLength(1); expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'received' });
    expect(g.results('dev1').some(m => m.type === 'operation.result' && m.op === op && m.status === 'applied')).toBe(false);
  });
  it('reports an actual local answer as applied', async () => {
    const local = { ...escalation, machine: 'local' }; const view = { ...data(), escalations: () => [local], escalation: () => local };
    const g = setup({ deps: { openrig: view }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') reply({ type: 'rig.result', rid: msg.rid, ok: true }); } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'applied' });
  });
  it.each(['queued', 'sent'] as const)('never marks a %s remote answer as applied', async (delivery) => {
    const e = { ...escalation }; const d = { ...data(), escalation: () => e, escalations: () => [e] };
    const g = setup({ deps: { openrig: d }, dispatch: async (msg, reply) => { if (msg.type === 'escalation.answer') { Object.assign(e, { state: 'answered', answer: { by: 'user', answers: msg.answers, at, delivery } }); reply({ type: 'rig.result', rid: msg.rid, ok: true }); } } });
    const op = randomUUID(); g.send('dev1', { type: 'escalation.answer', op, id: 'q1', answers: { q: 'a' } }); await flush();
    expect(g.dispatched).toContainEqual({ type: 'escalation.answer', rid: op, id: 'q1', by: 'user', answers: { q: 'a' } });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op, status: 'received' });
    expect(g.results('dev1').some(m => m.type === 'operation.result' && m.op === op && m.status === 'applied')).toBe(false);

  });
  it('returns the most recent 200 exchanges without paths', async () => {
    const exchanges = Array.from({ length: 350 }, (_, n) => ({ id: `x${n}`, machine: 'remote', rigId: 'same', from: '@a', to: '@b', kind: 'message' as const, text: `hello /home/private/${n}`, at }));
    const g = setup({ deps: { openrig: { ...data(), exchanges: () => exchanges } }, dispatch: async (msg, reply) => { if (msg.type === 'rig.exchanges.request') reply({ type: 'rig.exchanges', machine: msg.machine, rigId: msg.rigId, items: exchanges }); } });
    g.send('dev1', { type: 'rig.exchanges.request', key: rigKey('remote', 'same') }); await flush();
    const message = g.got('dev1').find(m => m.type === 'rig.exchanges');
    expect(message).toMatchObject({ cut: true });
    if (message?.type !== 'rig.exchanges') throw new Error('missing exchanges');
    expect(message.items).toHaveLength(200); expect(message.items[0]?.id).toBe('x150'); expect(message.items.at(-1)?.id).toBe('x349');
    expect(JSON.stringify(message)).not.toMatch(/machine|\/home\/private/);
  });

  it('binds passkeys to the selected machine and never dispatches a changed target', async () => {
    const g = setup({ deps: { openrig: data() }, dispatch: async (msg, reply) => { if (msg.type === 'rig.act') reply({ type: 'rig.result', rid: msg.rid, ok: true }); if (msg.type === 'rig.launch') reply({ type: 'rig.result', rid: msg.rid, ok: false, code: 'failed', reason: 'plan expired' }); } });
    const rp = { rpId: 'relay.test', origin: 'https://relay.test' }; const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' }); await flush();
    const register = g.got('dev1').find(m => m.type === 'confirm.challenge'); if (register?.type !== 'confirm.challenge') throw new Error('no registration challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, register.challenge) }); await flush();
    const remote = { type: 'rig.act' as const, op: randomUUID(), key: rigKey('remote', 'same'), verb: 'down' as const };
    g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', rig: remote }); await flush();
    const challenge = g.got('dev1').findLast(m => m.type === 'confirm.challenge'); if (challenge?.type !== 'confirm.challenge') throw new Error('no rig challenge');
    const assertion = auth.get(rp, challenge.challenge, { counter: 1 });
    g.send('dev1', { ...remote, key: rigKey('local', 'same'), assertion }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' }); expect(g.dispatched).toEqual([]);
    const again = { ...remote, op: randomUUID() }; g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', rig: again }); await flush();
    const next = g.got('dev1').findLast(m => m.type === 'confirm.challenge'); if (next?.type !== 'confirm.challenge') throw new Error('no second challenge');
    g.send('dev1', { ...again, assertion: auth.get(rp, next.challenge, { counter: 2 }) }); await flush();
    expect(g.dispatched).toContainEqual({ type: 'rig.act', rid: again.op, machine: 'remote', rigId: 'same', verb: 'down' });
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'applied' });
    const launch = { type: 'rig.launch' as const, op: randomUUID(), planId: 'expired' };
    g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', rig: launch }); await flush();
    const launchChallenge = g.got('dev1').findLast(m => m.type === 'confirm.challenge'); if (launchChallenge?.type !== 'confirm.challenge') throw new Error('no launch challenge');
    g.send('dev1', { ...launch, assertion: auth.get(rp, launchChallenge.challenge, { counter: 3 }) }); await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'invalid' });
  });

});
