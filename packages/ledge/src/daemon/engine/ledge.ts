import { randomBytes } from 'node:crypto';
import { EXCHANGES_MAX, isArchived, LEADER_ROLE, TEAM_ADDRESS, type Exchange, type Rig, type RigSeat, type SeatState, type Session, type SessionState, type Task, type TaskTransmission, type Team } from '@ledge/protocol';
import type { Store } from '../store.js';
import type { TeamsLive } from '../teamsLive.js';
import type { TeamEngine, TeamEngineMessage } from './types.js';

export interface LedgeEngineDeps {
  store: Pick<Store, 'get' | 'onChange'>;
  teams: Pick<TeamsLive, 'all' | 'get' | 'teamOf' | 'onChange'>;
  now?: () => string;
  /** The Ledge engine is the one in force (default: always). When not, nothing reads its teams nor their exchanges: they keep
   *  recording, and come back as they are once it is chosen again. */
  active?: () => boolean;
}

export interface LedgeEngine extends TeamEngine {
  /** A hand-over of a task of a team (`task.team`): a `task` exchange, from its giver's name to its receiver's. */
  recordTask(t: Task, tr: TaskTransmission): void;
  /**
   * A message one seat sent another of its team, or the lead's `@team` (`to` is then TEAM_ADDRESS): a `message` exchange.
   * `key` (the message's rid) records it once however many times it is submitted; nothing between two teams or outside one.
   */
  recordMessage(from: Session, to: Session | typeof TEAM_ADDRESS, text: string, key?: string): void;
  /** The user's `team.broadcast` to team `teamId`: a `message` exchange from USER_SENDER to TEAM_ADDRESS, once per `key` (its rid). */
  recordUserBroadcast(teamId: string, text: string, key: string): void;
  close(): void;
}

const SEAT_STATE: Record<SessionState, SeatState> = {
  starting: 'starting', idle: 'idle', working: 'working', waiting_permission: 'attention', waiting_input: 'attention', exited: 'stopped', error: 'crashed'
};

/** Who the user is in a team's exchanges (the thread and the Bureaux read it as is). */
export const USER_SENDER = 'Toi';
/** The most of a task's result or reason a `done` or `refuse` exchange carries after its title. */
export const TASK_RESULT_MAX = 200;
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** A hand-over's exchange text: the title; a `done` or `refuse` adds what came of it (branch review M1). */
export const taskExchangeText = (t: Pick<Task, 'title' | 'result'>, op: TaskTransmission['op']): string =>
  (op === 'done' || op === 'refuse') && t.result ? `${t.title} — ${cut(t.result, TASK_RESULT_MAX)}` : t.title;

const liveSession = (s: Session | undefined): s is Session => !!s && s.state !== 'exited' && !isArchived(s);

/**
 * The Ledge engine (lot D, task 4): every team not dissolved, projected into the common team shape on the local machine, and
 * what its seats hand each other as exchanges (in memory, EXCHANGES_MAX per team). A team or seat change that changes a
 * projection is told as `rig.updated`, a team dissolved as `rig.removed`, an exchange as `rig.exchange`. Who hears it (only
 * under the Ledge engine) is the daemon's to decide.
 */
export function createLedgeEngine(d: LedgeEngineDeps): LedgeEngine {
  const now = d.now ?? (() => new Date().toISOString());
  const active = d.active ?? (() => true);
  const listeners = new Set<(m: TeamEngineMessage) => void>();
  const emit = (m: TeamEngineMessage) => { for (const l of listeners) l(m); };
  const kept = new Map<string, Exchange[]>();
  /** The projection last told per team: an unchanged one is not told again. */
  const told = new Map<string, string>();

  const seatOf = (team: Team, seat: Team['seats'][number]): RigSeat => {
    const s = seat.sessionId ? d.store.get(seat.sessionId) : undefined;
    const model = s?.model ?? seat.model;
    return {
      ref: `${seat.role}@${team.id}`, address: `@${seat.role}`, name: s?.name ?? seat.role,
      // A free seat runs what it was composed with; the role's own default is on disk, not read here (claude, Ledge's default).
      runtime: s?.tool ?? seat.tool ?? 'claude',
      ...(s ? { sessionId: s.id } : {}), ...(model ? { model } : {}),
      state: liveSession(s) ? SEAT_STATE[s.state] : 'stopped'
    };
  };
  const project = (team: Team): Rig => {
    const seats = team.seats.map(seat => seatOf(team, seat));
    const lead = team.seats.find(s => s.role === LEADER_ROLE)?.sessionId;
    const branch = lead ? d.store.get(lead)?.branch : undefined;
    const allLive = team.seats.every(seat => liveSession(seat.sessionId ? d.store.get(seat.sessionId) : undefined));
    return {
      id: team.id, name: team.name, machine: 'local', cwd: team.cwd, projectId: team.project, offProject: team.project === null,
      ...(branch ? { branch } : {}),
      // The template it was born of, where an OpenRig rig names its spec: the card shows it (lot F).
      ...(team.template ? { spec: team.template } : {}),
      lifecycle: team.state === 'resting' ? 'stopped' : allLive ? 'running' : 'partial',
      kernel: false, engine: 'ledge', seats, repos: []
    };
  };
  const shown = () => d.teams.all().filter(t => t.state !== 'dissolved');

  /** Tells the team's projection when it changed, its removal once it is dissolved. */
  const follow = (team: Team) => {
    if (team.state === 'dissolved') {
      if (!told.delete(team.id)) return;
      kept.delete(team.id);
      return emit({ type: 'rig.removed', machine: 'local', rigId: team.id });
    }
    const rig = project(team); const key = JSON.stringify(rig);
    if (told.get(team.id) === key) return;
    told.set(team.id, key);
    emit({ type: 'rig.updated', rig });
  };
  for (const t of shown()) told.set(t.id, JSON.stringify(project(t)));

  const unsubscribeTeams = d.teams.onChange(follow);
  const unsubscribeStore = d.store.onChange(c => {
    if (c.type !== 'updated') return; // a removed session frees its seat: the team's own change says it
    for (const t of shown()) if (t.seats.some(s => s.sessionId === c.session.id)) follow(t);
  });

  const record = (x: Omit<Exchange, 'machine' | 'at'>) => {
    const list = kept.get(x.rigId) ?? [];
    if (list.some(e => e.id === x.id)) return;
    const exchange: Exchange = { ...x, machine: 'local', at: now() };
    list.push(exchange);
    if (list.length > EXCHANGES_MAX) list.splice(0, list.length - EXCHANGES_MAX);
    kept.set(x.rigId, list);
    emit({ type: 'rig.exchange', exchange });
  };
  const teamShown = (id: string | undefined): Team | undefined => {
    const t = id ? d.teams.get(id) : undefined;
    return t && t.state !== 'dissolved' ? t : undefined;
  };
  const freshId = () => `x-${randomBytes(4).toString('hex')}`;

  return {
    kind: 'ledge',
    teams: () => (active() ? shown().map(project) : []),
    exchanges: (id, machine) => (active() && (machine ?? 'local') === 'local' ? [...(kept.get(id) ?? [])] : []),
    running: () => d.teams.all().some(t => t.state === 'active'),
    onMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    replay: () => [{ type: 'rig.snapshot', machine: 'local', rigs: active() ? shown().map(project) : [] }],
    recordTask(t, tr) {
      const team = teamShown(t.team); if (!team) return;
      record({ id: `${t.id}:${tr.index}`, rigId: team.id, from: tr.fromName || tr.from, to: tr.toName || tr.to, kind: 'task', text: taskExchangeText(t, tr.op) });
    },
    recordMessage(from, to, text, key) {
      const team = d.teams.teamOf(from.id); if (!team) return;
      if (to !== TEAM_ADDRESS && d.teams.teamOf(to.id)?.id !== team.id) return;
      record({ id: key ? `m-${key}` : freshId(), rigId: team.id, from: from.name, to: to === TEAM_ADDRESS ? TEAM_ADDRESS : to.name, kind: 'message', text });
    },
    recordUserBroadcast(teamId, text, key) {
      const team = teamShown(teamId); if (!team) return;
      record({ id: `u-${key}`, rigId: team.id, from: USER_SENDER, to: TEAM_ADDRESS, kind: 'message', text });
    },
    close() { unsubscribeTeams(); unsubscribeStore(); listeners.clear(); }
  };
}
