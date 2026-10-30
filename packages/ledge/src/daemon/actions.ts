// The daemon's side of the action registry (spec 2026-10-26 action registry §2.1): whether an action is possible now, and
// the message the daemon already handles that applies it. The chat's generic card and, in #93, the CLI share it.
import { backendOf, isArchived, offers, pendingKey, riskOf, actionById, DETAIL_MAX, type ActionErrorCode, type ActionId, type ChatAction, type ClientMessage, type Session } from '@ledge/protocol';

export interface ResolveCtx {
  sessions: readonly Session[];
  /** The sessions the same answer closes (its close card): archived once closed, they count as ended for session.archive. */
  closing?: ReadonlySet<string>;
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
/** A session Ledge can act on: tracked, writable, running. */
function writable(s: Session): Refusal | null {
  return s.source === 'hook_only' ? no('read_only', `${s.name} is read-only`) : s.state === 'exited' ? no('exited', `${s.name} has exited`) : null;
}
const b = (name: string) => `**${name}**`;
/** `ChatActionSchema` bounds a summary and each of its words to 300: a longer one would fail the whole chat.history. */
const fit = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
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
  })
};

/**
 * What a card may never do, whatever the device (the user's decision on the cards' mockup, #94): accept a request it shows
 * cut, whose end the user has not read. Refusing it, or setting the card aside, stays possible.
 */
export function cardRefusal(row: Pick<ChatAction, 'action' | 'args' | 'vars' | 'detailCut'>): Refusal | null {
  if (row.action !== 'session.decide' || !row.detailCut || row.args.decision !== 'accept') return null;
  return no('cut', `${row.vars?.session ?? String(row.args.session)}'s request is cut on the card: accept it in the session`);
}

/** The generic actions the daemon can resolve (the earlier cards resolve in chat/service.ts). */
export const GENERIC_ACTIONS = Object.keys(IMPLS) as ActionId[];

/** The actions `action.run` takes (#93, the CLI): the generic ones, and the clean close, which the chat keeps on its close card. */
export const RUN_ACTIONS: readonly ActionId[] = [...GENERIC_ACTIONS, 'session.close'];

/** An action's parsed args against the live state, for `action.run` (#93): who may run it is `runGuard`'s call. */
export function resolveRun(id: ActionId, args: unknown, ctx: ResolveCtx): Resolved {
  if (!RUN_ACTIONS.includes(id)) return no('unknown', `${id} is not run from the CLI`);
  if (id !== 'session.close') return resolveAction(id, args, ctx);
  return withSession(ctx, (args as Args).session, writable, s => row('session.close', { session: s.id }, `Fermer ${b(s.name)}`, { session: s.name }, { session: s.id }));
}

const AGENT_REFUSED = 'une session agent ne peut que se fermer elle-même. Le reste, demande-le à l\'utilisateur (il le lance lui-même, avec --yes si c\'est irréversible)';

/**
 * Who may run what outside the chat (#93, point (a)), from the row as resolved (action, ids, risk) and the session that asks
 * (`by`, left out for the user); the rule lives here alone. The user runs anything. A session closes itself; nothing else.
 * Null when allowed, else the reason.
 */
export function runGuard(row: ChatAction, by: string | undefined, _ctx: ResolveCtx): string | null {
  if (by === undefined) return null;
  if (row.action === 'session.close' && row.session === by) return null;
  return AGENT_REFUSED;
}

/** A generic action's parsed args against the live state: a row ready to apply, or why not. */
export function resolveAction(id: string, args: unknown, ctx: ResolveCtx): Resolved {
  const impl = IMPLS[id as ActionId];
  return impl ? impl(args as Args, ctx) : no('unknown', `${id} is not a generic action`);
}

/** A resolved row as the message the daemon already handles; `rid` names the request where the message takes one. */
export function actionMessage(r: Pick<ChatAction, 'action' | 'args'>, _rid: string): ClientMessage {
  const a = r.args as Args;
  const s = String(a.session ?? '');
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
    default: throw new Error(`${r.action} is not a generic action`);
  }
}
