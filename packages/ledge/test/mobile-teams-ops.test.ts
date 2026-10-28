import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, teamsDigest, teamsPurpose, type ClientMessage, type ServerMessage, type Team, type TeamsOperation } from '@ledge/protocol';
import { CATALOG_BUDGET } from '../src/mobile/project.js';
import { createTeamsOps } from '../src/mobile/teamsOps.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { T0, flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

type G = ReturnType<typeof setup>;
/** An operation without its op and assertion, as the phone drafts it (`teamsDigest`'s own parameter type collapses the union, so its literals are not checked). */
type Body = { type: TeamsOperation['type'] } & Record<string, unknown>;
type Listing = Extract<ServerMessage, { type: 'definitions.listing' }>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const HASH = '0123456789abcdef';
const HOME = '/home/me/.ledge';
const REPO = '/work/secret-repo/.ledge';

const role = (id: string, source: 'home' | 'repo', extra: object = {}) => ({ id, label: id.toUpperCase(), prompt: `prompt of ${id}`, source, path: `${source === 'home' ? HOME : REPO}/roles/${id}.md`, hash: HASH, ...extra });
const listing = (extra: Partial<Listing['scopes'][number]>[] = []): Listing => ({
  type: 'definitions.listing',
  scopes: [
    { scope: 'home', project: null, roles: [role('lead', 'home'), role('qa', 'home')], templates: [{ id: 'duo', name: 'Duo', seats: [{ role: 'lead' }, { role: 'qa' }], source: 'home', path: `${HOME}/teams/duo.yaml`, hash: HASH }], problems: [{ path: `${HOME}/roles/broken.md`, reason: `cannot read ${HOME}/roles/broken.md: bad front matter` }] },
    { scope: 'repo', project: 'p-repo', roles: [role('lead', 'repo', { shadows: `${HOME}/roles/lead.md` })], templates: [], problems: [{ path: `${REPO}/teams/x.yaml`, reason: 'yaml' }] },
    ...extra.map(e => ({ scope: 'repo' as const, project: 'p-x', roles: [], templates: [], problems: [], ...e }))
  ]
});

/** A gateway whose daemon answers `definitions.list` with `listed` and every other message with `answer(msg)` (nothing by default). */
function make(o: { listed?: Listing; answer?: (m: ClientMessage) => ServerMessage | ServerMessage[] | undefined; teams?: () => Team[]; tasks?: () => never[] } = {}) {
  const sent: ClientMessage[] = [];
  const g = setup({
    ...(o.teams ? { teams: o.teams, tasks: o.tasks ?? (() => []) } : {}),
    dispatch: async (msg, reply) => {
      sent.push(msg);
      if (msg.type === 'definitions.list') { reply({ ...(o.listed ?? listing()), ...(msg.requestId ? { requestId: msg.requestId } : {}) }); return; }
      const a = o.answer?.(msg);
      for (const m of a === undefined ? [] : Array.isArray(a) ? a : [a]) reply(m);
    },
    deps: { projectByName: n => (n === 'Repo' ? 'p-repo' : n === 'X' ? 'p-x' : null), projectName: id => (id === 'p-repo' ? 'Repo' : id === 'p-x' ? 'X' : null), teamCatalog: true }
  });
  /** What reached the daemon, apart from the catalog reads. */
  const writes = () => sent.filter(m => m.type !== 'definitions.list');
  return { g, sent, writes };
}

/** The operations of the passkey's registration, apart from the ones under test. */
const regOps = new Set<string>();
const finals = (g: G) => g.results('dev1').filter(r => r.status !== 'received' && !regOps.has(r.op));
const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  const op = randomUUID();
  regOps.add(op);
  g.send('dev1', { type: 'credential.register', op, credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
/** Asks for the challenge of `msg`'s digest and returns it. */
const prepare = async (g: G, msg: Body, digest?: string) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: teamsPurpose(msg.type), digest: digest ?? await teamsDigest(msg as never) });
  await flush();
  const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
  if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
  return m;
};
const last = (g: G) => finals(g).at(-1);
/** Waits for the operation's final answer: the digest is computed with WebCrypto, which needs more than a few ticks. */
const settled = async (g: G, op: string) => {
  for (let i = 0; i < 400 && !g.results('dev1').some(r => r.op === op && r.status !== 'received'); i++) await new Promise(r => setTimeout(r, 5));
};

const draft = (prompt = 'Lead the team.') => ({ id: 'newrole', label: 'New role', prompt });
const roleWrite = (extra: object = {}) => ({ type: 'role.write' as const, scope: 'repo' as const, project: 'Repo', role: draft(), base: null, ...extra });
const SEATS = [{ role: 'lead' }, { role: 'qa' }];
/** Prepares, signs and sends `body` (a message without op and assertion); returns the op id. */
async function confirmed(g: G, auth: ReturnType<typeof softAuthenticator>, body: Body, counter = 1) {
  const ch = await prepare(g, body);
  const op = randomUUID();
  g.send('dev1', { ...body, op, assertion: auth.get(rp, ch.challenge, { counter }) });
  await settled(g, op);
  return op;
}

describe('phone gateway: team catalog', () => {
  it('teams.catalog pushes a catalog with no path in it: only names, basenames of the files that failed', async () => {
    const { g } = make();
    g.send('dev1', { type: 'teams.catalog' });
    await flush();
    const m = g.got('dev1').find(x => x.type === 'teams.catalog');
    expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    if (m?.type !== 'teams.catalog') throw new Error('no catalog');
    const text = JSON.stringify(m);
    expect(text).not.toContain('/');
    expect(text).not.toContain('.ledge');
    expect(text).not.toContain('secret-repo');
    expect(m.catalog.projects).toEqual(['Repo']);
    expect(m.catalog.problems.map(p => [p.file, p.scope, p.project])).toEqual([['broken.md', 'home', null], ['x.yaml', 'repo', 'Repo']]);
    expect(m.catalog.problems[0]!.reason).toContain('broken.md');
  });

  it('a repository role takes its project\'s name and marks the home role of the same id: shadows / shadowed', async () => {
    const { g } = make();
    g.send('dev1', { type: 'teams.catalog' });
    await flush();
    const m = g.got('dev1').find(x => x.type === 'teams.catalog');
    if (m?.type !== 'teams.catalog') throw new Error('no catalog');
    const byKey = (id: string, scope: string) => m.catalog.roles.find(r => r.id === id && r.scope === scope);
    expect(byKey('lead', 'repo')).toMatchObject({ project: 'Repo', shadows: true, hash: HASH });
    expect(byKey('lead', 'repo')).not.toHaveProperty('shadowed');
    expect(byKey('lead', 'home')).toMatchObject({ project: null, shadowed: true });
    expect(byKey('qa', 'home')).not.toHaveProperty('shadowed');
    expect(m.catalog.templates).toEqual([{ id: 'duo', name: 'Duo', seats: [{ role: 'lead' }, { role: 'qa' }], scope: 'home', project: null, hash: HASH }]);
  });

  it('60 roles of 8000 characters fit the frame: the catalog parses, is cut, and stays within CATALOG_BUDGET (Review Focus 2)', async () => {
    const roles = Array.from({ length: 60 }, (_, i) => role(`r${i}`, 'home', { prompt: 'x'.repeat(8000) }));
    const { g } = make({ listed: { type: 'definitions.listing', scopes: [{ scope: 'home', project: null, roles, templates: [], problems: [] }] } });
    g.send('dev1', { type: 'teams.catalog' });
    await flush();
    const m = g.got('dev1').find(x => x.type === 'teams.catalog');
    expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    if (m?.type !== 'teams.catalog') throw new Error('no catalog');
    const cut = m.catalog.roles.filter(r => r.cut === true);
    expect(cut.length).toBeGreaterThan(0);
    for (const r of cut) expect(r.prompt).toHaveLength(200);
    // The first ones are whole, then the rest cut.
    expect(m.catalog.roles[0]!.prompt).toHaveLength(8000);
    expect(m.catalog.roles.at(-1)!.cut).toBe(true);
    expect(JSON.stringify(m.catalog).length).toBeLessThanOrEqual(CATALOG_BUDGET);
  });

  it('without teamCatalog the read is an error invalid', async () => {
    const g = setup({ dispatch: async () => {} });
    g.send('dev1', { type: 'teams.catalog' });
    g.send('dev1', { type: 'teams.role', scope: 'home', id: 'lead' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'error', code: 'invalid', request: 'teams.catalog' }, { type: 'error', code: 'invalid', request: 'teams.role' }]);
  });

  it('teams.role answers the whole prompt of one role, picked by scope, project and id; another is an error', async () => {
    const long = 'y'.repeat(7000);
    const { g } = make({ listed: listing([{ project: 'p-x', roles: [role('lead', 'repo', { prompt: long })] }]) });
    g.send('dev1', { type: 'teams.role', scope: 'repo', project: 'X', id: 'lead' });
    g.send('dev1', { type: 'teams.role', scope: 'home', id: 'lead' });
    g.send('dev1', { type: 'teams.role', scope: 'home', id: 'nope' });
    g.send('dev1', { type: 'teams.role', scope: 'repo', project: 'Nope', id: 'lead' });
    g.send('dev1', { type: 'teams.role', scope: 'repo', id: 'lead' });
    await flush();
    const got = g.got('dev1');
    expect(got).toHaveLength(5);
    for (const m of got) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    const r = got.find(m => m.type === 'teams.role' && m.role.project === 'X');
    expect(r?.type === 'teams.role' && r.role.prompt).toBe(long);
    expect(got.find(m => m.type === 'teams.role' && m.role.scope === 'home')).toMatchObject({ role: { id: 'lead', project: null, prompt: 'prompt of lead' } });
    expect(got.filter(m => m.type === 'error')).toEqual(Array(3).fill({ type: 'error', code: 'invalid', request: 'teams.role' }));
  });
});

describe('phone gateway: teams operations behind the passkey', () => {
  it('confirm.prepare define/team needs a digest and a credential: otherwise error invalid; with both, a challenge of that purpose', async () => {
    const { g } = make();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'define', digest: 'a'.repeat(64) });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    await enroll(g);
    g.send('dev1', { type: 'confirm.prepare', purpose: 'team' });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'team', digest: 'a'.repeat(64) });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'define', digest: 'b'.repeat(64) });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'confirm.challenge').slice(-2).map(m => m.type === 'confirm.challenge' && m.purpose)).toEqual(['team', 'define']);
  });

  it('role.write without an assertion is rejected confirm_required, nothing dispatched', async () => {
    const { g, writes } = make();
    await enroll(g);
    const op = randomUUID();
    g.send('dev1', { ...roleWrite(), op });
    await settled(g, op);
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'confirm_required' });
    expect(writes()).toEqual([]);
  });

  it('a valid role.write reaches the daemon with the project id and rid = op; definition.result {} is applied', async () => {
    const { g, writes } = make({ answer: m => (m.type === 'role.write' ? { type: 'definition.result', rid: m.rid, hash: HASH } : undefined) });
    const auth = await enroll(g);
    const op = await confirmed(g, auth, roleWrite());
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(writes()).toEqual([{ type: 'role.write', rid: op, scope: 'repo', project: 'p-repo', role: draft(), base: null }]);
  });

  it('the phone prepares over content A and signs content B with that challenge: assertion_invalid, nothing dispatched (Review Focus 4)', async () => {
    const { g, writes } = make({ answer: m => (m.type === 'role.write' ? { type: 'definition.result', rid: m.rid } : undefined) });
    const auth = await enroll(g);
    const ch = await prepare(g, roleWrite({ role: draft('A') }));
    const op = randomUUID();
    g.send('dev1', { ...roleWrite({ role: draft('B') }), op, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await settled(g, op);
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'assertion_invalid' });
    expect(writes()).toEqual([]);
  });

  it('a challenge prepared over another operation type is no use: the digest names the type', async () => {
    const { g, writes } = make({ answer: m => (m.type === 'role.delete' ? { type: 'definition.result', rid: m.rid } : undefined) });
    const auth = await enroll(g);
    const ch = await prepare(g, { type: 'role.delete', scope: 'home', id: 'lead', base: HASH });
    const op = randomUUID();
    g.send('dev1', { type: 'role.delete', scope: 'home', id: 'qa', base: HASH, op, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await settled(g, op);
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(writes()).toEqual([]);
  });

  it('an expired challenge is assertion_expired', async () => {
    const { g, writes } = make();
    const auth = await enroll(g);
    const body = roleWrite();
    const ch = await prepare(g, body);
    g.clock.t += 61_000;
    const op = randomUUID();
    g.send('dev1', { ...body, op, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await settled(g, op);
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'assertion_expired' });
    expect(writes()).toEqual([]);
  });

  it('a challenge is single-use: the same signed operation under a new op id is refused', async () => {
    const { g, writes } = make({ answer: m => (m.type === 'role.write' ? { type: 'definition.result', rid: m.rid } : undefined) });
    const auth = await enroll(g);
    const body = roleWrite();
    const ch = await prepare(g, body);
    const assertion = auth.get(rp, ch.challenge, { counter: 1 });
    const [op1, op2] = [randomUUID(), randomUUID()];
    g.send('dev1', { ...body, op: op1, assertion });
    await settled(g, op1);
    g.send('dev1', { ...body, op: op2, assertion });
    await settled(g, op2);
    expect(finals(g).map(r => r.status === 'rejected' ? r.reason : r.status)).toEqual(['applied', 'assertion_invalid']);
    expect(writes()).toHaveLength(1);
  });

  it('the daemon\'s refusals come back as rejected changed / exists / unknown_project / invalid, a missing file as failed', async () => {
    const codes = ['changed', 'exists', 'unknown_project', 'invalid', 'missing'] as const;
    let i = 0;
    const { g } = make({ answer: m => (m.type === 'role.write' ? { type: 'definition.result', rid: m.rid, code: codes[i++]!, reason: 'because' } : undefined) });
    const auth = await enroll(g);
    const seen: Array<[string, string | undefined]> = [];
    for (let k = 0; k < codes.length; k++) {
      await confirmed(g, auth, roleWrite({ role: draft(`prompt ${k}`) }), k + 1);
      const r = last(g);
      seen.push([r!.status, r!.reason]);
    }
    expect(seen).toEqual([['rejected', 'changed'], ['rejected', 'exists'], ['rejected', 'unknown_project'], ['rejected', 'invalid'], ['failed', undefined]]);
  });

  it('a write the daemon never answers is failed, not applied', async () => {
    const { g } = make();
    const auth = await enroll(g);
    await confirmed(g, auth, roleWrite());
    expect(last(g)).toMatchObject({ status: 'failed' });
  });

  it.each([
    ['role.write', { type: 'role.write', scope: 'repo', project: 'Nope', role: draft(), base: null }],
    ['role.delete', { type: 'role.delete', scope: 'repo', project: 'Nope', id: 'lead', base: HASH }],
    ['template.write', { type: 'template.write', scope: 'repo', project: 'Nope', name: 'Duo', seats: SEATS, base: null }],
    ['template.delete', { type: 'template.delete', scope: 'repo', project: 'Nope', id: 'duo', base: HASH }],
    ['team.launch', { type: 'team.launch', project: 'Nope', name: 'Duo', seats: SEATS }]
  ] as const)('%s on an unknown project is rejected unknown_project before any dispatch (Review Focus 5)', async (_t, body) => {
    const { g, writes } = make();
    const auth = await enroll(g);
    const op = await confirmed(g, auth, body);
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'unknown_project' });
    expect(writes()).toEqual([]);
  });

  it('team.launch carries the project id and no folder; team.launched is applied, team.failed failed', async () => {
    let n = 0;
    const { g, writes } = make({ answer: m => (m.type === 'team.launch' ? (n++ === 0 ? { type: 'team.launched', rid: m.rid, team: { id: 'team-a1b2', name: 'Duo', project: 'p-repo', machine: 'local', cwd: '/w', state: 'active', seats: [], createdAt: T0, updatedAt: T0 } } : { type: 'team.failed', rid: m.rid, reason: 'no' }) : undefined) });
    const auth = await enroll(g);
    const body = { type: 'team.launch' as const, project: 'Repo', name: 'Duo', seats: SEATS, template: 'duo' };
    const op = await confirmed(g, auth, body);
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(writes()).toEqual([{ type: 'team.launch', rid: op, project: 'p-repo', name: 'Duo', seats: SEATS, template: 'duo' }]);
    await confirmed(g, auth, { ...body, name: 'Duo 2' }, 2);
    expect(last(g)).toMatchObject({ status: 'failed' });
  });

  it('team.compose and team.seat use the team purpose; team.changed is applied, with a reason failed', async () => {
    let n = 0;
    const { g, writes } = make({ answer: m => (m.type === 'team.compose' || m.type === 'team.seat' ? { type: 'team.changed', rid: m.rid, ...(n++ === 1 ? { reason: 'a seat did not start' } : {}) } : undefined) });
    const auth = await enroll(g);
    const op1 = await confirmed(g, auth, { type: 'team.compose', team: 'team-a1b2', seats: SEATS });
    const op2 = await confirmed(g, auth, { type: 'team.seat', team: 'team-a1b2', role: 'qa', action: 'start' }, 2);
    expect(finals(g).map(r => [r.op, r.status])).toEqual([[op1, 'applied'], [op2, 'failed']]);
    expect(writes()).toEqual([{ type: 'team.compose', rid: op1, team: 'team-a1b2', seats: SEATS }, { type: 'team.seat', rid: op2, team: 'team-a1b2', role: 'qa', action: 'start' }]);
  });

  it('team.dissolve is relayed as is: silence is applied, a daemon error is failed', async () => {
    let n = 0;
    const { g, writes } = make({ answer: m => (m.type === 'team.dissolve' && n++ === 1 ? { type: 'error', message: 'aucune équipe', request: 'team.dissolve' } : undefined) });
    const auth = await enroll(g);
    const op = await confirmed(g, auth, { type: 'team.dissolve', team: 'team-a1b2' });
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'applied' });
    await confirmed(g, auth, { type: 'team.dissolve', team: 'team-c3d4' }, 2);
    expect(last(g)).toMatchObject({ status: 'failed' });
    expect(writes()).toEqual([{ type: 'team.dissolve', team: 'team-a1b2' }, { type: 'team.dissolve', team: 'team-c3d4' }]);
  });

  it('the same op id sent twice runs once; with other content it is a conflict, not the old result', async () => {
    const { g, writes } = make({ answer: m => (m.type === 'role.write' ? { type: 'definition.result', rid: m.rid } : undefined) });
    const auth = await enroll(g);
    const body = roleWrite({ role: draft('first') });
    const ch = await prepare(g, body);
    const op = randomUUID();
    const signed = { ...body, op, assertion: auth.get(rp, ch.challenge, { counter: 1 }) };
    g.send('dev1', signed);
    await settled(g, op);
    g.send('dev1', signed);
    await flush();
    expect(finals(g).map(r => r.status)).toEqual(['applied', 'applied']);
    expect(writes()).toHaveLength(1);
    // Same id, a different role prompt (with a valid assertion of its own): a conflict, the daemon is not asked.
    const other = roleWrite({ role: draft('second') });
    const ch2 = await prepare(g, other);
    g.send('dev1', { ...other, op, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) });
    await settled(g, op);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'conflict' });
    expect(writes()).toHaveLength(1);
  });

  it('a schema-refused operation (an unknown key, a bad team id, a repo scope without a project, a home scope with one) is answered operation.result invalid', async () => {
    const { g, writes } = make();
    g.send('dev1', { ...roleWrite(), op: randomUUID(), extra: 1 });
    g.send('dev1', { type: 'team.dissolve', team: 'nope', op: randomUUID() });
    g.send('dev1', { type: 'role.write', scope: 'repo', role: draft(), base: null, op: randomUUID() });
    g.send('dev1', { type: 'role.write', scope: 'home', project: 'Repo', role: draft(), base: null, op: randomUUID() });
    await flush();
    expect(g.results('dev1').map(r => [r.status, r.reason])).toEqual(Array(4).fill(['rejected', 'invalid']));
    expect(writes()).toEqual([]);
  });

  it('a message the digest refuses is rejected invalid, never a crash', async () => {
    const ops = createTeamsOps({
      dispatch: async () => { throw new Error('must not be reached'); }, projectByName: () => 'p', projectName: () => 'P', log: () => {}, push: () => {},
      checkAssertion: () => { throw new Error('must not be reached'); }, ask: async () => { throw new Error('must not be reached'); }
    });
    expect(await ops.run('dev1', { type: 'role.write', op: randomUUID(), scope: 'home', role: draft(), base: null, unexpected: 1 } as never)).toEqual({ status: 'rejected', reason: 'invalid' });
  });
});

describe('phone gateway: teams push', () => {
  it('teams carry createdAt, the template, and each seat\'s tool / model / effort / leaving', async () => {
    const team: Team = { id: 'team-a1b2', name: 'Duo', template: 'duo', project: 'p-repo', machine: 'local', cwd: '/w/repo', state: 'active', createdAt: T0, updatedAt: T0,
      seats: [{ role: 'lead', sessionId: 'a', tool: 'claude', model: 'opus', effort: 'high' }, { role: 'qa', sessionId: 'b', leaving: true }] };
    const { g } = make({ teams: () => [team] });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const m = g.got('dev1').find(x => x.type === 'teams');
    expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    expect(m).toMatchObject({ teams: [{ id: 'team-a1b2', template: 'duo', createdAt: T0, project: 'Repo',
      seats: [{ role: 'lead', sessionId: 'a', tool: 'claude', model: 'opus', effort: 'high' }, { role: 'qa', sessionId: 'b', leaving: true }] }] });
    expect(JSON.stringify(m)).not.toContain('/w/repo');
  });
});
