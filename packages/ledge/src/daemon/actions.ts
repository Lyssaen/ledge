// The daemon's side of the action registry (spec 2026-10-26 action registry §2.1): whether an action is possible now, and
// the message the daemon already handles that applies it. The chat's generic card and, in #93, the CLI share it.
import { backendOf, isArchived, isTeamLive, LEDGE_GIVER, offers, pendingKey, riskOf, taskClosed, actionById, DETAIL_MAX, type ActionErrorCode, type ActionId, type ChatAction, type ClientMessage, type Role, type Session, type Task, type Team } from '@ledge/protocol';

export interface ResolveCtx {
  sessions: readonly Session[]; teams: readonly Team[]; tasks: readonly Task[];
  /** The role `id` as a session in `cwd` would find it (the repository's wins over the home's). */
  findRole: (id: string, cwd?: string) => Role | undefined;
  /** The sessions the same answer closes (its close card): archived once closed, they count as ended for session.archive. */
  closing?: ReadonlySet<string>;
  /** Whether a template of that name is already saved (team.save replaces it). */
  templateExists?: (name: string) => boolean;
}
/** Why not: the daemon's words (the log, the PC's error) and a code for a front's own. */
export type Refusal = { refused: string; code: ActionErrorCode };
export type Resolved = ChatAction | Refusal;
type Args = Record<string, unknown>;

/** A request Ledge may answer from the chat (spec §9.1): never a question (it takes a reply), never OMP's own dialogs. */
const DECIDABLE = ['permission', 'diff', 'plan'] as const;
const KIND: Record<(typeof DECIDABLE)[number], string> = { permission: 'permission', diff: 'diff', plan: 'plan' };

const no = (code: ActionErrorCode, refused: string): Refusal => ({ refused, code });
const isRefusal = (x: object): x is Refusal => 'refused' in x;
/** A session by id, or by bot name among those not ended (the archive included): refused when none or several fit. */
function sessionOf(ref: string, ctx: ResolveCtx): Session | Refusal {
  const byId = ctx.sessions.find(s => s.id === ref);
  if (byId) return byId;
  const named = ctx.sessions.filter(s => s.name === ref);
  const live = named.filter(s => s.state !== 'exited');
  const pick = live.length ? live : named;
  if (pick.length === 1) return pick[0]!;
  return pick.length ? no('ambiguous', `several sessions named ${ref}`) : no('unknown', `unknown session ${ref}`);
}
/** A team by id, or by name among the live ones. */
function teamOf(ref: string, ctx: ResolveCtx): Team | Refusal {
  const byId = ctx.teams.find(t => t.id === ref);
  if (byId) return byId;
  const named = ctx.teams.filter(t => t.name === ref && isTeamLive(t));
  if (named.length === 1) return named[0]!;
  return named.length ? no('ambiguous', `several teams named ${ref}`) : no('unknown', `unknown team ${ref}`);
}
function taskOf(ref: string, ctx: ResolveCtx): Task | Refusal {
  const t = ctx.tasks.find(x => x.id === ref);
  if (!t) return no('unknown', `unknown task ${ref}`);
  return taskClosed(t) ? no('closed', `task ${t.id} is closed`) : t;
}
/** A session Ledge can act on: tracked, writable, running. */
function writable(s: Session): Refusal | null {
  return s.source === 'hook_only' ? no('read_only', `${s.name} is read-only`) : s.state === 'exited' ? no('exited', `${s.name} has exited`) : null;
}
const b = (name: string) => `**${name}**`;
/** `ChatActionSchema` bounds a summary and each of its words to 300: a longer one would fail the whole chat.history. */
const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
/** A title quoted in a summary: short enough that the names around it still fit. */
const title = (t: Task) => fit(t.title, 100);
const row = (action: ActionId, args: Args, summary: string, vars: Record<string, string | null | undefined>, extra: Partial<ChatAction> = {}): ChatAction => {
  const words = Object.fromEntries(Object.entries(vars).flatMap(([k, v]) => (v ? [[k, fit(v, 300)]] : [])));
  return { action, args, summary: fit(summary, 300), vars: words, risk: riskOf(actionById(action)!, args), ...extra };
};
/** A request quoted whole, or cut and said so (the front sends to the session for the rest). */
const detailOf = (text: string): Pick<ChatAction, 'detail' | 'detailCut'> =>
  (text.length <= DETAIL_MAX ? { detail: text } : { detail: `${text.slice(0, DETAIL_MAX - 1)}…`, detailCut: true });

type Impl = (args: Args, ctx: ResolveCtx) => Resolved;
const withSession = (ctx: ResolveCtx, ref: unknown, check: (s: Session) => Refusal | null, then: (s: Session) => Resolved): Resolved => {
  const s = sessionOf(String(ref), ctx);
  if (isRefusal(s)) return s;
  return check(s) ?? then(s);
};
const withTeam = (ctx: ResolveCtx, ref: unknown, then: (t: Team) => Resolved): Resolved => {
  const t = teamOf(String(ref), ctx);
  if (isRefusal(t)) return t;
  return t.state === 'dissolved' ? no('dissolved', `team ${t.name} is dissolved`) : then(t);
};

const IMPLS: Partial<Record<ActionId, Impl>> = {
  'session.model': (a, ctx) => withSession(ctx, a.session, writable, s => {
    const model = a.model as string | null; const effort = a.effort as string | null;
    if (model === (s.model ?? null) && effort === (s.effort ?? null)) return no('same_model', `${s.name} already runs that model`);
    const what = model ? `${model}${effort ? `, effort ${effort}` : ''}` : effort ? `son modèle par défaut, effort ${effort}` : 'son modèle et son effort par défaut';
    return row('session.model', { session: s.id, model, effort }, `Passer ${b(s.name)} sur ${what}`, { session: s.name, model, effort }, { session: s.id });
  }),
  'session.interrupt': (a, ctx) => withSession(ctx, a.session, s => writable(s) ?? (s.tmuxSession || backendOf(s) === 'omp-rpc' ? null : no('no_terminal', `${s.name} has no terminal`)),
    s => row('session.interrupt', { session: s.id }, `Interrompre ${b(s.name)}`, { session: s.name }, { session: s.id })),
  // A running session is closed first (session.close, its clean /exit), never archived on the spot: its agent would be killed
  // mid-work, which Ledge never proposes (spec §6.2). Ledge proposes both, in that order, in one answer: the row is applied once
  // the close card has run (resolved again then, it is refused while the session still runs).
  'session.archive': (a, ctx) => withSession(ctx, a.session,
    s => (isArchived(s) ? no('archived', `${s.name} is already archived`) : s.state !== 'exited' && !ctx.closing?.has(s.id) ? no('running', `${s.name} is still running: close it first`) : null),
    s => row('session.archive', { session: s.id }, `Archiver ${b(s.name)}`, { session: s.name }, { session: s.id })),
  'session.restore': (a, ctx) => withSession(ctx, a.session, s => (isArchived(s) ? null : no('not_archived', `${s.name} is not archived`)),
    s => row('session.restore', { session: s.id }, `Sortir ${b(s.name)} de l'archive`, { session: s.name }, { session: s.id })),
  'session.resume': (a, ctx) => withSession(ctx, a.session, s => (s.source === 'hook_only' ? no('read_only', `${s.name} is read-only`) : s.state !== 'exited' ? no('running', `${s.name} is still running`) : null),
    s => row('session.resume', { session: s.id }, `Reprendre ${b(s.name)} sur sa conversation`, { session: s.name }, { session: s.id })),
  // The note is the row's words, never its summary: a long one would pass the summary's bounds.
  'session.decide': (a, ctx) => withSession(ctx, a.session, writable, s => {
    const p = s.pending;
    if (!p || !(DECIDABLE as readonly string[]).includes(p.kind)) return no('no_request', `${s.name} has no permission, diff or plan pending`);
    if (backendOf(s) === 'omp-rpc') return no('in_session', `${s.name}'s requests are answered in the session`);
    const decision = a.decision as 'accept' | 'deny'; const note = a.note as string | undefined;
    if (note !== undefined && (decision !== 'deny' || !offers(s.tool, p.kind, 'note'))) return no('no_note', `no note with this answer for ${s.tool}`);
    const kind = KIND[p.kind as (typeof DECIDABLE)[number]];
    return row('session.decide', { session: s.id, decision, ...(note ? { note } : {}), expect: { kind: p.kind, text: p.text, key: pendingKey(p) } },
      `${decision === 'accept' ? 'Accepter' : 'Refuser'} la demande de ${kind} de ${b(s.name)}${note ? ', avec une note' : ''}`,
      { session: s.name, decision, kind: p.kind, note }, { session: s.id, ...detailOf(p.body ? `${p.text}\n\n${p.body}` : p.text) });
  }),
  'team.join': (a, ctx) => withTeam(ctx, a.team, t => withSession(ctx, a.session, writable, s => {
    if (t.seats.some(x => x.sessionId === s.id)) return no('member', `${s.name} is already in ${t.name}`);
    const role = ctx.findRole(String(a.role), s.cwd);
    if (!role) return no('unknown_role', `unknown role ${String(a.role)}`);
    return row('team.join', { team: t.id, session: s.id, role: role.id }, `Faire entrer ${b(s.name)} dans ${b(t.name)} comme @${role.id}`,
      { team: t.name, session: s.name, role: role.id }, { session: s.id, team: t.id });
  })),
  'team.leave': (a, ctx) => withTeam(ctx, a.team, t => withSession(ctx, a.session, () => null, s =>
    t.seats.some(x => x.sessionId === s.id)
      ? row('team.leave', { team: t.id, session: s.id }, `Retirer ${b(s.name)} de ${b(t.name)}`, { team: t.name, session: s.name }, { session: s.id, team: t.id })
      : no('not_member', `${s.name} is not in ${t.name}`))),
  'team.resume': (a, ctx) => withTeam(ctx, a.team, t => (t.state !== 'resting' ? no('not_resting', `team ${t.name} is not resting`)
    : row('team.resume', { team: t.id }, `Reprendre l'équipe ${b(t.name)}`, { team: t.name }, { team: t.id }))),
  'team.dissolve': (a, ctx) => withTeam(ctx, a.team, t => row('team.dissolve', { team: t.id }, `Dissoudre l'équipe ${b(t.name)}`, { team: t.name }, { team: t.id })),
  // Saving over a template of the same file replaces it for good: asked again, as any destructive row.
  'team.save': (a, ctx) => withTeam(ctx, a.team, t => {
    const seats = t.seats.flatMap(x => {
      const s = x.sessionId ? ctx.sessions.find(y => y.id === x.sessionId) : undefined;
      return [{ role: x.role, ...(s ? { tool: s.tool, ...(s.model ? { model: s.model } : {}), ...(s.effort ? { effort: s.effort } : {}) } : {}) }];
    }).filter((x, i, all) => all.findIndex(y => y.role === x.role) === i);
    if (seats.length === 0) return no('no_seat', `team ${t.name} has no seat`);
    const name = String(a.name);
    const replaces = ctx.templateExists?.(name) ?? false;
    return row('team.save', { team: t.id, name, seats }, replaces ? `Remplacer le modèle « ${name} » par ${b(t.name)}` : `Enregistrer ${b(t.name)} comme modèle « ${name} »`,
      { team: t.name, name, replaces: replaces ? '1' : undefined }, { team: t.id, ...(replaces ? { risk: 'destructive' as const } : {}) });
  }),
  'task.cancel': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    const reason = a.reason as string | undefined;
    return row('task.cancel', { task: t.id, ...(reason ? { reason } : {}) }, `Annuler la tâche « ${title(t)} » de ${b(t.ownerName)}`,
      { task: t.title, owner: t.ownerName, reason }, { session: t.owner, ...(t.team ? { team: t.team } : {}) });
  },
  'task.pass': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    return withSession(ctx, a.to, s => writable(s) ?? (s.id === t.owner ? no('holder', `${s.name} already holds it`) : null), s => {
      const note = a.note as string | undefined;
      return row('task.pass', { task: t.id, to: s.id, ...(note ? { note } : {}) }, `Passer la tâche « ${title(t)} » de ${b(t.ownerName)} à ${b(s.name)}`,
        { task: t.title, owner: t.ownerName, session: s.name, note }, { session: s.id });
    });
  }
};

/**
 * What a card may never do, whatever the device (the user's decision on the cards' mockup, #94): accept a request it shows
 * cut, whose end the user has not read. Refusing it, or setting the card aside, stays possible.
 */
export function cardRefusal(row: Pick<ChatAction, 'action' | 'args' | 'vars' | 'detailCut'>): Refusal | null {
  if (row.action !== 'session.decide' || !row.detailCut || row.args.decision !== 'accept') return null;
  return no('cut', `${row.vars?.session ?? String(row.args.session)}'s request is cut on the card: accept it in the session`);
}

/** The generic actions the daemon can resolve (the six earlier cards resolve in chat/service.ts). */
export const GENERIC_ACTIONS = Object.keys(IMPLS) as ActionId[];

/** The actions `action.run` takes (#93, the CLI): the generic ones, and the clean close, which the chat keeps on its close card. */
export const RUN_ACTIONS: readonly ActionId[] = [...GENERIC_ACTIONS, 'session.close'];

/** An action's parsed args against the live state, for `action.run` (#93): who may run it is `runGuard`'s call. */
export function resolveRun(id: ActionId, args: unknown, ctx: ResolveCtx): Resolved {
  if (!RUN_ACTIONS.includes(id)) return no('unknown', `${id} is not run from the CLI`);
  if (id !== 'session.close') return resolveAction(id, args, ctx);
  return withSession(ctx, (args as Args).session, writable, s => row('session.close', { session: s.id }, `Fermer ${b(s.name)}`, { session: s.name }, { session: s.id }));
}

/** The role that leads a team: the `@leader` seat (#93 (a)). */
export const LEADER_ROLE = 'leader';
const AGENT_REFUSED = 'une session agent ne peut que se fermer elle-même et quitter son équipe ; l\'@leader d\'une équipe peut aussi la dissoudre, '
  + 'en retirer un membre, en fermer une session ou en annuler une tâche. Le reste, demande-le à l\'utilisateur (il le lance lui-même, avec --yes si c\'est irréversible)';

/**
 * Who may run what outside the chat (#93, point (a), decided by the user on 2026-10-26, option 4), from the row as resolved
 * (action, ids, risk), the session that asks (`by`, left out for the user) and the live state; the rule lives here alone.
 * The user runs anything. A session closes itself and leaves its team; the `@leader` of a team not dissolved dissolves it,
 * takes a member out of it, closes one of its sessions and cancels one of its tasks; nothing else. Null when allowed, else the reason.
 */
export function runGuard(row: ChatAction, by: string | undefined, ctx: ResolveCtx): string | null {
  if (by === undefined) return null;
  if ((row.action === 'session.close' || row.action === 'team.leave') && row.session === by) return null;
  const leads = (t: Team) => t.state !== 'dissolved' && t.seats.some(x => x.sessionId === by && x.role === LEADER_ROLE);
  const led = ctx.teams.filter(leads);
  if ((row.action === 'team.dissolve' || row.action === 'team.leave' || row.action === 'task.cancel') && led.some(t => t.id === row.team)) return null;
  if (row.action === 'session.close' && led.some(t => t.seats.some(x => x.sessionId === row.session))) return null;
  return AGENT_REFUSED;
}

/** A generic action's parsed args against the live state: a row ready to apply, or why not. */
export function resolveAction(id: string, args: unknown, ctx: ResolveCtx): Resolved {
  const impl = IMPLS[id as ActionId];
  return impl ? impl(args as Args, ctx) : no('unknown', `${id} is not a generic action`);
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
