import { describe, it, expect } from 'vitest';
import { TaskSchema, TeamTemplateSchema, RoleSchema, RolesListingSchema, TeamSchema, ClientMessageSchema, ServerMessageSchema, parseClientMessage, parseServerMessage, TEAM_ADDRESS } from '../src/index.js';

const role = { id: 'review', label: 'Relecteur', prompt: 'Tu relis.', source: 'repo', path: '/r/.ledge/roles/review.md' };

describe('roles', () => {
  it('a role may name the home role it shadows; without it, it reads as before', () => {
    expect(RoleSchema.parse({ ...role, shadows: '/h/.ledge/roles/review.md' }).shadows).toBe('/h/.ledge/roles/review.md');
    expect(RoleSchema.parse(role)).not.toHaveProperty('shadows');
    expect(RolesListingSchema.parse({ type: 'roles.listing', roles: [role], problems: [] }).roles[0]).toEqual(role);
  });
});

describe('team definitions from any client', () => {
  const draft = { id: 'dev', label: 'Dev', prompt: 'Tu codes.' };
  const seats = [{ role: 'dev' }, { role: 'review' }];
  const rw = { type: 'role.write', rid: 'r1', scope: 'home', role: draft, base: null };
  const team = { id: 'team-abcd', name: 'T', project: null, machine: 'local', cwd: '/r', state: 'active', seats: [{ role: 'dev', sessionId: 's1' }], createdAt: 'a', updatedAt: 'a' };
  const ok = (m: unknown) => ClientMessageSchema.safeParse(m).success;

  it('role.write parses at home, and needs project exactly for repo', () => {
    expect(ok(rw)).toBe(true);
    expect(ok({ ...rw, scope: 'repo' })).toBe(false);
    expect(ok({ ...rw, scope: 'repo', project: 'ledge' })).toBe(true);
    expect(ok({ ...rw, project: 'ledge' })).toBe(false);
  });
  it('role.write refuses a too long prompt and a bad id', () => {
    expect(ok({ ...rw, role: { ...draft, prompt: 'x'.repeat(8001) } })).toBe(false);
    expect(ok({ ...rw, role: { ...draft, prompt: 'x'.repeat(8000) } })).toBe(true);
    expect(ok({ ...rw, role: { ...draft, id: 'Dev' } })).toBe(false);
  });
  it('template.write refuses 9 seats and a role twice', () => {
    const tw = { type: 'template.write', rid: 'r1', scope: 'home', name: 'T', seats, base: null };
    expect(ok(tw)).toBe(true);
    expect(ok({ ...tw, seats: Array.from({ length: 9 }, (_, i) => ({ role: `r${i}` })) })).toBe(false);
    expect(ok({ ...tw, seats: [{ role: 'dev' }, { role: 'dev' }] })).toBe(false);
  });
  it('template ids are file names: no path gets through, and the scope rule holds here too', () => {
    const td = { type: 'template.delete', rid: 'r', scope: 'home', id: 'duo', base: '0123456789abcdef' };
    expect(ok(td)).toBe(true);
    for (const id of ['../x', 'a/b', '.hidden', '..']) {
      expect(ok({ ...td, id })).toBe(false);
      expect(ok({ type: 'template.write', rid: 'r', scope: 'home', id, name: 'T', seats, base: null })).toBe(false);
    }
    // Launch only looks the id up among the listed templates: a file named `my.team.yaml` stays launchable.
    expect(ok({ type: 'team.launch', rid: 'r', cwd: '/r', template: 'my.team' })).toBe(true);
    expect(ok({ type: 'template.write', rid: 'r', scope: 'repo', name: 'T', seats, base: null })).toBe(false);
    expect(ok({ type: 'template.write', rid: 'r', scope: 'repo', project: 'ledge', name: 'T', seats, base: null })).toBe(true);
  });
  it('a base is a file hash, or null to create', () => {
    expect(ok({ ...rw, base: 'xyz' })).toBe(false);
    expect(ok({ type: 'role.delete', rid: 'r', scope: 'home', id: 'dev', base: 'xyz' })).toBe(false);
    expect(ok({ ...rw, base: '0123456789abcdef' })).toBe(true);
  });
  it('team.seat takes start or restart only', () => {
    const ts = { type: 'team.seat', rid: 'r1', team: 'team-abcd', role: 'dev' };
    expect(ok({ ...ts, action: 'restart' })).toBe(true);
    expect(ok({ ...ts, action: 'stop' })).toBe(false);
  });
  it('a team seat may carry its overrides and leaving; an older seat still parses', () => {
    expect(TeamSchema.parse({ ...team, seats: [{ role: 'dev', sessionId: 's1', model: 'opus', leaving: true }] }).seats[0]).toMatchObject({ model: 'opus', leaving: true });
    expect(TeamSchema.parse(team).seats[0]).toEqual({ role: 'dev', sessionId: 's1' });
    expect(TeamSchema.safeParse({ ...team, seats: [{ role: 'dev', sessionId: 's1', leaving: false }] }).success).toBe(false);
  });
  it('the hash is optional on roles and templates', () => {
    const r = { id: 'dev', label: 'D', prompt: '', source: 'home', path: '/p' };
    expect(RoleSchema.parse({ ...r, hash: '0123456789abcdef' }).hash).toBe('0123456789abcdef');
    expect(RoleSchema.safeParse({ ...r, hash: 'xyz' }).success).toBe(false);
    expect(RoleSchema.parse(r)).not.toHaveProperty('hash');
  });
  it('parseClientMessage accepts each new message', () => {
    for (const m of [
      { type: 'definitions.list' }, { type: 'definitions.list', requestId: 'q' }, rw,
      { type: 'role.delete', rid: 'r', scope: 'repo', project: 'ledge', id: 'dev', base: '0123456789abcdef' },
      { type: 'template.write', rid: 'r', scope: 'home', id: 'duo', name: 'Duo', seats, base: '0123456789abcdef' },
      { type: 'template.delete', rid: 'r', scope: 'home', id: 'duo', base: '0123456789abcdef' },
      { type: 'team.compose', rid: 'r', team: 'team-abcd', seats },
      { type: 'team.seat', rid: 'r', team: 'team-abcd', role: 'dev', action: 'start' },
      { type: 'team.launch', rid: 'r', template: 'duo', project: 'ledge' }
    ]) expect(parseClientMessage(m)).toMatchObject({ type: m.type });
    expect(() => parseClientMessage({ ...rw, scope: 'repo' })).toThrow();
  });
  it('the new server messages parse', () => {
    const scope = { scope: 'repo', project: 'ledge', roles: [], templates: [], problems: [{ path: '/p', reason: 'bad' }] };
    for (const m of [
      { type: 'definitions.listing', requestId: 'q', scopes: [scope, { ...scope, scope: 'home', project: null }] },
      { type: 'definition.result', rid: 'r', id: 'dev', hash: '0123456789abcdef' },
      { type: 'definition.result', rid: 'r', code: 'changed', reason: 'le fichier a changé sur le PC' },
      { type: 'team.changed', rid: 'r', team }, { type: 'team.changed', rid: 'r', reason: 'no' }
    ]) expect(ServerMessageSchema.safeParse(m).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'definition.result', rid: 'r', code: 'nope' }).success).toBe(false);
  });
});

describe('team.changed models', () => {
  const entry = (n: number) => Array.from({ length: n }, () => ({ role: 'r', session: 's', when: 'now' }));
  it('carries the model outcome of each seat, at most 16', () => {
    for (const models of [[{ role: 'leader', session: 's1', when: 'now' }], [{ role: 'r', session: 's2', code: 'not_launched' }], entry(16)])
      expect(ServerMessageSchema.safeParse({ type: 'team.changed', rid: 'r', models }).success).toBe(true);
    expect(ServerMessageSchema.safeParse({ type: 'team.changed', rid: 'r', models: entry(17) }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'team.changed', rid: 'r', models: [{ role: 'r', session: 's', code: 'boom' }] }).success).toBe(false);
  });
});

describe('a team\'s objective on the wire', () => {
  const task = { id: 't1a2b3c', title: 'Objectif', giver: 'otto', giverName: 'Otto', owner: 'pim', ownerName: 'Pim', state: 'taken', seen: false, at: 'a', updatedAt: 'a', log: [] };
  const team = { id: 'team-abcd', name: 'T', project: null, machine: 'local', cwd: '/r', state: 'active', seats: [{ role: 'dev', sessionId: 's1' }], createdAt: 'a', updatedAt: 'a' };
  it('team.launch carries an optional objective, and still parses without one', () => {
    expect(parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api', objective: { goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' } }))
      .toMatchObject({ objective: { goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' } });
    expect(parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api' })).not.toHaveProperty('objective');
    expect(() => parseClientMessage({ type: 'team.launch', rid: 'r', template: 'api', objective: { goal: '  ' } })).toThrow();
  });
  it('a task may be the objective, a team names its objective task', () => {
    expect(TaskSchema.parse({ ...task, objective: true }).objective).toBe(true);
    expect(TeamSchema.parse({ ...team, objectiveTask: 't1a2b3c' }).objectiveTask).toBe('t1a2b3c');
  });
  it('a team template without a leader seat still parses on the wire (the rule is the loader\'s)', () => {
    expect(TeamTemplateSchema.safeParse({ id: 'x', name: 'x', seats: [{ role: 'dev' }], source: 'home', path: '/p' }).success).toBe(true);
  });
});

describe('team broadcast', () => {
  it('parses a team.broadcast and refuses a blank text', () => {
    expect(TEAM_ADDRESS).toBe('@team');
    expect(parseClientMessage({ type: 'team.broadcast', rid: 'r', team: 'team-ab12', text: 'Pause' })).toMatchObject({ type: 'team.broadcast', text: 'Pause' });
    expect(() => parseClientMessage({ type: 'team.broadcast', rid: 'r', team: 'team-ab12', text: '   ' })).toThrow();
  });
  it('message.ack keeps recipients, and is unchanged without', () => {
    expect(parseServerMessage({ type: 'message.ack', rid: 'r', outcome: 'accepted', recipients: 2 })).toMatchObject({ recipients: 2 });
    expect(parseServerMessage({ type: 'message.ack', rid: 'r', outcome: 'accepted' })).toEqual({ type: 'message.ack', rid: 'r', outcome: 'accepted' });
  });
  it('parses a team.broadcast.result', () => {
    expect(parseServerMessage({ type: 'team.broadcast.result', rid: 'r', team: 'team-ab12', sent: 3 })).toMatchObject({ sent: 3 });
  });
});
