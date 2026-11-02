import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientMessage, Projects, ServerMessage } from '@ledge/protocol';
import { BROADCAST_SILENT, BROADCAST_TIMEOUT_MS, createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { fakeSession } from './mockDaemon';

const remote = { id: 'legion', label: 'legion', url: 'ws://127.0.0.1:47832', ssh: 'legion' };
/** Billing has a repo on local and one on legion; Docs only a rule on legion; Solo only a repo on local. */
const PROJECTS: Projects = {
  projects: [
    { id: 'billing', name: 'Billing', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/billing' }, { machine: 'legion', path: '/srv/billing' }] },
    { id: 'docs', name: 'Docs', color: 'green', description: '', repos: [] },
    { id: 'solo', name: 'Solo', color: 'amber', description: '', repos: [{ machine: 'local', path: '/w/solo' }] }
  ],
  rules: [{ machine: 'legion', path: '/srv/docs', project: 'docs' }]
};
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const sent: ClientMessage[] = [];
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, set, emit: (m: ServerMessage) => messages.forEach(f => f(m)) };
}
const daemon = { version: '0.4.0', install: 'npm' as const, systemd: true, routing: true };
function setup() {
  const local = peer(), legion = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : legion.client);
  client.connect();
  local.emit({ type: 'snapshot', sessions: [fakeSession('pim', { name: 'Pim', cwd: '/w/billing' }), fakeSession('nova', { name: 'Nova', cwd: '/w/solo' })], launcher: ['node'], daemon });
  local.emit({ type: 'projects', projects: PROJECTS });
  legion.emit({ type: 'snapshot', sshAlias: 'legion', launcher: ['node'], daemon, sessions: [
    fakeSession('zed', { name: 'Zed', cwd: '/srv/billing/api' }),
    fakeSession('ivy', { name: 'Ivy', cwd: '/srv/billing', state: 'exited' }),        // ended: not reached
    fakeSession('hook', { name: 'Hook', cwd: '/srv/billing', source: 'hook_only' }),  // not launched by Ledge
    fakeSession('rex', { name: 'Rex', cwd: '/srv/docs' }),
    fakeSession('out', { name: 'Out', cwd: '/srv/other' })
  ] });
  return { client, local, legion };
}
type Broadcast = Extract<ClientMessage, { type: 'session.broadcast' }>;
const broadcasts = (sent: ClientMessage[]) => sent.filter((m): m is Broadcast => m.type === 'session.broadcast');
const answer = (p: ReturnType<typeof peer>, rid: string, r: Partial<Extract<ServerMessage, { type: 'session.broadcast.result' }>>) =>
  p.emit({ type: 'session.broadcast.result', rid, sent: [], refused: [], ...r });
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

it('selected sessions on two machines: one request each, with that machine’s ids and its own rid; the results merged', async () => {
  const { client, local, legion } = setup();
  client.fleet!.select('legion');
  const got = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed', 'local:nova'] }, 'hello', 'b1');
  expect(broadcasts(local.sent)).toEqual([{ type: 'session.broadcast', rid: 'b1:local', to: { sessions: ['pim', 'nova'] }, text: 'hello' }]);
  expect(broadcasts(legion.sent)).toEqual([{ type: 'session.broadcast', rid: 'b1:legion', to: { sessions: ['zed'] }, text: 'hello' }]);
  let settled = false; void got.then(() => { settled = true; });
  answer(local, 'b1:local', { sent: [{ id: 'pim', name: 'Pim' }], refused: [{ name: 'Nova', reason: 'Nova s’est terminée' }] });
  answer(local, 'other:local', { reason: 'nope' });
  await Promise.resolve();
  expect(settled).toBe(false);
  answer(legion, 'b1:legion', { sent: [{ id: 'zed', name: 'Zed' }] });
  await expect(got).resolves.toEqual({ type: 'session.broadcast.result', rid: 'b1', sent: [{ id: 'local:pim', name: 'Pim' }, { id: 'legion:zed', name: 'Zed' }], refused: [{ name: 'Nova', reason: 'Nova s’est terminée' }] });
});

it('a project with repos on two machines: the local daemon by the project, legion by its sessions the registry files there', async () => {
  const { client, local, legion } = setup();
  const got = client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b2');
  expect(broadcasts(local.sent)).toEqual([{ type: 'session.broadcast', rid: 'b2:local', to: { project: 'billing' }, text: 'hello' }]);
  expect(broadcasts(legion.sent)).toEqual([{ type: 'session.broadcast', rid: 'b2:legion', to: { sessions: ['zed'] }, text: 'hello' }]);
  answer(local, 'b2:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  answer(legion, 'b2:legion', { sent: [{ id: 'zed', name: 'Zed' }] });
  expect((await got).sent.map(x => x.id)).toEqual(['local:pim', 'legion:zed']);
  // A rule places Docs on legion only: the local daemon is not asked.
  void client.fleet!.broadcast({ project: 'Docs' }, 'hi', 'b3');
  expect(broadcasts(local.sent).map(m => m.rid)).not.toContain('b3:local');
  expect(broadcasts(legion.sent).at(-1)).toEqual({ type: 'session.broadcast', rid: 'b3:legion', to: { sessions: ['rex'] }, text: 'hi' });
});

it('one machine refusing while the other sends: no top-level reason', async () => {
  const { client, local, legion } = setup();
  const got = client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b4');
  answer(local, 'b4:local', { refused: [], reason: 'personne d’autre dans le projet Billing' });
  answer(legion, 'b4:legion', { sent: [{ id: 'zed', name: 'Zed' }] });
  const r = await got;
  expect(r.reason).toBeUndefined();
  expect(r.sent).toEqual([{ id: 'legion:zed', name: 'Zed' }]);
});

it('nothing sent anywhere: the first daemon’s reason', async () => {
  const { client, local, legion } = setup();
  const got = client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b5');
  answer(local, 'b5:local', { reason: 'personne d’autre dans le projet Billing' });
  answer(legion, 'b5:legion', { refused: [{ name: 'Zed', reason: 'Zed : impossible de lui écrire' }], reason: 'personne à qui écrire' });
  await expect(got).resolves.toMatchObject({ sent: [], refused: [{ name: 'Zed' }], reason: 'personne d’autre dans le projet Billing' });
});

it('an offline machine is one refusal naming it; the others still get theirs', async () => {
  const { client, local, legion } = setup();
  legion.set('unreachable');
  const got = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed'] }, 'hello', 'b6');
  expect(broadcasts(legion.sent)).toEqual([]);
  answer(local, 'b6:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  await expect(got).resolves.toMatchObject({ sent: [{ id: 'local:pim' }], refused: [{ name: 'legion', reason: 'legion : hors ligne' }] });
  // The project's other machine offline too: a refusal, and the local part goes.
  const project = client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b7');
  answer(local, 'b7:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  await expect(project).resolves.toMatchObject({ sent: [{ id: 'local:pim' }], refused: [{ reason: 'legion : hors ligne' }] });
});

it('a machine dropping while it is asked is a refusal naming it', async () => {
  const { client, local, legion } = setup();
  const got = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed'] }, 'hello', 'b8');
  answer(local, 'b8:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  legion.set('unreachable');
  await expect(got).resolves.toMatchObject({ refused: [{ reason: 'legion : hors ligne' }] });
});

it('an older daemon’s refusal of the message settles only that machine’s oldest broadcast: « version trop ancienne »', async () => {
  const { client, local, legion } = setup();
  const first = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed'] }, 'hello', 'b9');
  const second = client.fleet!.broadcast({ sessions: ['legion:zed'] }, 'again', 'b10');
  legion.emit({ type: 'error', message: 'invalid message', request: 'session.broadcast', code: 'invalid' });
  answer(local, 'b9:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  await expect(first).resolves.toMatchObject({ sent: [{ id: 'local:pim' }], refused: [{ name: 'legion', reason: 'legion : version trop ancienne' }] });
  let settled = false; void second.then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  answer(legion, 'b10:legion', { sent: [{ id: 'zed', name: 'Zed' }] });
  await expect(second).resolves.toMatchObject({ sent: [{ id: 'legion:zed' }] });
});

it('a machine silent past the timeout is a refusal naming it; every machine silent, the reason is BROADCAST_SILENT', async () => {
  vi.useFakeTimers();
  const { client, local } = setup();
  const some = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed'] }, 'hello', 'b11');
  answer(local, 'b11:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  vi.advanceTimersByTime(BROADCAST_TIMEOUT_MS);
  await expect(some).resolves.toMatchObject({ sent: [{ id: 'local:pim' }], refused: [{ reason: 'legion : pas de réponse' }] });
  const none = client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b12');
  vi.advanceTimersByTime(BROADCAST_TIMEOUT_MS);
  const r = await none;
  expect(r).toMatchObject({ sent: [], reason: BROADCAST_SILENT });
  expect(r.refused.map(x => x.reason)).toEqual(['Local : pas de réponse', 'legion : pas de réponse']);
});

it('a resend keeps its rid, so each daemon answers it once', () => {
  const { client, local, legion } = setup();
  void client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b-again');
  void client.fleet!.broadcast({ project: 'billing' }, 'hello', 'b-again');
  expect(broadcasts(local.sent).map(m => m.rid)).toEqual(['b-again:local', 'b-again:local']);
  expect(broadcasts(legion.sent).map(m => m.rid)).toEqual(['b-again:legion', 'b-again:legion']);
});

it('a project the registry does not know goes to the local daemon, which says so', async () => {
  const { client, local, legion } = setup();
  const got = client.fleet!.broadcast({ project: 'ghost' }, 'hello', 'b13');
  expect(broadcasts(local.sent)).toEqual([{ type: 'session.broadcast', rid: 'b13:local', to: { project: 'ghost' }, text: 'hello' }]);
  expect(broadcasts(legion.sent)).toEqual([]);
  answer(local, 'b13:local', { reason: 'aucun projet ghost' });
  await expect(got).resolves.toMatchObject({ sent: [], reason: 'aucun projet ghost' });
});

it('a session of a machine kept in the list but disabled is refused as offline, never sent to the local daemon as a name', async () => {
  const { client, local } = setup();
  client.fleet!.configure([LOCAL_MACHINE, { ...remote, disabled: true }]);
  const got = client.fleet!.broadcast({ sessions: ['local:pim', 'legion:zed'] }, 'hello', 'b14');
  expect(broadcasts(local.sent)).toEqual([{ type: 'session.broadcast', rid: 'b14:local', to: { sessions: ['pim'] }, text: 'hello' }]);
  answer(local, 'b14:local', { sent: [{ id: 'pim', name: 'Pim' }] });
  await expect(got).resolves.toMatchObject({ refused: [{ reason: 'legion : hors ligne' }] });
});
