// The daemon's side of the action registry (spec 2026-10-26 action registry §2.1): whether an action is possible now, and
// the message the daemon already handles that applies it. The chat's generic card and, in #93, the CLI share it.
import { backendOf, isArchived, isTeamLive, LEDGE_GIVER, offers, pendingKey, riskOf, taskClosed, actionById, type ActionId, type ChatAction, type ClientMessage, type Role, type Session, type Task, type Team } from '@ledge/protocol';

export interface ResolveCtx {
  sessions: readonly Session[]; teams: readonly Team[]; tasks: readonly Task[];
  /** The role `id` as a session in `cwd` would find it (the repository's wins over the home's). */
  findRole: (id: string, cwd?: string) => Role | undefined;
}
export type Resolved = ChatAction | { refused: string };
type Args = Record<string, unknown>;

/** A request Ledge may answer from the chat (spec §9.1): never a question (it takes a reply), never OMP's own dialogs. */
const DECIDABLE = ['permission', 'diff', 'plan'] as const;
const KIND: Record<(typeof DECIDABLE)[number], string> = { permission: 'permission', diff: 'diff', plan: 'plan' };

/** A session by id, or by bot name among those not ended (the archive included): refused when none or several fit. */
function sessionOf(ref: string, ctx: ResolveCtx): Session | string {
  const byId = ctx.sessions.find(s => s.id === ref);
  if (byId) return byId;
  const named = ctx.sessions.filter(s => s.name === ref);
  const live = named.filter(s => s.state !== 'exited');
  const pick = live.length ? live : named;
  if (pick.length === 1) return pick[0]!;
  return pick.length ? `several sessions named ${ref}` : `unknown session ${ref}`;
}
/** A team by id, or by name among the live ones. */
function teamOf(ref: string, ctx: ResolveCtx): Team | string {
  const byId = ctx.teams.find(t => t.id === ref);
  if (byId) return byId;
  const named = ctx.teams.filter(t => t.name === ref && isTeamLive(t));
  if (named.length === 1) return named[0]!;
  return named.length ? `several teams named ${ref}` : `unknown team ${ref}`;
}
function taskOf(ref: string, ctx: ResolveCtx): Task | string {
  const t = ctx.tasks.find(x => x.id === ref);
  if (!t) return `unknown task ${ref}`;
  return taskClosed(t) ? `task ${t.id} is closed` : t;
}
/** A session Ledge can act on: tracked, writable, running. */
function writable(s: Session): string | null {
  return s.source === 'hook_only' ? `${s.name} is read-only` : s.state === 'exited' ? `${s.name} has exited` : null;
}
const b = (name: string) => `**${name}**`;
const row = (action: ActionId, args: Args, summary: string, extra: Partial<ChatAction> = {}): ChatAction =>
  ({ action, args, summary, risk: riskOf(actionById(action)!, args), ...extra });

type Impl = (args: Args, ctx: ResolveCtx) => Resolved;
const withSession = (ctx: ResolveCtx, ref: unknown, check: (s: Session) => string | null, then: (s: Session) => Resolved): Resolved => {
  const s = sessionOf(String(ref), ctx);
  if (typeof s === 'string') return { refused: s };
  const why = check(s);
  return why ? { refused: why } : then(s);
};
const withTeam = (ctx: ResolveCtx, ref: unknown, then: (t: Team) => Resolved): Resolved => {
  const t = teamOf(String(ref), ctx);
  if (typeof t === 'string') return { refused: t };
  return t.state === 'dissolved' ? { refused: `team ${t.name} is dissolved` } : then(t);
};

const IMPLS: Partial<Record<ActionId, Impl>> = {
  'session.model': (a, ctx) => withSession(ctx, a.session, writable, s => {
    const model = a.model as string | null; const effort = a.effort as string | null;
    if (model === (s.model ?? null) && effort === (s.effort ?? null)) return { refused: `${s.name} already runs that model` };
    const what = model ? `${model}${effort ? `, effort ${effort}` : ''}` : effort ? `son modèle par défaut, effort ${effort}` : 'son modèle et son effort par défaut';
    return row('session.model', { session: s.id, model, effort }, `Passer ${b(s.name)} sur ${what}`, { session: s.id });
  }),
  'session.interrupt': (a, ctx) => withSession(ctx, a.session, s => writable(s) ?? (s.tmuxSession || backendOf(s) === 'omp-rpc' ? null : `${s.name} has no terminal`),
    s => row('session.interrupt', { session: s.id }, `Interrompre ${b(s.name)}`, { session: s.id })),
  'session.archive': (a, ctx) => withSession(ctx, a.session, s => (isArchived(s) ? `${s.name} is already archived` : null),
    s => row('session.archive', { session: s.id }, `Archiver ${b(s.name)}`, { session: s.id })),
  'session.restore': (a, ctx) => withSession(ctx, a.session, s => (isArchived(s) ? null : `${s.name} is not archived`),
    s => row('session.restore', { session: s.id }, `Sortir ${b(s.name)} de l'archive`, { session: s.id })),
  'session.resume': (a, ctx) => withSession(ctx, a.session, s => (s.source === 'hook_only' ? `${s.name} is read-only` : s.state !== 'exited' ? `${s.name} is still running` : null),
    s => row('session.resume', { session: s.id }, `Reprendre ${b(s.name)} sur sa conversation`, { session: s.id })),
  'session.decide': (a, ctx) => withSession(ctx, a.session, writable, s => {
    const p = s.pending;
    if (!p || !(DECIDABLE as readonly string[]).includes(p.kind)) return { refused: `${s.name} has no permission, diff or plan pending` };
    if (backendOf(s) === 'omp-rpc') return { refused: `${s.name}'s requests are answered in the session` };
    const decision = a.decision as 'accept' | 'deny'; const note = a.note as string | undefined;
    if (note !== undefined && (decision !== 'deny' || !offers(s.tool, p.kind, 'note'))) return { refused: `no note with this answer for ${s.tool}` };
    const kind = KIND[p.kind as (typeof DECIDABLE)[number]];
    const detail = (p.body ? `${p.text}\n\n${p.body}` : p.text).slice(0, 4000);
    return row('session.decide', { session: s.id, decision, ...(note ? { note } : {}), expect: { kind: p.kind, text: p.text, key: pendingKey(p) } },
      `${decision === 'accept' ? 'Accepter' : 'Refuser'} la demande de ${kind} de ${b(s.name)}${note ? ` (« ${note} »)` : ''}`, { session: s.id, detail });
  }),
  'team.join': (a, ctx) => withTeam(ctx, a.team, t => withSession(ctx, a.session, writable, s => {
    if (t.seats.some(x => x.sessionId === s.id)) return { refused: `${s.name} is already in ${t.name}` };
    const role = ctx.findRole(String(a.role), s.cwd);
    if (!role) return { refused: `unknown role ${String(a.role)}` };
    return row('team.join', { team: t.id, session: s.id, role: role.id }, `Faire entrer ${b(s.name)} dans ${b(t.name)} comme @${role.id}`, { session: s.id, team: t.id });
  })),
  'team.leave': (a, ctx) => withTeam(ctx, a.team, t => withSession(ctx, a.session, () => null, s =>
    t.seats.some(x => x.sessionId === s.id)
      ? row('team.leave', { team: t.id, session: s.id }, `Retirer ${b(s.name)} de ${b(t.name)}`, { session: s.id, team: t.id })
      : { refused: `${s.name} is not in ${t.name}` })),
  'team.resume': (a, ctx) => withTeam(ctx, a.team, t => (t.state !== 'resting' ? { refused: `team ${t.name} is not resting` }
    : row('team.resume', { team: t.id }, `Reprendre l'équipe ${b(t.name)}`, { team: t.id }))),
  'team.dissolve': (a, ctx) => withTeam(ctx, a.team, t => row('team.dissolve', { team: t.id }, `Dissoudre l'équipe ${b(t.name)}`, { team: t.id })),
  'team.save': (a, ctx) => withTeam(ctx, a.team, t => {
    const seats = t.seats.flatMap(x => {
      const s = x.sessionId ? ctx.sessions.find(y => y.id === x.sessionId) : undefined;
      return [{ role: x.role, ...(s ? { tool: s.tool, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}) } : {}) }];
    }).filter((x, i, all) => all.findIndex(y => y.role === x.role) === i);
    if (seats.length === 0) return { refused: `team ${t.name} has no seat` };
    const name = String(a.name);
    return row('team.save', { team: t.id, name, seats }, `Enregistrer ${b(t.name)} comme modèle « ${name} »`, { team: t.id });
  }),
  'task.cancel': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (typeof t === 'string') return { refused: t };
    const reason = a.reason as string | undefined;
    return row('task.cancel', { task: t.id, ...(reason ? { reason } : {}) }, `Annuler la tâche « ${t.title} » de ${b(t.ownerName)}`, { session: t.owner, ...(t.team ? { team: t.team } : {}) });
  },
  'task.pass': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (typeof t === 'string') return { refused: t };
    return withSession(ctx, a.to, s => writable(s) ?? (s.id === t.owner ? `${s.name} already holds it` : null), s => {
      const note = a.note as string | undefined;
      return row('task.pass', { task: t.id, to: s.id, ...(note ? { note } : {}) }, `Passer la tâche « ${t.title} » de ${b(t.ownerName)} à ${b(s.name)}`, { session: s.id });
    });
  }
};

/** The generic actions the daemon can resolve (the six earlier cards resolve in chat/service.ts). */
export const GENERIC_ACTIONS = Object.keys(IMPLS) as ActionId[];

/** A generic action's parsed args against the live state: a row ready to apply, or why not. */
export function resolveAction(id: ActionId, args: unknown, ctx: ResolveCtx): Resolved {
  const impl = IMPLS[id];
  return impl ? impl(args as Args, ctx) : { refused: `${id} is not a generic action` };
}

/** A resolved row as the message the daemon already handles; `rid` names the request where the message takes one. */
export function actionMessage(r: Pick<ChatAction, 'action' | 'args'>, rid: string): ClientMessage {
  const a = r.args as Args;
  const s = String(a.session ?? ''); const team = String(a.team ?? '');
  switch (r.action) {
    case 'session.model': return { type: 'session.model', id: s, model: a.model as string | null, effort: a.effort as string | null };
    case 'session.interrupt': return { type: 'session.interrupt', id: s };
    case 'session.archive': return { type: 'session.archive', id: s };
    case 'session.restore': return { type: 'session.restore', id: s };
    case 'session.resume': return { type: 'session.resume', id: s };
    case 'session.decide': {
      const expect = a.expect as { kind: 'permission' | 'diff' | 'plan'; text: string; key: string };
      return { type: 'session.decide', id: s, decision: a.decision as 'accept' | 'deny', ...(a.note ? { note: String(a.note) } : {}), expect };
    }
    case 'team.join': return { type: 'team.join', team, session: s, role: String(a.role) };
    case 'team.leave': return { type: 'team.leave', team, session: s };
    case 'team.resume': return { type: 'team.resume', team };
    case 'team.dissolve': return { type: 'team.dissolve', team };
    case 'team.save': return { type: 'team.save', rid, name: String(a.name), seats: a.seats as Extract<ClientMessage, { type: 'team.save' }>['seats'] };
    case 'task.cancel': return { type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'cancel', task: String(a.task), ...(a.reason ? { text: String(a.reason) } : {}) };
    case 'task.pass': return { type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'pass', task: String(a.task), to: String(a.to), ...(a.note ? { text: String(a.note) } : {}) };
    default: throw new Error(`${r.action} is not a generic action`);
  }
}
