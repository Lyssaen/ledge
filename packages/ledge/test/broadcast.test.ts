// Broadcast against the real daemon and the real mailbox: what each recipient gets is what tmux was typed, never only the ack.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Projects, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { History } from '../src/daemon/history.js';
import { writeProjects } from '../src/daemon/projects.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

const T0 = '2026-11-02T10:00:00.000Z';
const IDLE = readFileSync(new URL('./fixtures/panes/codex-idle-after-turn.txt', import.meta.url), 'utf8');

function fakeTmux(panes: Record<string, string[]>): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession(o) { panes[o.name] = ['']; }, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { delete panes[n]; }, attachArgs: n => ['attach', n]
  };
}

const mk = (id: string, name: string, cwd: string, extra: Partial<Session> = {}): Session => ({
  id, name, tool: 'codex', cwd, project: 'x', title: name, tmuxSession: `ledge-${id}`, state: 'idle', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

/** `billing` covers two folders; `Solo` one, where only Sol works. */
const PROJECTS: Projects = {
  projects: [
    { id: 'billing', name: 'billing', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/billing-api' }, { machine: 'local', path: '/w/billing-web' }] },
    { id: 'solo-1', name: 'Solo', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/solo' }] }
  ],
  rules: []
};

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let history: History;
beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-broadcast-'));
  const projectsFile = join(process.env.LEDGE_HOME, 'projects.json');
  writeProjects(PROJECTS, projectsFile);
  store = new Store();
  tmux = fakeTmux({ 'ledge-a': [IDLE], 'ledge-b': [IDLE], 'ledge-o': [IDLE], 'ledge-sol': [IDLE], 'rig-seat': [IDLE] });
  history = new History({ dir: mkdtempSync(join(tmpdir(), 'ledge-broadcast-history-')) });
  srv = await startServer({ store, tmux, port: 0, history, projectsFile });
  store.upsert(mk('a', 'Pim', '/w/billing-api'));
  store.upsert(mk('b', 'Nova', '/w/billing-web/src'));
  // Read only: it came by its hooks, Ledge cannot type into it.
  store.upsert(mk('z', 'Zed', '/w/billing-api', { source: 'hook_only', tmuxSession: null, tool: 'claude' }));
  // An OpenRig seat in the project's folder, with a terminal: Ledge still never writes to it.
  store.upsert(mk('s', 'dev-build', '/w/billing-api', { source: 'rig', tmuxSession: 'rig-seat', rig: { seat: 'dev-build@factory', name: 'factory' } }));
  store.upsert(mk('o', 'Otto', '/w/other'));
  store.upsert(mk('sol', 'Sol', '/w/solo'));
});
afterEach(async () => { await srv.close(); });

/** What was typed into a tmux session, text only. */
const typed = (pane: string) => tmux.sent.filter(x => x[0] === 'text' && x[1] === pane).map(x => x[2]!);
const cards = (id: string) => history.items(id).filter(i => i.kind === 'sent');
const setState = (id: string, state: Session['state']) => store.upsert({ ...store.get(id)!, state });

describe('broadcast from a session (session.message)', () => {
  it('@projet:billing reaches the other live Ledge sessions of the project only, with one card (Review Focus 1)', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r1', from: 'a', to: '@projet:billing', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r1', outcome: 'accepted', recipients: { sent: ['Nova'], refused: [] } });
    await until(() => typed('ledge-b').length === 1, 3000);
    expect(typed('ledge-b')[0]).toMatch(/^<ledge-message from="Pim" tool="codex" id="m[0-9a-f]{6}">\(message de la session Pim, .*\) \(à tout le projet billing\) Salut<\/ledge-message>$/);
    // Neither the sender, nor the read-only session, nor the seat, nor a session outside the project.
    expect(typed('ledge-a')).toEqual([]); expect(typed('rig-seat')).toEqual([]); expect(typed('ledge-o')).toEqual([]); expect(typed('ledge-sol')).toEqual([]);
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    expect(cards('a')).toEqual([expect.objectContaining({ kind: 'sent', id: 'r1', to: '@projet:billing', text: 'Salut', status: 'delivered' })]);
    expect(cards('a')[0]).not.toHaveProperty('peer');
    c.close();
  });

  it('a list drops the sender and a duplicate, refuses an unknown name (Review Focus 2)', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r2', from: 'a', to: 'Nova,Otto,Pim,nova,Ghost', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r2', outcome: 'accepted',
      recipients: { sent: ['Nova', 'Otto'], refused: [{ name: 'Ghost', reason: 'aucune session Ledge nommée Ghost' }] } });
    await until(() => typed('ledge-b').length === 1 && typed('ledge-o').length === 1, 3000);
    expect(typed('ledge-b')[0]).toContain(') (à Nova, Otto) Salut</ledge-message>');
    expect(typed('ledge-o')[0]).toContain(') (à Nova, Otto) Salut</ledge-message>');
    expect(typed('ledge-a')).toEqual([]);
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    expect(cards('a')).toEqual([expect.objectContaining({ id: 'r2', to: 'Nova, Otto', status: 'delivered' })]);
    c.close();
  });

  it('a list naming a read-only session or a seat refuses each with its reason', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r3', from: 'a', to: 'Nova,Zed,dev-build', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'accepted', recipients: { sent: ['Nova'], refused: [
      { name: 'Zed', reason: "Zed n'a pas été lancée par Ledge : impossible de lui écrire" },
      { name: 'dev-build', reason: 'dev-build est un siège OpenRig : écris-lui avec rig send' }
    ] } });
    await until(() => typed('ledge-b').length === 1, 3000);
    expect(typed('rig-seat')).toEqual([]);
    c.close();
  });

  it('an unknown project, a project with nobody else, a list with nobody to write to: refused, no card (Review Focus 3)', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r4', from: 'a', to: '@projet:nope', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ rid: 'r4', outcome: 'refused', reason: 'aucun projet nope' });
    c.send({ type: 'session.message', rid: 'r5', from: 'sol', to: '@projet:solo', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ rid: 'r5', outcome: 'refused', reason: "personne d'autre dans le projet Solo" });
    // The id works too.
    c.send({ type: 'session.message', rid: 'r6', from: 'sol', to: '@projet:solo-1', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ rid: 'r6', outcome: 'refused', reason: "personne d'autre dans le projet Solo" });
    c.send({ type: 'session.message', rid: 'r7', from: 'a', to: 'Ghost,Zed', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ rid: 'r7', outcome: 'refused', reason: 'personne à qui écrire',
      recipients: { sent: [], refused: [{ name: 'Ghost', reason: 'aucune session Ledge nommée Ghost' }, { name: 'Zed', reason: "Zed n'a pas été lancée par Ledge : impossible de lui écrire" }] } });
    await new Promise(r => setTimeout(r, 100));
    expect(cards('a')).toEqual([]); expect(cards('sol')).toEqual([]);
    expect(tmux.sent.filter(x => x[0] === 'text')).toEqual([]);
    c.close();
  });

  it('a busy recipient queues it behind what already waits, and gets it at the end of its turn (Review Focus 5)', async () => {
    setState('b', 'working');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r0', from: 'o', to: 'Nova', text: 'Premier' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'queued' });
    c.send({ type: 'session.message', rid: 'r8', from: 'a', to: '@projet:billing', text: 'Second' });
    expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r8', outcome: 'queued', recipients: { sent: ['Nova'], refused: [] } });
    await new Promise(r => setTimeout(r, 100));
    expect(typed('ledge-b')).toEqual([]);
    expect(cards('a')).toEqual([expect.objectContaining({ id: 'r8', status: 'sending' })]);
    setState('b', 'idle');
    await until(() => typed('ledge-b').length === 1, 3000);
    const line = typed('ledge-b')[0]!;
    expect(line.indexOf('Premier')).toBeGreaterThan(-1);
    expect(line.indexOf('Premier')).toBeLessThan(line.indexOf('(à tout le projet billing) Second'));
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    c.close();
  });

  it('the card is delivered once one recipient got it, a failure elsewhere does not take it back', async () => {
    setState('b', 'working'); setState('o', 'working');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r9', from: 'a', to: 'Nova,Otto', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'queued', recipients: { sent: ['Nova', 'Otto'] } });
    // Otto goes before getting it: Nova still waits for hers, the card is not failed.
    store.remove('o');
    await new Promise(r => setTimeout(r, 100));
    expect(cards('a')).toEqual([expect.objectContaining({ id: 'r9', status: 'sending' })]);
    setState('b', 'idle');
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    c.close();
  });

  it('a delivered card stays delivered when another recipient fails afterwards', async () => {
    setState('o', 'working');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r12', from: 'a', to: 'Nova,Otto', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toMatchObject({ outcome: 'accepted', recipients: { sent: ['Nova', 'Otto'] } });
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    store.remove('o');
    // The sender is told of Otto's failure, by a notice typed into it; its card says it went.
    await until(() => typed('ledge-a').length === 1, 3000);
    expect(typed('ledge-a')[0]).toContain('Otto');
    expect(cards('a')).toEqual([expect.objectContaining({ id: 'r12', status: 'delivered' })]);
    c.close();
  });

  it('the card fails when no recipient got it', async () => {
    setState('b', 'working'); setState('o', 'working');
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r10', from: 'a', to: 'Nova,Otto', text: 'Salut' });
    await c.next('message.ack', 3000);
    store.remove('o'); store.remove('b');
    await until(() => cards('a')[0]?.status === 'failed', 3000);
    c.close();
  });

  it('a message to one name is unchanged: same ack, same card', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.message', rid: 'r11', from: 'a', to: 'Nova', text: 'Salut' });
    expect(await c.next('message.ack', 3000)).toEqual({ type: 'message.ack', rid: 'r11', outcome: 'accepted' });
    await until(() => cards('a')[0]?.status === 'delivered', 3000);
    expect(cards('a')).toEqual([expect.objectContaining({ id: 'r11', to: 'Nova', peer: 'b' })]);
    expect(typed('ledge-b')[0]).toMatch(/\) Salut<\/ledge-message>$/);
    c.close();
  });
});

describe('broadcast from the user (session.broadcast)', () => {
  it('to a project: a notice to each live Ledge session of it', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.broadcast', rid: 'u1', to: { project: 'Billing' }, text: 'Salut' });
    expect(await c.next('session.broadcast.result', 3000)).toEqual({ type: 'session.broadcast.result', rid: 'u1', sent: [{ id: 'a', name: 'Pim' }, { id: 'b', name: 'Nova' }], refused: [] });
    await until(() => typed('ledge-a').length === 1 && typed('ledge-b').length === 1, 3000);
    expect(typed('ledge-a')).toEqual(["Message de l'utilisateur (à tout le projet billing) : Salut"]);
    expect(typed('ledge-b')).toEqual(["Message de l'utilisateur (à tout le projet billing) : Salut"]);
    expect(typed('rig-seat')).toEqual([]); expect(typed('ledge-o')).toEqual([]);
    c.close();
  });

  it('to sessions by id or name: each refused one says why', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.broadcast', rid: 'u2', to: { sessions: ['b', 'Otto', 'z', 's', 'Ghost', 'Nova'] }, text: 'Salut' });
    expect(await c.next('session.broadcast.result', 3000)).toEqual({ type: 'session.broadcast.result', rid: 'u2', sent: [{ id: 'b', name: 'Nova' }, { id: 'o', name: 'Otto' }], refused: [
      { name: 'Zed', reason: "Zed n'a pas été lancée par Ledge : impossible de lui écrire" },
      { name: 'dev-build', reason: 'dev-build est un siège OpenRig : écris-lui avec rig send' },
      { name: 'Ghost', reason: 'aucune session Ledge nommée Ghost' }
    ] });
    await until(() => typed('ledge-b').length === 1 && typed('ledge-o').length === 1, 3000);
    expect(typed('ledge-o')).toEqual(["Message de l'utilisateur (à Nova, Otto) : Salut"]);
    c.close();
  });

  it('to an unknown project: refused with its reason', async () => {
    const c = await connect({ port: srv.port }); await c.next('snapshot');
    c.send({ type: 'session.broadcast', rid: 'u3', to: { project: 'nope' }, text: 'Salut' });
    expect(await c.next('session.broadcast.result', 3000)).toEqual({ type: 'session.broadcast.result', rid: 'u3', sent: [], refused: [], reason: 'aucun projet nope' });
    c.close();
  });
});
