import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, type ClientMessage, type Projects } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

// Réglages › Projets on the phone: names, colours, order, an empty project and a deletion, never a folder.

afterEach(stopAll);

type G = ReturnType<typeof setup>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const START: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: 'the app', repos: [{ machine: 'local', path: '/home/u/ledge' }] },
    { id: 'bots', name: 'Bots', color: 'green', description: '', repos: [{ machine: 'local', path: '/home/u/bots' }] },
    { id: 'site', name: 'Site', color: 'amber', description: '', repos: [] }
  ],
  rules: [{ machine: 'local', path: '/home/u/tmp', project: 'ledge' }]
};

/** A gateway on a daemon holding `START`: its `projects.set` replaces them, as the daemon's own does. */
function make(o: { refuse?: boolean } = {}) {
  const box = { state: structuredClone(START) as Projects, sets: [] as Projects[] };
  const g = setup({
    deps: { projects: () => box.state },
    dispatch: async (msg: ClientMessage, reply) => {
      if (msg.type !== 'projects.set') return;
      if (o.refuse) { reply({ type: 'error', message: 'duplicate_name at /home/u', request: 'projects.set' } as never); return; }
      box.sets.push(msg.projects); box.state = msg.projects;
    }
  });
  return { g, box };
}
const outcome = (g: G, op: string) => g.results('dev1').filter(r => r.type === 'operation.result' && r.op === op && r.status !== 'received').at(-1);
const send = async (g: G, msg: object) => { const op = randomUUID(); g.send('dev1', { ...msg, op }); await flush(); return outcome(g, op); };

const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const prepare = async (g: G, project: string, moveTo: string | null) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'project', project, moveTo });
  await flush();
  return g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
};

describe('phone projects: what the PC offers', () => {
  it('a daemon with projects says projectEdit; one without says nothing and refuses', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = PhoneServerMessageSchema.parse(g.got('dev1').find(m => m.type === 'snapshot'));
    expect(snap.type === 'snapshot' && snap.daemon.projectEdit).toBe(true);
    const bare = setup();
    bare.send('dev1', { type: 'snapshot.request' });
    await flush();
    const b = bare.got('dev1').find(m => m.type === 'snapshot');
    expect(b?.type === 'snapshot' && b.daemon).not.toHaveProperty('projectEdit');
    expect(await send(bare, { type: 'project.create', name: 'X', color: 'red' })).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });
});

describe('phone projects: edit, order, create', () => {
  it('renames and recolours a project, its folders, description and the rules untouched', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.edit', id: 'bots', name: '  Robots ', color: 'pink' })).toMatchObject({ status: 'applied' });
    expect(box.state.projects[1]).toEqual({ ...START.projects[1], name: 'Robots', color: 'pink' });
    expect(box.state.projects[0]).toEqual(START.projects[0]);
    expect(box.state.rules).toEqual(START.rules);
    expect(await send(g, { type: 'project.edit', id: 'site', color: 'slate' })).toMatchObject({ status: 'applied' });
    expect(box.state.projects[2]).toMatchObject({ name: 'Site', color: 'slate' });
  });

  it('refuses a name another project has (case and accents aside), an unknown project, and an edit of nothing', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.edit', id: 'bots', name: 'lédge' })).toMatchObject({ status: 'rejected', reason: 'name_taken' });
    expect(await send(g, { type: 'project.edit', id: 'gone', name: 'X' })).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(await send(g, { type: 'project.edit', id: 'bots' })).toMatchObject({ status: 'rejected', reason: 'invalid' });
    expect(await send(g, { type: 'project.edit', id: 'bots', name: 'Bots' })).toMatchObject({ status: 'applied' });
    expect(box.sets).toHaveLength(1);
  });

  it('a project change never carries a folder: a repos or rules field is refused as invalid', async () => {
    const { g, box } = make();
    g.send('dev1', { type: 'project.edit', op: randomUUID(), id: 'bots', name: 'X', repos: [{ machine: 'local', path: '/' }] });
    g.send('dev1', { type: 'project.create', op: randomUUID(), name: 'X', color: 'red', repos: [{ machine: 'local', path: '/' }] });
    await flush();
    expect(g.got('dev1').map(m => m.type === 'error' && m.code)).toEqual(['invalid', 'invalid']);
    expect(box.sets).toEqual([]);
  });

  it('orders the whole list; a list that misses, repeats or invents a project is stale', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.order', ids: ['site', 'ledge', 'bots'] })).toMatchObject({ status: 'applied' });
    expect(box.state.projects.map(p => p.id)).toEqual(['site', 'ledge', 'bots']);
    expect(box.state.projects[1]).toEqual(START.projects[0]);
    for (const ids of [['site', 'ledge'], ['site', 'site', 'bots'], ['site', 'ledge', 'nope']]) {
      expect(await send(g, { type: 'project.order', ids })).toMatchObject({ status: 'rejected', reason: 'stale' });
    }
  });

  it('creates an empty project named by the PC, at the end, and refuses a name taken', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.create', name: 'Budget Bots', color: 'violet' })).toMatchObject({ status: 'applied' });
    expect(box.state.projects.at(-1)).toEqual({ id: 'budget-bots', name: 'Budget Bots', color: 'violet', description: '', repos: [] });
    expect(await send(g, { type: 'project.create', name: 'budget bots', color: 'red' })).toMatchObject({ status: 'rejected', reason: 'name_taken' });
  });

  it('a refusal of the daemon is the operation\'s, never its words', async () => {
    const { g } = make({ refuse: true });
    expect(await send(g, { type: 'project.create', name: 'X', color: 'red' })).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(g.got('dev1'))).not.toContain('/home/u');
  });
});

describe('phone projects: delete, with the device\'s check', () => {
  it('without a passkey: confirm_required, nothing deleted', async () => {
    const { g, box } = make();
    expect(await send(g, { type: 'project.delete', id: 'bots', moveTo: null })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(box.sets).toEqual([]);
  });

  it('with its check: deleted, its folders and rules dropped (moveTo null) or moved to the project chosen', async () => {
    const { g, box } = make();
    const auth = await enroll(g);
    const ch = await prepare(g, 'ledge', 'site');
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.delete', id: 'ledge', moveTo: 'site', assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'applied' });
    expect(box.state.projects.map(p => p.id)).toEqual(['bots', 'site']);
    expect(box.state.projects[1]!.repos).toEqual([{ machine: 'local', path: '/home/u/ledge' }]);
    expect(box.state.rules).toEqual([{ machine: 'local', path: '/home/u/tmp', project: 'site' }]);
    const ch2 = await prepare(g, 'bots', null);
    if (ch2?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.delete', id: 'bots', moveTo: null, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) })).toMatchObject({ status: 'applied' });
    expect(box.state.projects.map(p => p.id)).toEqual(['site']);
  });

  it('a check covers that deletion only: another project or another destination is refused', async () => {
    const { g, box } = make();
    const auth = await enroll(g);
    const ch = await prepare(g, 'bots', null);
    if (ch?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.delete', id: 'bots', moveTo: 'site', assertion: auth.get(rp, ch.challenge, { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const ch2 = await prepare(g, 'bots', null);
    if (ch2?.type !== 'confirm.challenge') throw new Error('no challenge');
    expect(await send(g, { type: 'project.delete', id: 'site', moveTo: null, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(box.sets).toEqual([]);
  });

  it('no challenge for an unknown project, a move to itself or to an unknown one, nor without a passkey', async () => {
    const { g } = make();
    expect(await prepare(g, 'bots', null)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    await enroll(g);
    expect(await prepare(g, 'nope', null)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(await prepare(g, 'bots', 'bots')).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(await prepare(g, 'bots', 'nope')).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
  });
});
