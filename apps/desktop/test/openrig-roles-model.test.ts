import { describe, expect, it } from 'vitest';
import { appliesOf, formatSize, groupRoles, isMissing, lineDiff, pieceTitle, pieces, profileOf, provOf, roleDocs, rolesBySeat, seatOf } from '../src/openrig/roles/model';
import { initialNav, navReducer } from '../src/nav/state';
import { DEVELOPER, ROLES } from './openrig-roles-fixture';

describe('the Roles view model', () => {
  it('groups the roles, mine then OpenRig, and filters and searches them', () => {
    expect(groupRoles(ROLES, 'all', '')).toMatchObject({ mine: [{ name: 'ledge-developer' }, { name: 'ledge-lead' }, { name: 'shared' }], builtin: [{ name: 'pm' }, { name: 'qa' }] });
    expect(groupRoles(ROLES, 'used', '').mine.map(r => r.name)).toEqual(['ledge-developer', 'ledge-lead']);
    expect(groupRoles(ROLES, 'used', '').builtin).toEqual([]);
    expect(groupRoles(ROLES, 'mine', '').builtin).toEqual([]);
    expect(groupRoles(ROLES, 'builtin', '').mine).toEqual([]);
    // Search covers the name, the summary, the skills and the startup files.
    expect(groupRoles(ROLES, 'all', 'terraform').builtin.map(r => r.name)).toEqual(['pm']);
    expect(groupRoles(ROLES, 'all', 'by effect').builtin.map(r => r.name)).toEqual(['qa']);
    expect(groupRoles(ROLES, 'all', 'role.md').mine.map(r => r.name)).toEqual(['ledge-developer']);
  });
  it('maps each seat to its role, and a provenance to its badge', () => {
    expect(rolesBySeat(ROLES).get('ledge-dev/dev.front')?.name).toBe('ledge-developer');
    expect(rolesBySeat(ROLES).get('ledge-dev/pilot.lead')?.name).toBe('ledge-lead');
    expect([provOf({ kind: 'here' }), provOf({ kind: 'inherited', from: 'import' }), provOf({ kind: 'absent' }), provOf({ kind: 'unknown', why: 'unreadable' })]).toEqual(['here', 'inh', 'abs', 'unk']);
  });
  it('the Role tab: role.md alone from the spec, then the seat’s own file from that seat', () => {
    const p = profileOf(DEVELOPER, undefined);
    expect(roleDocs(DEVELOPER, p, undefined).map(e => e.path)).toEqual(['guidance/role.md']);
    const front = seatOf(DEVELOPER, 'ledge-dev/dev.front')!;
    expect(roleDocs(DEVELOPER, profileOf(DEVELOPER, undefined, front), front).map(e => e.path)).toEqual(['guidance/role.md', 'guidance/scope-front.md']);
    // A role.md declared but missing from the startup still opens first; none at all: nothing to show.
    expect(roleDocs({ ...DEVELOPER, profiles: [{ ...p!, startup: [] }] }, { ...p!, startup: [] }, undefined).map(e => e.path)).toEqual(['guidance/role.md']);
    expect(roleDocs({ ...DEVELOPER, role: null }, { ...p!, startup: [] }, undefined)).toEqual([]);
  });
  it('the startup context: the role’s share from the spec, OpenRig’s order from a seat, the harness first', () => {
    const p = profileOf(DEVELOPER, undefined);
    expect(pieces(DEVELOPER, p, undefined).map(x => (x.kind === 'entry' ? x.entry.path : x.kind))).toEqual(['guidance/role.md']);
    const front = seatOf(DEVELOPER, 'ledge-dev/dev.front')!;
    const ps = pieces(DEVELOPER, p, front);
    expect(ps.map(x => (x.kind === 'harness' ? 'harness' : pieceTitle(x.entry)))).toEqual(['harness', 'role', 'cultureDefault', 'scope', 'skills', 'identity']);
    const skills = ps[4]!;
    expect(skills.kind === 'entry' && isMissing(skills.entry)).toBe(true);
    // A seat OpenRig could not be asked about: its role's startup, then its own.
    const back = { ...seatOf(DEVELOPER, 'ledge-dev/dev.back')!, memberStartup: [] };
    expect(pieces(DEVELOPER, p, back).map(x => x.kind)).toEqual(['harness', 'entry']);
  });
  it('sizes, applies-on tags and the library/repository diff', () => {
    expect(formatSize(1843, 'fr')).toBe('1,8 ko');
    expect(formatSize(1843, 'en')).toBe('1.8 KB');
    expect(formatSize(600, 'fr')).toBe('600 o');
    expect(formatSize(undefined, 'fr')).toBe('—');
    expect([appliesOf(['fresh_start', 'restore']), appliesOf(['fresh_start']), appliesOf(['restore']), appliesOf([])]).toEqual(['both', 'fresh', 'restore', null]);
    expect(lineDiff('a\nb\nc', 'a\nx\nc')).toEqual([{ op: ' ', text: 'a' }, { op: '-', text: 'b' }, { op: '+', text: 'x' }, { op: ' ', text: 'c' }]);
  });
  it('navigation: the Roles section, a role seen from a seat, another machine back to its list', () => {
    let s = initialNav({ helpers: false, paused: false } as never);
    s = navReducer(s, { type: 'openrig', section: 'roles' });
    expect(s.place).toMatchObject({ kind: 'openrig', section: 'roles' });
    s = navReducer(s, { type: 'openrig', role: 'u1', seat: 'ledge-dev/dev.front' });
    expect(s.place).toMatchObject({ kind: 'openrig', section: 'roles', role: 'u1', seat: 'ledge-dev/dev.front' });
    // Picking « selon la spec » drops the seat; the role stays.
    s = navReducer(s, { type: 'openrig', section: 'roles', role: 'u1' });
    expect(s.place).not.toHaveProperty('seat');
    s = navReducer(s, { type: 'openrig', machine: 'ec2' });
    expect(s.place).toMatchObject({ kind: 'openrig', machine: 'ec2', section: 'roles' });
    expect(s.place).not.toHaveProperty('role');
    s = navReducer(s, { type: 'openrig', section: 'rigs' });
    expect(s.place).not.toHaveProperty('section');
  });
});
