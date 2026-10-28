import { describe, it, expect } from 'vitest';
import { PhoneCatalogSchema, PhoneClientMessageSchema, PhoneServerMessageSchema, canonicalJson, teamsDigest, teamsPurpose, type TeamsOperation } from '../src/index.js';

const OP = '11111111-1111-4111-8111-111111111111';
const OP2 = '22222222-2222-4222-8222-222222222222';
const assertion = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const draft = { id: 'dev', label: 'Dev', prompt: 'Tu codes.' };
const hash = 'a'.repeat(16);
const seats = [{ role: 'dev' }, { role: 'review' }];
const roleWrite = { type: 'role.write', op: OP, scope: 'home', role: draft, base: null } as const;
const ok = (m: unknown) => PhoneClientMessageSchema.safeParse(m).success;

describe('teamsDigest', () => {
  const digest = (m: unknown) => teamsDigest(m as TeamsOperation);
  const base = { type: 'template.write', op: OP, scope: 'repo', project: 'ledge', id: 'duo', name: 'Duo', seats: [{ role: 'dev', tool: 'claude', model: 'm1', effort: 'low' }, { role: 'review' }], base: hash } as const;
  it('ignores key order, op and assertion', async () => {
    const reordered = { base: null, role: { prompt: 'Tu codes.', label: 'Dev', id: 'dev' }, scope: 'home', op: OP2, type: 'role.write', assertion };
    expect(await digest(reordered)).toBe(await digest(roleWrite));
    expect(await digest(roleWrite)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ignores undefined fields, and an op left out', async () => {
    expect(await digest({ ...roleWrite, project: undefined })).toBe(await digest(roleWrite));
    const { op: _op, ...noOp } = roleWrite;
    expect(await digest(noOp)).toBe(await digest(roleWrite));
  });
  it('hashes the parsed form: a padded name equals the trimmed one', async () => {
    expect(await digest({ ...base, name: ' Duo ' })).toBe(await digest(base));
    const parsed = PhoneClientMessageSchema.parse({ ...base, name: ' Duo ' });
    expect(await digest(parsed)).toBe(await digest(base));
  });
  it('refuses to hash what the phone boundary refuses, instead of dropping the extra key', async () => {
    await expect(digest({ ...roleWrite, role: { ...draft, path: '/x' } })).rejects.toThrow();
  });
  const changes: [string, (m: any) => unknown][] = [
    ['seat tool', m => ({ ...m, seats: [{ ...m.seats[0], tool: 'codex' }, m.seats[1]] })],
    ['seat model', m => ({ ...m, seats: [{ ...m.seats[0], model: 'm2' }, m.seats[1]] })],
    ['seat effort', m => ({ ...m, seats: [{ ...m.seats[0], effort: 'high' }, m.seats[1]] })],
    ['seat order', m => ({ ...m, seats: [m.seats[1], m.seats[0]] })],
    ['scope', m => ({ ...m, scope: 'home', project: undefined })],
    ['project', m => ({ ...m, project: 'other' })],
    ['name', m => ({ ...m, name: 'Duo2' })],
    ['id', m => ({ ...m, id: 'duo2' })],
    ['base', m => ({ ...m, base: 'b'.repeat(16) })],
    ['type', m => ({ type: 'template.delete', op: m.op, scope: m.scope, project: m.project, id: m.id, base: m.base })]
  ];
  it.each(changes)('changing the %s changes the digest', async (_n, change) => {
    expect(await digest(change(base))).not.toBe(await digest(base));
  });
  const roleChanges: [string, (m: any) => unknown][] = [
    ['role.prompt', m => ({ ...m, role: { ...m.role, prompt: 'Tu codes?' } })],
    ['role.label', m => ({ ...m, role: { ...m.role, label: 'Dev2' } })],
    ['role.id', m => ({ ...m, role: { ...m.role, id: 'dev2' } })],
    ['base', m => ({ ...m, base: hash })],
    ['type', m => ({ type: 'role.delete', op: m.op, scope: m.scope, id: m.role.id, base: hash })]
  ];
  it.each(roleChanges)('changing the %s of a role.write changes the digest', async (_n, change) => {
    expect(await digest(change(roleWrite))).not.toBe(await digest(roleWrite));
  });
  it('tells a role.delete from a template.delete of the same id and base', async () => {
    const del = { op: OP, scope: 'home', id: 'dev', base: hash };
    expect(await digest({ type: 'role.delete', ...del })).not.toBe(await digest({ type: 'template.delete', ...del }));
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth, keeps array order, drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: undefined, x: 2 }], c: 'é' } })).toBe('{"a":{"c":"é","d":[{"x":2,"z":1}]},"b":1}');
  });
});

describe('teamsPurpose', () => {
  it('maps definitions to define and live teams to team', () => {
    expect(teamsPurpose('role.write')).toBe('define');
    expect(teamsPurpose('role.delete')).toBe('define');
    expect(teamsPurpose('template.write')).toBe('define');
    expect(teamsPurpose('template.delete')).toBe('define');
    expect(teamsPurpose('team.launch')).toBe('team');
    expect(teamsPurpose('team.compose')).toBe('team');
    expect(teamsPurpose('team.seat')).toBe('team');
    expect(teamsPurpose('team.dissolve')).toBe('team');
  });
});

describe('phone team operations', () => {
  const ops = [
    roleWrite,
    { type: 'role.delete', op: OP, scope: 'home', id: 'dev', base: hash },
    { type: 'template.write', op: OP, scope: 'repo', project: 'ledge', name: 'Duo', seats, base: null },
    { type: 'template.delete', op: OP, scope: 'home', id: 'duo', base: hash },
    { type: 'team.launch', op: OP, project: 'ledge', name: 'Duo', seats, template: 'duo' },
    { type: 'team.compose', op: OP, team: 'team-abcd', seats },
    { type: 'team.seat', op: OP, team: 'team-abcd', role: 'dev', action: 'start' },
    { type: 'team.dissolve', op: OP, team: 'team-abcd', assertion }
  ];
  it('parses each, with or without an assertion', () => {
    for (const o of ops) { expect(ok(o), o.type).toBe(true); expect(ok({ ...o, assertion }), o.type).toBe(true); }
  });
  it('refuses a cwd or a path on any of them', () => {
    for (const o of ops) { expect(ok({ ...o, cwd: '/r' }), o.type).toBe(false); expect(ok({ ...o, path: '/r' }), o.type).toBe(false); }
  });
  it('refuses an unknown key inside a role or a seat', () => {
    expect(ok({ ...roleWrite, role: { ...draft, path: '/x' } })).toBe(false);
    expect(ok({ ...ops[2], seats: [{ role: 'dev', cwd: '/r' }] })).toBe(false);
    expect(ok({ ...ops[4], seats: [{ role: 'dev', cwd: '/r' }] })).toBe(false);
    expect(ok({ ...ops[5], seats: [{ role: 'dev', path: '/r' }] })).toBe(false);
  });
  it('refuses a team.launch with no seat, and a repo scope without a project', () => {
    expect(ok({ ...ops[4], seats: [] })).toBe(false);
    expect(ok({ ...roleWrite, scope: 'repo' })).toBe(false);
    expect(ok({ ...roleWrite, scope: 'repo', project: 'ledge' })).toBe(true);
    expect(ok({ ...roleWrite, project: 'ledge' })).toBe(false);
  });
  it('refuses a template id that is not a file name, and a bad base', () => {
    expect(ok({ ...ops[3], id: '../x' })).toBe(false);
    expect(ok({ ...ops[1], base: 'xyz' })).toBe(false);
    expect(ok({ ...ops[1], base: null })).toBe(false);
    expect(ok({ ...ops[2], base: 'xyz' })).toBe(false);
  });
  it('still parses the other phone messages', () => {
    expect(ok({ type: 'snapshot.request' })).toBe(true);
    expect(ok({ type: 'teams.catalog' })).toBe(true);
    expect(ok({ type: 'teams.role', scope: 'repo', project: 'ledge', id: 'dev' })).toBe(true);
    expect(ok({ type: 'teams.role', scope: 'repo', id: 'dev' })).toBe(false);
  });
});

describe('confirm.prepare digest', () => {
  const prepare = { type: 'confirm.prepare', purpose: 'define' };
  it('takes a 64 hex digest for the new purposes', () => {
    expect(ok({ ...prepare, digest: 'a'.repeat(64) })).toBe(true);
    expect(ok({ type: 'confirm.prepare', purpose: 'team', digest: 'a'.repeat(64) })).toBe(true);
  });
  it('refuses a 63 character or an uppercase digest', () => {
    expect(ok({ ...prepare, digest: 'a'.repeat(63) })).toBe(false);
    expect(ok({ ...prepare, digest: 'A'.repeat(64) })).toBe(false);
  });
});

describe('catalog', () => {
  const role = { id: 'dev', label: 'Dev', prompt: 'x', scope: 'repo', project: 'ledge', hash };
  const template = { id: 'duo', name: 'Duo', seats, scope: 'home', project: null, hash };
  const problem = { file: 'bad.md', scope: 'home', project: null, reason: 'no front matter' };
  const catalog = { projects: ['ledge'], roles: [role], templates: [template], problems: [problem] };
  it('parses and travels in the two new server messages', () => {
    expect(PhoneCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(PhoneServerMessageSchema.safeParse({ type: 'teams.catalog', catalog }).success).toBe(true);
    expect(PhoneServerMessageSchema.safeParse({ type: 'teams.role', role: { ...role, cut: true, shadows: true } }).success).toBe(true);
  });
  it('refuses a problem with a path, and a role with a cwd', () => {
    expect(PhoneCatalogSchema.safeParse({ ...catalog, problems: [{ ...problem, path: '/x/bad.md' }] }).success).toBe(false);
    expect(PhoneCatalogSchema.safeParse({ ...catalog, roles: [{ ...role, cwd: '/r' }] }).success).toBe(false);
  });
  it('bounds the lists', () => {
    expect(PhoneCatalogSchema.safeParse({ ...catalog, roles: Array(201).fill(role) }).success).toBe(false);
    expect(PhoneCatalogSchema.safeParse({ ...catalog, templates: Array(101).fill(template) }).success).toBe(false);
    expect(PhoneCatalogSchema.safeParse({ ...catalog, problems: Array(51).fill(problem) }).success).toBe(false);
  });
});

describe('phone additions', () => {
  it('knows the new operation reasons and purposes', async () => {
    const { OperationReasonSchema, ConfirmPurposeSchema } = await import('../src/index.js');
    for (const r of ['changed', 'exists', 'unknown_project']) expect(OperationReasonSchema.safeParse(r).success).toBe(true);
    for (const p of ['define', 'team']) expect(ConfirmPurposeSchema.safeParse(p).success).toBe(true);
  });
  it('a phone team carries its createdAt, template and seat launch overrides', async () => {
    const { PhoneTeamSchema } = await import('../src/index.js');
    const t = { id: 'team-abcd', name: 'T', project: 'ledge', state: 'active', seats: [{ role: 'dev', sessionId: null, tool: 'claude', leaving: true }], done: 0, given: 0, createdAt: '2026-10-28T10:00:00.000Z', template: 'duo' };
    expect(PhoneTeamSchema.safeParse(t).success).toBe(true);
    const { createdAt, ...old } = t;
    expect(PhoneTeamSchema.safeParse(old).success).toBe(false);
  });
});
