import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneServerMessageSchema, teamsDigest, teamsPurpose, type ClientMessage, type ServerMessage, type Team, type TeamsOperation } from '@ledge/protocol';
import { CATALOG_BUDGET, problemReason, toPhoneCatalog } from '../src/mobile/project.js';
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

/** Waits (up to 2 s) for a condition the gateway reaches asynchronously: a count of results, not a number of ticks. */
const until = async (done: () => boolean) => { for (let i = 0; i < 400 && !done(); i++) await new Promise(r => setTimeout(r, 5)); };

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
    expect(m.catalog.problems.map(p => p.reason)).toEqual(['fichier illisible', 'fichier illisible']);
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

  it('the snapshot says the PC serves the catalog only when it does: daemon.teams', async () => {
    const daemonOf = async (g: ReturnType<typeof setup>) => {
      g.send('dev1', { type: 'snapshot.request' });
      await flush();
      const snap = g.got('dev1').find(x => x.type === 'snapshot');
      return snap?.type === 'snapshot' ? snap.daemon : undefined;
    };
    expect(await daemonOf(make().g)).toMatchObject({ teams: true });
    expect(await daemonOf(setup({ dispatch: async () => {} }))).not.toHaveProperty('teams');
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

describe('phone gateway: teams.role past the catalog cut', () => {
  it('reads a role the catalog dropped for its 200-entry cap, whole and with its flags', async () => {
    const roles = Array.from({ length: 230 }, (_, i) => role(`r${i}`, 'home', { prompt: `prompt of r${i}` }));
    const listed = listing([]);
    listed.scopes[0] = { ...listed.scopes[0]!, roles };
    const { g } = make({ listed });
    expect(toPhoneCatalog(listed, id => (id === 'p-repo' ? 'Repo' : null)).roles.some(r => r.id === 'r229')).toBe(false);
    g.send('dev1', { type: 'teams.role', scope: 'home', id: 'r229' });
    await flush();
    const got = g.got('dev1');
    expect(got).toHaveLength(1);
    expect(PhoneServerMessageSchema.safeParse(got[0]).success).toBe(true);
    expect(got[0]).toMatchObject({ type: 'teams.role', role: { id: 'r229', scope: 'home', project: null, prompt: 'prompt of r229' } });
  });

  it('reads a role the byte budget dropped from a repository scope, and still refuses an id that is nowhere', async () => {
    const roles = Array.from({ length: 60 }, (_, i) => role(`r${i}`, 'repo', { prompt: '日'.repeat(2000) }));
    const listed = listing([]);
    listed.scopes[1] = { ...listed.scopes[1]!, roles };
    const { g } = make({ listed });
    g.send('dev1', { type: 'teams.role', scope: 'repo', project: 'Repo', id: 'r59' });
    g.send('dev1', { type: 'teams.role', scope: 'repo', project: 'Repo', id: 'nope' });
    await flush();
    const got = g.got('dev1');
    expect(got.find(m => m.type === 'teams.role')).toMatchObject({ role: { id: 'r59', scope: 'repo', project: 'Repo', prompt: '日'.repeat(2000) } });
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', code: 'invalid', request: 'teams.role' }]);
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

  it('echoes the digest of a define/team prepare in its challenge, and none for a purpose without one', async () => {
    const { g } = make();
    await enroll(g);
    g.send('dev1', { type: 'confirm.prepare', purpose: 'team', digest: 'a'.repeat(64) });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'define', digest: 'b'.repeat(64) });
    await flush();
    const challenges = g.got('dev1').filter(m => m.type === 'confirm.challenge');
    expect(challenges.slice(-2).map(m => m.type === 'confirm.challenge' && [m.purpose, m.digest])).toEqual([['team', 'a'.repeat(64)], ['define', 'b'.repeat(64)]]);
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'confirm.challenge').at(-1)).not.toHaveProperty('digest');
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

  it('a compose that was saved but whose new seat did not start is applied with seat_failed; a seat start that failed stays failed', async () => {
    const team: Team = { id: 'team-a1b2', name: 'Duo', project: 'p-repo', machine: 'local', cwd: '/w', state: 'active', seats: [{ role: 'lead', sessionId: 'a' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0 };
    const { g } = make({ answer: m => (m.type === 'team.compose' || m.type === 'team.seat' ? { type: 'team.changed', rid: m.rid, team, reason: '@qa : spawn failed' } : undefined) });
    const auth = await enroll(g);
    const op1 = await confirmed(g, auth, { type: 'team.compose', team: 'team-a1b2', seats: SEATS });
    const op2 = await confirmed(g, auth, { type: 'team.seat', team: 'team-a1b2', role: 'qa', action: 'start' }, 2);
    expect(finals(g)).toEqual([{ type: 'operation.result', op: op1, status: 'applied', reason: 'seat_failed' }, { type: 'operation.result', op: op2, status: 'failed' }]);
    for (const r of finals(g)) expect(PhoneServerMessageSchema.safeParse(r).success).toBe(true);
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
    await until(() => finals(g).length >= 2);
    expect(finals(g).map(r => r.status)).toEqual(['applied', 'applied']);
    expect(writes()).toHaveLength(1);
    // Same id, a different role prompt (with a valid assertion of its own): a conflict, the daemon is not asked.
    const other = roleWrite({ role: draft('second') });
    const ch2 = await prepare(g, other);
    g.send('dev1', { ...other, op, assertion: auth.get(rp, ch2.challenge, { counter: 2 }) });
    await until(() => finals(g).length >= 3);
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

  it('a repo scope without a project, or a home scope with one, is rejected invalid before the digest and any dispatch', async () => {
    const fail = () => { throw new Error('must not be reached'); };
    const ops = createTeamsOps({ dispatch: async () => fail(), projectByName: () => 'p', projectName: () => 'P', log: () => {}, push: () => {}, checkAssertion: fail, ask: async () => fail() });
    const bad = [
      { type: 'role.write', scope: 'repo', role: draft(), base: null },
      { type: 'role.write', scope: 'home', project: 'Repo', role: draft(), base: null },
      { type: 'role.delete', scope: 'repo', id: 'lead', base: HASH },
      { type: 'template.write', scope: 'home', project: 'Repo', name: 'Duo', seats: SEATS, base: null },
      { type: 'template.delete', scope: 'repo', id: 'duo', base: HASH }
    ];
    for (const b of bad) expect(await ops.run('dev1', { ...b, op: randomUUID() } as never)).toEqual({ status: 'rejected', reason: 'invalid' });
  });

  it('a message the digest refuses is rejected invalid, never a crash', async () => {
    const ops = createTeamsOps({
      dispatch: async () => { throw new Error('must not be reached'); }, projectByName: () => 'p', projectName: () => 'P', log: () => {}, push: () => {},
      checkAssertion: () => { throw new Error('must not be reached'); }, ask: async () => { throw new Error('must not be reached'); }
    });
    expect(await ops.run('dev1', { type: 'role.write', op: randomUUID(), scope: 'home', role: draft(), base: null, unexpected: 1 } as never)).toEqual({ status: 'rejected', reason: 'invalid' });
  });
});

describe('phone catalog: problems, shadowing, budget', () => {
  const home = (roles: ReturnType<typeof role>[], problems: { path: string; reason: string }[] = [], templates: Listing['scopes'][number]['templates'] = []): Listing => ({ type: 'definitions.listing', scopes: [{ scope: 'home', project: null, roles, templates, problems }] });
  const names = (id: string | null) => (id === 'p-repo' ? 'Repo' : null);

  it('a problem\'s reason is a fixed phrase: no path of any form, none of the daemon\'s text, reaches the phone', () => {
    const raw = ['~/.ledge/roles/x.md', './a/b', 'C:\\Users\\John Smith\\.ledge\\roles\\x.md', '/work', 'ENOENT: no such file or directory, open \'/home/me/.ledge/roles/x.md\''];
    const wrapped = [...raw.flatMap(p => [p, `cannot read ${p}`, `unknown key ${p}`, `line without a key: ${p}`, `name: ${p}`, `seats: ${p}`, `label: ${p}`])];
    const l = home([], wrapped.map((reason, i) => ({ path: `${HOME}/roles/p${i}.md`, reason })));
    const c = toPhoneCatalog(l, names);
    const known = new Set(['fichier illisible', 'fichier trop volumineux', 'consigne trop longue', 'clé inconnue dans l\'en-tête', 'syntaxe illisible', 'nom d\'équipe invalide', 'sièges invalides', 'champ de rôle invalide']);
    for (const p of c.problems) {
      expect(known.has(p.reason)).toBe(true);
      for (const bad of ['/', '\\', '~', 'John', 'Smith', 'ENOENT', 'work', '.ledge']) expect(p.reason).not.toContain(bad);
      expect(p.file).not.toMatch(/[\\/~]/);
    }
    expect(c.problems.length).toBeGreaterThan(0);
  });

  it('each kind of reason our own code produces maps to its phrase; anything else is « fichier illisible »', () => {
    expect(problemReason('file over 64 KB')).toBe('fichier trop volumineux');
    expect(problemReason('prompt over 8000 characters')).toBe('consigne trop longue');
    expect(problemReason('unknown key foo')).toBe('clé inconnue dans l\'en-tête');
    expect(problemReason('front matter line without a key: abc')).toBe('syntaxe illisible');
    expect(problemReason('tabs are not allowed in YAML')).toBe('syntaxe illisible');
    expect(problemReason('name: a name of 1 to 60 characters')).toBe('nom d\'équipe invalide');
    expect(problemReason('seats.0.role: Invalid')).toBe('sièges invalides');
    expect(problemReason('tool: Invalid enum value')).toBe('champ de rôle invalide');
    expect(problemReason('EACCES: permission denied, open \'/x/y\'')).toBe('fichier illisible');
    expect(problemReason('')).toBe('fichier illisible');
  });

  it('shadows / shadowed only count the scopes sent to the phone: a project it has no name for shadows nothing', () => {
    const l: Listing = { type: 'definitions.listing', scopes: [
      { scope: 'home', project: null, roles: [role('qa', 'home'), role('lead', 'home')], templates: [], problems: [] },
      { scope: 'repo', project: 'p-unknown', roles: [role('qa', 'repo')], templates: [], problems: [] },
      { scope: 'repo', project: 'p-repo', roles: [role('lead', 'repo')], templates: [], problems: [] }
    ] };
    const c = toPhoneCatalog(l, names);
    const get = (id: string, sc: string) => c.roles.find(r => r.id === id && r.scope === sc);
    expect(get('qa', 'home')).not.toHaveProperty('shadowed');
    expect(get('qa', 'repo')).toBeUndefined();
    expect(get('lead', 'home')).toMatchObject({ shadowed: true });
    expect(get('lead', 'repo')).toMatchObject({ shadows: true });
  });

  it('a home role says which projects hide it: shadowedIn names each, once', () => {
    const l: Listing = { type: 'definitions.listing', scopes: [
      { scope: 'home', project: null, roles: [role('lead', 'home'), role('qa', 'home')], templates: [], problems: [] },
      { scope: 'repo', project: 'p-repo', roles: [role('lead', 'repo')], templates: [], problems: [] },
      { scope: 'repo', project: 'p-other', roles: [role('lead', 'repo')], templates: [], problems: [] }
    ] };
    const c = toPhoneCatalog(l, id => (id === 'p-repo' ? 'Repo' : id === 'p-other' ? 'Autre' : null));
    const get = (id: string, sc: string) => c.roles.find(r => r.id === id && r.scope === sc);
    expect(get('lead', 'home')).toMatchObject({ shadowed: true, shadowedIn: ['Repo', 'Autre'] });
    expect(get('qa', 'home')).not.toHaveProperty('shadowedIn');
    expect(get('lead', 'repo')).not.toHaveProperty('shadowedIn');
  });

  it('the budget is in bytes: 60 roles of 8000 multibyte characters stay within CATALOG_BUDGET as encoded', () => {
    const roles = Array.from({ length: 60 }, (_, i) => role(`r${i}`, 'home', { prompt: '日'.repeat(8000) }));
    const c = toPhoneCatalog(home(roles), names);
    expect(Buffer.byteLength(JSON.stringify(c), 'utf8')).toBeLessThanOrEqual(CATALOG_BUDGET);
    expect(c.roles.some(r => r.cut === true)).toBe(true);
    expect(c.roles.some(r => r.prompt.length === 8000)).toBe(true);
    // 8000 characters of 3 bytes is more than 262144 / 60 bytes each: a count of characters alone would have let it through.
    expect(JSON.stringify(c).length).toBeLessThan(Buffer.byteLength(JSON.stringify(c), 'utf8'));
  });

  it('when even every prompt cut is over the budget, the frame still fits: prompts go, then the last templates', () => {
    const seats = Array.from({ length: 8 }, (_, i) => ({ role: `r${i}`, model: 'm'.repeat(200), name: '日'.repeat(40) }));
    const templates = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, seats, source: 'home' as const, path: `${HOME}/teams/t${i}.yaml`, hash: HASH }));
    const roles = Array.from({ length: 200 }, (_, i) => role(`r${i}`, 'home', { prompt: '日'.repeat(500) }));
    const full = toPhoneCatalog(home([], [], templates), names);
    expect(Buffer.byteLength(JSON.stringify(full), 'utf8')).toBeLessThanOrEqual(CATALOG_BUDGET);
    expect(full.templates.length).toBeLessThan(100);
    const c = toPhoneCatalog(home(roles, [], templates), names);
    expect(Buffer.byteLength(JSON.stringify(c), 'utf8')).toBeLessThanOrEqual(CATALOG_BUDGET);
    expect(PhoneServerMessageSchema.safeParse({ type: 'teams.catalog', catalog: c }).success).toBe(true);
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

describe('phone gateway: a composition\'s seat models (#58)', () => {
  it('compose outcome carries seat models', async () => {
    const team: Team = { id: 'team-a1b2', name: 'Duo', project: 'p-repo', machine: 'local', cwd: '/w', state: 'active', seats: [{ role: 'lead', sessionId: 'a' }, { role: 'qa', sessionId: 'b' }, { role: 'ops', sessionId: 'c' }], createdAt: T0, updatedAt: T0 };
    const models = [{ role: 'lead', session: 'a', when: 'now' as const }, { role: 'qa', session: 'b', when: 'turn' as const }, { role: 'ops', session: 'c', code: 'not_launched' as const }];
    const { g, writes } = make({ answer: m => (m.type === 'team.compose' ? { type: 'team.changed', rid: m.rid, team, models } : undefined) });
    const auth = await enroll(g);
    const body = { type: 'team.compose' as const, team: 'team-a1b2', seats: SEATS };
    const ch = await prepare(g, body);
    const op = randomUUID();
    const signed = { ...body, op, assertion: auth.get(rp, ch.challenge, { counter: 1 }) };
    g.send('dev1', signed);
    await settled(g, op);
    const seats = [{ role: 'lead', session: 'a', status: 'applied' }, { role: 'qa', session: 'b', status: 'scheduled' }, { role: 'ops', session: 'c', status: 'refused', reason: 'not_launched' }];
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'applied', models: seats });
    expect(PhoneServerMessageSchema.safeParse(last(g)).success).toBe(true);
    // Sent again (a reconnect): the stored outcome, its seats with it; the daemon is not asked twice.
    g.send('dev1', signed);
    await until(() => finals(g).length >= 2);
    expect(finals(g).at(-1)).toEqual({ type: 'operation.result', op, status: 'applied', models: seats });
    expect(writes()).toHaveLength(1);
  });

  it('a compose saved with a seat that did not start keeps seat_failed and its seat models', async () => {
    const team: Team = { id: 'team-a1b2', name: 'Duo', project: 'p-repo', machine: 'local', cwd: '/w', state: 'active', seats: [{ role: 'lead', sessionId: 'a' }, { role: 'qa', sessionId: null }], createdAt: T0, updatedAt: T0 };
    const { g } = make({ answer: m => (m.type === 'team.compose' ? { type: 'team.changed', rid: m.rid, team, reason: '@qa : spawn failed', models: [{ role: 'lead', session: 'a', when: 'turn' }] } : undefined) });
    const auth = await enroll(g);
    const op = await confirmed(g, auth, { type: 'team.compose', team: 'team-a1b2', seats: SEATS });
    expect(last(g)).toEqual({ type: 'operation.result', op, status: 'applied', reason: 'seat_failed', models: [{ role: 'lead', session: 'a', status: 'scheduled' }] });
  });
});
