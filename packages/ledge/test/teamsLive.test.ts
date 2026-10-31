import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTeamsLive, teamsJournal, type TeamsLive } from '../src/daemon/teamsLive.js';
import { resolveRoleAddress, seatContext, seatKey, seatView, teamChangeLine, teammates } from '../src/daemon/seat.js';
import { identityContext } from '../src/cli/hook.js';

const T0 = '2026-10-26T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

let store: Store; let teams: TeamsLive; let changes: Team[];
const make = () => { const t = teams.create({ name: 'ledge-roles', project: 'ledge', cwd: '/w/ledge', roles: ['lead', 'build', 'review'] }); return t; };

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'teams-')), 'j.json') });
  store.upsert(mk('pim', 'Pim')); store.upsert(mk('otto', 'Otto')); store.upsert(mk('nova', 'Nova', { tool: 'codex' })); store.upsert(mk('mila', 'Mila'));
  teams = createTeamsLive({ store, now: () => T0 });
  changes = []; teams.onChange(t => changes.push(t));
});

describe('live teams', () => {
  it('a new team is active with free seats; seating tells each session its team and role', () => {
    const t = make();
    expect(t).toMatchObject({ id: expect.stringMatching(/^team-[0-9a-f]{4}$/), state: 'active', seats: [{ role: 'lead', sessionId: null }, { role: 'build', sessionId: null }, { role: 'review', sessionId: null }] });
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef');
    teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    expect(store.get('pim')).toMatchObject({ team: t.id, role: 'lead', roleLabel: 'Chef' });
    expect(teams.teamOf('otto')?.id).toBe(t.id);
    expect(teammates(teams.get(t.id)!, store.all())).toEqual([{ name: 'Pim', role: 'lead' }, { name: 'Otto', role: 'build' }]);
  });

  it('active → resting when its last seat ends, active again when one comes back', () => {
    const t = make();
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    store.upsert({ ...store.get('pim')!, state: 'exited' });
    expect(teams.get(t.id)!.state).toBe('active');
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    expect(teams.get(t.id)).toMatchObject({ state: 'resting', restingAt: T0 });
    // Its seats keep their archived sessions: that is what a resume brings back.
    expect(teams.get(t.id)!.seats.filter(s => s.sessionId).map(s => s.sessionId)).toEqual(['pim', 'otto']);
    store.upsert({ ...store.get('otto')!, state: 'idle' });
    expect(teams.get(t.id)!.state).toBe('active');
    expect(teams.get(t.id)!.restingAt).toBeUndefined();
  });

  it('join takes a free or a new role, refuses a role held, an ended session; leave frees the seat', () => {
    const t = make();
    teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    expect(teams.join(t.id, 'mila', 'build', 'Build')).toBe("le rôle @build est déjà tenu dans ledge-roles par Otto");
    const joined = teams.join(t.id, 'mila', 'qa', 'QA') as Team;
    expect(joined.seats.at(-1)).toEqual({ role: 'qa', sessionId: 'mila' });
    expect(store.get('mila')).toMatchObject({ team: t.id, role: 'qa' });
    store.upsert(mk('arlo', 'Arlo', { state: 'exited' }));
    expect(teams.join(t.id, 'arlo', 'review', 'R')).toBe("Arlo n'est pas en cours");
    expect(teams.join('team-zzzz', 'mila', 'qa', 'QA')).toBe('aucune équipe team-zzzz');
    const left = teams.leave(t.id, 'mila') as Team;
    expect(left.seats.find(s => s.role === 'qa')).toEqual({ role: 'qa', sessionId: null });
    expect(store.get('mila')!.team).toBeUndefined();
    expect(store.get('mila')!.role).toBe('qa');
    expect(teams.leave(t.id, 'mila')).toBe("cette session n'est pas dans cette équipe");
  });

  it('a session sits at one table: joining another team takes it out of the first', () => {
    const a = make(); const b = teams.create({ name: 'mobile', project: 'ledge', cwd: '/w/ledge', roles: ['build'] });
    teams.seat(a.id, 'build', store.get('otto')!, 'Build');
    teams.join(b.id, 'otto', 'build', 'Build');
    expect(teams.get(a.id)!.seats.find(s => s.role === 'build')!.sessionId).toBeNull();
    expect(teams.teamOf('otto')?.id).toBe(b.id);
  });

  it('dissolve sends its sessions to the common table and takes no more change; a deleted session frees its seat', () => {
    const t = make();
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    store.remove('otto');
    expect(teams.get(t.id)!.seats.find(s => s.role === 'build')!.sessionId).toBeNull();
    expect(teams.dissolve(t.id)).toMatchObject({ state: 'dissolved', dissolvedAt: T0 });
    expect(store.get('pim')!.team).toBeUndefined();
    expect(teams.teamOf('pim')).toBeUndefined();
    expect(teams.join(t.id, 'pim', 'lead', 'Chef')).toBe("l'équipe ledge-roles est dissoute");
    expect(teams.dissolve(t.id)).toBe("l'équipe ledge-roles est déjà dissoute");
    expect(changes.at(-1)!.state).toBe('dissolved');
  });

  it('a team dissolved over a week ago is purged at the next change, and told to onPurged (issue #146)', () => {
    let at = T0; const purged: string[] = [];
    const live = createTeamsLive({ store, now: () => at, onPurged: t => purged.push(t.id) });
    const old = live.create({ name: 'vieille', project: null, cwd: '/w', roles: ['build'] });
    live.dissolve(old.id);
    at = '2026-11-01T08:00:00.000Z';
    live.create({ name: 'tôt', project: null, cwd: '/w', roles: ['build'] });
    expect(purged).toEqual([]);
    at = '2026-11-03T08:00:01.000Z';
    live.create({ name: 'tard', project: null, cwd: '/w', roles: ['build'] });
    expect(live.get(old.id)).toBeUndefined();
    expect(purged).toEqual([old.id]);
    live.close();
  });

  it('outlives the daemon through its journal, and settles what changed meanwhile', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'teams-j-')), 'teams-live.json');
    const journal = teamsJournal(path);
    const first = createTeamsLive({ store, journal, now: () => T0 });
    const t = first.create({ name: 'w', project: null, cwd: '/w', roles: ['build'] });
    first.seat(t.id, 'build', store.get('otto')!, 'Build');
    await journal.flush(); first.close();
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    const again = createTeamsLive({ store, journal: teamsJournal(path), now: () => T0 });
    expect(again.get(t.id)).toMatchObject({ name: 'w', state: 'resting', seats: [{ role: 'build', sessionId: 'otto' }] });
  });
});

describe('compose', () => {
  const seated = () => {
    const t = teams.create({ name: 'ledge-roles', project: 'ledge', cwd: '/w/ledge', roles: ['lead', 'dev', 'qa'] });
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'dev', store.get('otto')!, 'Dev');
    return t;
  };

  it('keeps the given order and the kept roles’ sessions; adds a free seat; drops a free seat; the overrides are stored as given, the name ignored', () => {
    const t = seated();
    const r = teams.compose(t.id, [{ role: 'lead', model: 'sonnet', name: 'Zed' }, { role: 'dev' }, { role: 'rev', tool: 'codex', effort: 'high' }]);
    expect(typeof r).toBe('object');
    const done = r as Exclude<typeof r, string>;
    expect(done.added).toEqual(['rev']); expect(done.removed).toEqual(['qa']);
    expect(done.team.seats).toEqual([{ role: 'lead', sessionId: 'pim', model: 'sonnet' }, { role: 'dev', sessionId: 'otto' }, { role: 'rev', sessionId: null, tool: 'codex', effort: 'high' }]);
    expect(teams.get(t.id)!.seats).toEqual(done.team.seats);
    expect(changes.at(-1)!.seats).toEqual(done.team.seats);
  });

  it('a removed seat with a live session leaves; once the session has exited the seat is gone and the session is out of the team', () => {
    const t = seated();
    const r = teams.compose(t.id, [{ role: 'lead' }]) as Exclude<ReturnType<TeamsLive['compose']>, string>;
    expect(r.removed).toEqual(['dev', 'qa']);
    expect(r.team.seats).toEqual([{ role: 'lead', sessionId: 'pim' }, { role: 'dev', sessionId: 'otto', leaving: true }]);
    expect(teams.teamOf('otto')?.id).toBe(t.id);
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    expect(teams.get(t.id)!.seats).toEqual([{ role: 'lead', sessionId: 'pim' }]);
    expect(store.get('otto')!.team).toBeUndefined();
  });

  it('a leaving seat goes too when its session is deleted; an ended session on a removed seat is dropped at once', () => {
    const t = seated();
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    teams.compose(t.id, [{ role: 'lead' }]);
    expect(teams.get(t.id)!.seats).toEqual([{ role: 'lead', sessionId: 'pim' }]);
    expect(store.get('otto')!.team).toBeUndefined();
    const u = teams.create({ name: 'u', project: 'ledge', cwd: '/w/ledge', roles: ['lead', 'dev'] });
    teams.seat(u.id, 'lead', store.get('mila')!, 'Chef');
    teams.compose(u.id, [{ role: 'dev' }]);
    expect(teams.get(u.id)!.seats).toEqual([{ role: 'dev', sessionId: null }, { role: 'lead', sessionId: 'mila', leaving: true }]);
    store.remove('mila');
    expect(teams.get(u.id)!.seats).toEqual([{ role: 'dev', sessionId: null }]);
  });

  it('listing a leaving role again keeps its seat and its session, and clears leaving; a leaving seat is not counted twice', () => {
    const t = seated();
    teams.compose(t.id, [{ role: 'lead' }]);
    const r = teams.compose(t.id, [{ role: 'lead' }, { role: 'dev', model: 'opus' }]) as Exclude<ReturnType<TeamsLive['compose']>, string>;
    expect(r.added).toEqual([]); expect(r.removed).toEqual([]);
    expect(r.team.seats).toEqual([{ role: 'lead', sessionId: 'pim' }, { role: 'dev', sessionId: 'otto', model: 'opus' }]);
    // Still leaving, left alone by a later composition that does not name it.
    teams.compose(t.id, [{ role: 'lead' }]);
    const again = teams.compose(t.id, [{ role: 'lead' }, { role: 'qa' }]) as Exclude<ReturnType<TeamsLive['compose']>, string>;
    expect(again.removed).toEqual([]);
    expect(again.team.seats.map(s => [s.role, s.leaving ?? false])).toEqual([['lead', false], ['qa', false], ['dev', true]]);
  });

  it('a leaving seat that loses its session another way — leave, join elsewhere — is dropped, never left without one', () => {
    const t = seated();
    teams.compose(t.id, [{ role: 'lead' }, { role: 'qa' }]);
    expect(teams.get(t.id)!.seats.find(s => s.role === 'dev')).toMatchObject({ sessionId: 'otto', leaving: true });
    teams.leave(t.id, 'otto');
    expect(teams.get(t.id)!.seats.map(s => s.role)).toEqual(['lead', 'qa']);
    expect(store.get('otto')!.team).toBeUndefined();
    const u = seated();
    teams.compose(u.id, [{ role: 'lead' }, { role: 'qa' }]);
    const joined = teams.join(u.id, 'otto', 'qa', 'QA') as Team;
    expect(joined.seats).toEqual([{ role: 'lead', sessionId: 'pim' }, { role: 'qa', sessionId: 'otto' }]);
  });

  it('a persisted leaving seat is dropped at load when its session ended or is missing', () => {
    const persisted: Team = { id: 'team-abcd', name: 'p', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', createdAt: T0, updatedAt: T0,
      seats: [{ role: 'lead', sessionId: 'pim' }, { role: 'dev', sessionId: 'otto', leaving: true }, { role: 'qa', sessionId: 'ghost', leaving: true }, { role: 'rev', sessionId: 'nova', leaving: true }, { role: 'ops', sessionId: null, leaving: true }] };
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    const again = createTeamsLive({ store, journal: { load: () => [persisted], save() {} }, now: () => T0 });
    expect(again.get('team-abcd')!.seats).toEqual([{ role: 'lead', sessionId: 'pim' }, { role: 'rev', sessionId: 'nova', leaving: true }]);
    again.close();
  });

  it('refuses a dissolved team and an unknown one', () => {
    const t = seated();
    teams.dissolve(t.id);
    expect(typeof teams.compose(t.id, [{ role: 'lead' }])).toBe('string');
    expect(typeof teams.compose('team-0000', [{ role: 'lead' }])).toBe('string');
  });
});

describe('a seat’s context and @role', () => {
  it('tells its role, its prompt, its team and the operator', () => {
    const text = seatContext({ role: { id: 'review', label: 'Relecteur', prompt: 'Tu relis sans modifier.' }, team: { name: 'ledge-roles', members: [{ name: 'Pim', role: 'lead' }, { name: 'Otto', role: 'build' }] } });
    expect(text.split('\n')).toEqual([
      "Ton rôle : Relecteur (review), dans l'équipe ledge-roles.",
      'Tu relis sans modifier.',
      'Ton équipe : Pim (lead), Otto (build). Écris-leur par leur rôle : ledge send @build "…", ledge task give @qa "…".',
      expect.stringContaining("L'opérateur est Ledge")
    ]);
    expect(seatContext({ roleId: 'qa' })).toBe('Ton rôle : qa (qa).');
    expect(seatContext({})).toBe('');
  });

  it('the identity lines end with the seat lines', () => {
    const text = identityContext({ name: 'Nova', tool: 'codex', project: 'ledge', cwd: '/w/ledge', seat: "Ton rôle : Relecteur (review)." });
    expect(text.split('\n')[0]).toContain('Tu es Nova');
    expect(text.split('\n').at(-1)).toBe('Ton rôle : Relecteur (review).');
    expect(identityContext({ name: 'Nova', tool: 'codex', project: 'ledge', cwd: '/w/ledge' })).not.toContain('Ton rôle');
  });

  it('resolves @role among the live seats of the sender’s team: one, none, no team', () => {
    const t = make();
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    expect(resolveRoleAddress('@build', 'pim', store.all(), teams.all())).toEqual({ to: 'Otto' });
    expect(resolveRoleAddress('Nova', 'pim', store.all(), teams.all())).toEqual({ to: 'Nova' });
    expect(resolveRoleAddress('@qa', 'pim', store.all(), teams.all())).toEqual({ reason: "personne ne tient @qa dans l'équipe ledge-roles (rôles tenus : @lead, @build)" });
    expect(resolveRoleAddress('@build', 'mila', store.all(), teams.all())).toEqual({ reason: "@build n'existe que dans une équipe" });
    store.upsert({ ...store.get('otto')!, state: 'exited' });
    expect(resolveRoleAddress('@build', 'pim', store.all(), teams.all())).toMatchObject({ reason: expect.stringContaining('personne ne tient @build') });
  });
});

describe('a seat taken out of its team, and what it was last told', () => {
  it('leave, dissolve and a seat in another team name the team left (teamLeft), report it once, and a new seat clears it', () => {
    const left: string[][] = [];
    teams = createTeamsLive({ store, now: () => T0, onLeft: (id, t, why, to) => left.push([id, t.name, why, ...(to ? [to.name] : [])]) });
    const t = make();
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'build', store.get('otto')!, 'Build'); teams.seat(t.id, 'review', store.get('nova')!, 'Relecteur');
    teams.leave(t.id, 'otto');
    expect(store.get('otto')).toMatchObject({ team: undefined, teamLeft: 'ledge-roles' });
    expect(resolveRoleAddress('@lead', 'otto', store.all(), teams.all())).toEqual({ reason: "tu n'es plus dans l'équipe ledge-roles : @lead ne te sert plus (ledge team list)" });
    const other = teams.create({ name: 'api', project: 'api', cwd: '/w/api', roles: ['lead'] });
    teams.join(other.id, 'nova', 'lead', 'Chef');
    // Seated in the other team at once: nothing left behind to say to a refused @role.
    expect(store.get('nova')).toMatchObject({ team: other.id, teamLeft: undefined });
    teams.dissolve(t.id);
    expect(store.get('pim')).toMatchObject({ team: undefined, teamLeft: 'ledge-roles' });
    expect(left).toEqual([['otto', 'ledge-roles', 'leave'], ['nova', 'ledge-roles', 'moved', 'api'], ['pim', 'ledge-roles', 'dissolve']]);
    // Seated again: no team left behind.
    teams.join(other.id, 'otto', 'build', 'Build');
    expect(store.get('otto')!.teamLeft).toBeUndefined();
  });

  it('seatKey: the team and its live teammates but the seat itself; none is the empty key', () => {
    const t = make();
    teams.seat(t.id, 'lead', store.get('pim')!, 'Chef'); teams.seat(t.id, 'build', store.get('otto')!, 'Build');
    expect(seatView('pim', store.all(), teams.all())).toEqual({ id: t.id, name: 'ledge-roles', members: [{ name: 'Otto', role: 'build' }] });
    expect(seatKey(seatView('mila', store.all(), teams.all()))).toBe('');
    expect(JSON.parse(seatKey(seatView('pim', store.all(), teams.all())))).toEqual({ t: t.id, n: 'ledge-roles', m: ['Otto@build'] });
  });

  it('teamChangeLine: who came, who went, who took whose seat; nothing when the same or never told', () => {
    const key = (m: string[], t = 'team-1', n = 'workshop') => JSON.stringify({ t, n, m });
    const before = key(['Otto@build', 'Nova@review']);
    expect(teamChangeLine(undefined, before)).toBeUndefined();
    expect(teamChangeLine(before, before)).toBeUndefined();
    expect(teamChangeLine(before, key(['Otto@build', 'Nova@review', 'Mila@qa']))).toBe('Ledge : ton équipe workshop a changé (Mila (qa) arrive). Ton équipe : Otto (build), Nova (review), Mila (qa). Écris-leur par leur rôle : ledge send @rôle "…".');
    expect(teamChangeLine(before, key(['Kai@build', 'Nova@review']))).toContain('(Kai remplace Otto (build))');
    expect(teamChangeLine(before, key(['Nova@review']))).toContain('(Otto (build) part)');
    expect(teamChangeLine(before, key([]))).toContain('Ton équipe : personne d\'autre pour l\'instant.');
    expect(teamChangeLine(before, '')).toBe('Ledge : tu n\'es plus dans l\'équipe workshop ; les adresses @rôle ne te servent plus (ledge team list).');
    expect(teamChangeLine('', key(['Otto@build'], 'team-2', 'api'))).toBe('Ledge : tu es maintenant dans l\'équipe api. Ton équipe : Otto (build). Écris-leur par leur rôle : ledge send @rôle "…".');
    expect(teamChangeLine('', '')).toBeUndefined();
  });
});
