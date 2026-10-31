import { randomBytes } from 'node:crypto';
import { isArchived, TeamSchema, type Seat, type Session, type Team } from '@ledge/protocol';
import type { Store } from './store.js';
import { jsonJournal, type Journal } from './journal.js';
import { log } from '../log.js';

export type TeamsJournal = Journal<Team[]>;

/** A dissolved team is kept this long, for history (spec 2026-10-25 roles §3.3). */
const DISSOLVED_TTL_MS = 7 * 24 * 3600 * 1000;

export interface TeamsLiveDeps {
  store: Pick<Store, 'get' | 'all' | 'onChange' | 'patch'>;
  journal?: TeamsJournal;
  now?: () => string;
  /** A session taken out of a team it sat in, still in its record (its `team` is cleared, `teamLeft` set): `leave`, the
   *  team `dissolve`d, `moved` to the seat of another team (`to`), or `removed` by a composition once its seat went. */
  onLeft?: (session: string, team: Team, why: 'leave' | 'dissolve' | 'moved' | 'removed', to?: Team) => void;
}

export interface TeamsLive {
  all(): Team[];
  get(id: string): Team | undefined;
  /** A new active team with free seats (their sessions come as they are spawned). */
  create(t: { name: string; template?: string; project: string | null; machine?: string; cwd: string; roles: (string | Pick<Seat, 'role' | 'tool' | 'model' | 'effort' | 'name'>)[] }): Team;
  /** A seat's session, once spawned: the session is told its team on its record. */
  seat(team: string, role: string, session: Session, roleLabel: string): Team;
  /** A live session takes a role in the team (a free one or a new one); refused with the reason. */
  join(team: string, session: string, role: string, roleLabel: string): Team | string;
  /** The session goes back to its project's common table; its open tasks stay its own. */
  leave(team: string, session: string): Team | string;
  dissolve(team: string): Team | string;
  /**
   * A live team's new composition (spec 2026-10-28 mobile teams §3.6). The seats keep the given order; a kept role keeps its session and
   * takes the given `tool`/`model`/`effort`/`name`; an added role is a free seat. A removed role with a live session
   * becomes `leaving` (the daemon closes it at its next free moment), a free or ended one is dropped. Listing a leaving role again keeps it.
   */
  compose(team: string, seats: readonly Seat[]): { team: Team; added: string[]; removed: string[] } | string;
  /** The team of a session, while it sits in one that is not dissolved. */
  teamOf(session: string): Team | undefined;
  onChange(listener: (t: Team) => void): () => void;
  close(): void;
}

/** What a seat may change of its role's defaults, and the bot name it asks for (#144). */
const seatOverrides = (s: Pick<Seat, 'tool' | 'model' | 'effort' | 'name'>) => ({ ...(s.tool ? { tool: s.tool } : {}), ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}), ...(s.name ? { name: s.name } : {}) });

const live = (s: Session | undefined): boolean => !!s && s.state !== 'exited' && !isArchived(s);

/**
 * The live teams (spec 2026-10-25 roles §3.3): one project, one folder, its seats and their sessions. A team is active
 * while one of its seats' sessions lives, resting once they have all ended (it keeps its seats, their archived sessions
 * and its tasks, and can be resumed), dissolved when the user says so. With a journal, teams outlive the daemon.
 */
export function createTeamsLive(d: TeamsLiveDeps): TeamsLive {
  const now = d.now ?? (() => new Date().toISOString());
  const teams = new Map<string, Team>();
  for (const raw of d.journal?.load() ?? []) { const r = TeamSchema.safeParse(raw); if (r.success) teams.set(r.data.id, r.data); }
  const listeners = new Set<(t: Team) => void>();

  const save = () => {
    const oldest = Date.parse(now()) - DISSOLVED_TTL_MS;
    for (const t of [...teams.values()]) if (t.state === 'dissolved' && Date.parse(t.dissolvedAt ?? t.updatedAt) < oldest) teams.delete(t.id);
    d.journal?.save([...teams.values()]);
  };
  const put = (t: Team): Team => {
    const next = { ...t, updatedAt: now() };
    teams.set(t.id, next); save();
    for (const l of listeners) l(next);
    return next;
  };
  /** The session's record leaves the team: `teamLeft` names it, for a refused `@role` and the seat's own notice. */
  const takeOut = (session: string, t: Team, why: 'leave' | 'dissolve' | 'moved' | 'removed', to?: Team) => {
    if (d.store.get(session)?.team !== t.id) return;
    d.store.patch(session, { team: undefined, teamLeft: t.name });
    d.onLeft?.(session, t, why, to);
  };
  const newId = (): string => { for (;;) { const id = `team-${randomBytes(2).toString('hex')}`; if (!teams.has(id)) return id; } };
  const teamOf = (session: string): Team | undefined =>
    [...teams.values()].find(t => t.state !== 'dissolved' && t.seats.some(s => s.sessionId === session));

  /** Active while a seat lives, resting once every seated session has ended; a team none of whose seats has started yet stays as it is. */
  const settle = (t0: Team): void => {
    let t = teams.get(t0.id) ?? t0;
    if (t.state === 'dissolved') return;
    // A seat on its way out goes once it holds no live session (ended, deleted, left, or ended while the daemon was down); its session is out of the team.
    const stale = t.seats.filter(s => s.leaving && !(s.sessionId && live(d.store.get(s.sessionId))));
    if (stale.length) {
      const id = t.id;
      t = put({ ...t, seats: t.seats.filter(s => !stale.includes(s)) });
      for (const s of stale) if (s.sessionId) takeOut(s.sessionId, t, 'removed');
    }
    const seated = t.seats.filter(s => s.sessionId);
    if (!seated.length) return;
    const anyLive = seated.some(s => live(d.store.get(s.sessionId!)));
    if (anyLive && t.state === 'resting') { const { restingAt: _r, ...rest } = t; put({ ...rest, state: 'active' }); }
    else if (!anyLive && t.state === 'active') { put({ ...t, state: 'resting', restingAt: now() }); log(`team ${t.id} (${t.name}) is resting: all its seats have ended`); }
  };
  for (const t of [...teams.values()]) settle(t);

  const unsubscribe = d.store.onChange(c => {
    if (c.type === 'recents') return;
    const id = c.type === 'removed' ? c.id : c.session.id;
    for (const t of [...teams.values()]) {
      if (!t.seats.some(s => s.sessionId === id)) continue;
      // A deleted session frees its seat for good: nothing is left to resume there.
      if (c.type === 'removed') put({ ...t, seats: t.seats.map(s => (s.sessionId === id ? { ...s, sessionId: null } : s)) });
      settle(teams.get(t.id)!);
    }
  });

  /** Takes a session out of any other team it sat in: one session, one table. */
  const unseatElsewhere = (session: string, keep: string) => {
    for (const t of [...teams.values()]) {
      if (t.id === keep || t.state === 'dissolved' || !t.seats.some(s => s.sessionId === session)) continue;
      put({ ...t, seats: t.seats.map(s => (s.sessionId === session ? { ...s, sessionId: null } : s)) });
      takeOut(session, t, 'moved', teams.get(keep));
      settle(teams.get(t.id)!);
    }
  };

  return {
    all: () => [...teams.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    get: id => teams.get(id),
    create(t) {
      const at = now();
      return put({ id: newId(), name: t.name, ...(t.template ? { template: t.template } : {}), project: t.project, machine: t.machine ?? 'local', cwd: t.cwd,
        state: 'active', seats: t.roles.map(r => (typeof r === 'string' ? { role: r, sessionId: null } : { role: r.role, sessionId: null, ...seatOverrides(r) })), createdAt: at, updatedAt: at });
    },
    seat(id, role, session, roleLabel) {
      const t = teams.get(id); if (!t) throw new Error(`unknown team ${id}`);
      unseatElsewhere(session.id, id);
      // A session replaced on its seat (a restart) is out of the team.
      const prev = t.seats.find(s => s.role === role)?.sessionId;
      if (prev && prev !== session.id && d.store.get(prev)?.team === id) d.store.patch(prev, { team: undefined });
      const seats = t.seats.some(s => s.role === role) ? t.seats.map(s => (s.role === role ? { ...s, sessionId: session.id } : s)) : [...t.seats, { role, sessionId: session.id }];
      d.store.patch(session.id, { team: id, role, roleLabel, teamLeft: undefined });
      const next = put({ ...t, seats });
      settle(next);
      return teams.get(id)!;
    },
    join(id, sessionId, role, roleLabel) {
      const t = teams.get(id); if (!t) return `aucune équipe ${id}`;
      if (t.state === 'dissolved') return `l'équipe ${t.name} est dissoute`;
      const s = d.store.get(sessionId); if (!s) return 'session inconnue';
      if (!live(s)) return `${s.name} n'est pas en cours`;
      if (s.source !== 'launcher') return `${s.name} n'a pas été lancée par Ledge`;
      const held = t.seats.find(x => x.role === role && x.sessionId && x.sessionId !== sessionId && live(d.store.get(x.sessionId)));
      if (held) return `le rôle @${role} est déjà tenu dans ${t.name} par ${d.store.get(held.sessionId!)?.name ?? held.sessionId}`;
      // The session's old seat in this team, under another role, is freed: one seat per session.
      const freed = { ...t, seats: t.seats.map(x => (x.sessionId === sessionId && x.role !== role ? { ...x, sessionId: null } : x)) };
      teams.set(id, freed);
      return this.seat(id, role, s, roleLabel);
    },
    leave(id, sessionId) {
      const t = teams.get(id); if (!t) return `aucune équipe ${id}`;
      if (!t.seats.some(s => s.sessionId === sessionId)) return 'cette session n\'est pas dans cette équipe';
      takeOut(sessionId, t, 'leave');
      const next = put({ ...t, seats: t.seats.map(s => (s.sessionId === sessionId ? { ...s, sessionId: null } : s)) });
      settle(next);
      return teams.get(id)!;
    },
    dissolve(id) {
      const t = teams.get(id); if (!t) return `aucune équipe ${id}`;
      if (t.state === 'dissolved') return `l'équipe ${t.name} est déjà dissoute`;
      // The sessions go back to the common table; they stay as they are (archived, live) otherwise.
      for (const s of t.seats) if (s.sessionId) takeOut(s.sessionId, t, 'dissolve');
      const at = now();
      log(`team ${t.id} (${t.name}) dissolved`);
      return put({ ...t, state: 'dissolved', dissolvedAt: at });
    },
    compose(id, given) {
      const t = teams.get(id); if (!t) return `aucune équipe ${id}`;
      if (t.state === 'dissolved') return `l'équipe ${t.name} est dissoute`;
      const before = new Map(t.seats.map(s => [s.role, s]));
      const listed = new Set(given.map(g => g.role));
      const kept = given.map(g => ({ role: g.role, sessionId: before.get(g.role)?.sessionId ?? null, ...seatOverrides(g) }));
      const added = given.filter(g => !before.has(g.role)).map(g => g.role);
      const gone = t.seats.filter(s => !listed.has(s.role));
      // A removed seat with a live session leaves (one already leaving stays so); the others are dropped, their session out of the team.
      const stays = (s: Team['seats'][number]) => !!s.sessionId && live(d.store.get(s.sessionId));
      const staying = gone.filter(stays).map(s => ({ ...s, leaving: true as const }));
      for (const s of gone) if (!stays(s) && s.sessionId && d.store.get(s.sessionId)?.team === id) d.store.patch(s.sessionId, { team: undefined });
      const removed = gone.filter(s => !s.leaving).map(s => s.role);
      const next = put({ ...t, seats: [...kept, ...staying] });
      settle(next);
      return { team: teams.get(id)!, added, removed };
    },
    teamOf,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close: unsubscribe
  };
}

export function teamsJournal(path: string): TeamsJournal & { flush(): Promise<void> } {
  return jsonJournal<Team[]>(path, 'teams', raw => (Array.isArray(raw) ? raw as Team[] : undefined));
}
