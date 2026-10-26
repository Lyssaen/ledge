import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTeamsLive, teamsJournal, type TeamsLive } from '../src/daemon/teamsLive.js';
import { resolveRoleAddress, seatContext, teammates } from '../src/daemon/seat.js';
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
