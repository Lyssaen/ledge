// The daemon's side of the action registry (spec 2026-10-26 action registry §2.1): whether an action is possible now, and
// the message the daemon already handles that applies it. The chat's generic card and, in #93, the CLI share it.
import { createHash } from 'node:crypto';
import { backendOf, isArchived, LEDGE_GIVER, offers, pendingKey, riskOf, taskClosed, actionById, DETAIL_MAX, KERNEL_RIG, seatPlan, seatsByRole, type ActionErrorCode, type ActionId, type ChatAction, type ClientMessage, type Goal, type HumanAsk, type OpenRigAction, type OpenRigState, type PullRequest, type Session, type Task } from '@ledge/protocol';
import { isOmpSeat } from './omp/seats.js';
import { noteName } from '../brain/write.js';

export interface ResolveCtx {
  sessions: readonly Session[]; tasks: readonly Task[];
  /** The sessions the same answer closes (its close card): archived once closed, they count as ended for session.archive. */
  closing?: ReadonlySet<string>;
  /** This PC's OpenRig as last read (rig.act, rig.seats); none when the daemon has not read it: those rows are refused. */
  rigs?: OpenRigState;
  /** What the rigs ask the person (rig.answer, rig.goal.reply), Max's goals (rig.goal.reply) and the followed pull requests (pr.fix), as last read. */
  asks?: readonly HumanAsk[]; goals?: readonly Goal[]; prs?: readonly PullRequest[];
}
/** Why not: the daemon's words (the log, the PC's error) and a code for a front's own. */
/** `missing`: for `unknown`, what is gone (OpenRig, the rig, the role's seats), so a front names the right cause. */
export type Refusal = { refused: string; code: ActionErrorCode; missing?: RigMissing };
/** What an OpenRig row no longer finds: the front's words for `unknown` follow it (M3 Q34). */
export type RigMissing = 'openrig' | 'rig' | 'role';
export type Resolved = ChatAction | Refusal;
type Args = Record<string, unknown>;

/** A request Ledge may answer from the chat (spec §9.1): never a question (it takes a reply), never OMP's own dialogs. */
const DECIDABLE = ['permission', 'diff', 'plan'] as const;
const KIND: Record<(typeof DECIDABLE)[number], string> = { permission: 'permission', diff: 'diff', plan: 'plan' };

const no = (code: ActionErrorCode, refused: string, missing?: RigMissing): Refusal => ({ refused, code, ...(missing ? { missing } : {}) });
const isRefusal = (x: object): x is Refusal => 'refused' in x;
/** A session by id, or by bot name among those not ended (the archive included): refused when none or several fit. */
export function sessionOf(ref: string, ctx: Pick<ResolveCtx, 'sessions'>): Session | Refusal {
  const byId = ctx.sessions.find(s => s.id === ref);
  if (byId) return byId;
  const named = ctx.sessions.filter(s => s.name === ref);
  const live = named.filter(s => s.state !== 'exited');
  const pick = live.length ? live : named;
  if (pick.length === 1) return pick[0]!;
  return pick.length ? no('ambiguous', `several sessions named ${ref}`) : no('unknown', `unknown session ${ref}`);
}
function taskOf(ref: string, ctx: ResolveCtx): Task | Refusal {
  const t = ctx.tasks.find(x => x.id === ref);
  if (!t) return no('unknown', `unknown task ${ref}`);
  return taskClosed(t) ? no('closed', `task ${t.id} is closed`) : t;
}
/** A session Ledge can act on: tracked, writable, running. */
function writable(s: Session): Refusal | null {
  return s.source === 'hook_only' || isOmpSeat(s) ? no('read_only', `${s.name} is read-only`) : s.state === 'exited' ? no('exited', `${s.name} has exited`) : null;
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

/** A rig runs when OpenRig says so, or some of its seats do. */
const rigRuns = (r: OpenRigState['rigs'][number]) => r.status === 'running' || r.status === 'partial' || r.running > 0;
/** The longest `seats` var: the list of seats a step stops, in a phone's confirmation sheet (M3 Q35). */
const SEATS_VAR_MAX = 300;
/** The seats a step stops, each as its session without `@rig` (`dev-back`), with their count and how many did not fit. */
export function cutVars(rig: string, sessions: readonly string[]): Record<string, string> {
  if (sessions.length === 0) return {};
  const names = sessions.map(s => (s.endsWith(`@${rig}`) ? s.slice(0, -rig.length - 1) : s));
  const shown: string[] = []; let len = 0;
  for (const n of names) { const add = (shown.length ? 2 : 0) + n.length; if (len + add > SEATS_VAR_MAX) break; shown.push(n); len += add; }
  return { ...(shown.length ? { seats: shown.join(', ') } : {}), seatCount: String(names.length), ...(shown.length < names.length ? { seatsMore: String(names.length - shown.length) } : {}) };
}
/** Each kind's words up to its object, article included: French contracts « de le » into « du » (« Prendre un snapshot du rig »). */
const RIG_VERB: Record<string, string> = { start: 'Démarrer le', stop: 'Arrêter le', restart: 'Redémarrer le', snapshot: 'Prendre un snapshot du' };

/** An answer that starts a rig: the person's own yes to a team Max proposes (`confirm`, or `launch-rig`). */
const launches = (ask: HumanAsk, option: string): boolean => !!ask.team && (option === 'confirm' || option === 'launch-rig');
/** An id of the form OpenRig's goals take (8 to 64 letters, digits and dashes), the same for the same request: a retry sends the same row. */
const idFrom = (...parts: string[]): string => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);

const IMPLS: Partial<Record<ActionId, Impl>> = {
  // A rig's or the kernel's power, checked against OpenRig as last read: a start of what runs, or a stop of what does not, is refused.
  'rig.act': (a, ctx) => {
    const st = ctx.rigs;
    if (!st?.installed) return no('unknown', 'OpenRig is not on this machine', 'openrig');
    const kind = String(a.kind); const verb = RIG_VERB[kind.split('.')[1]!]!;
    if (kind.startsWith('kernel.')) {
      const runs = st.kernel.state === 'ready' || st.kernel.state === 'starting';
      if (kind === 'kernel.start' && runs) return no('running', 'the kernel already runs');
      if (kind !== 'kernel.start' && !runs) return no('not_running', 'the kernel does not run');
      // What a stop or a restart cuts, when this PC reads the kernel's seats.
      const k = kind === 'kernel.start' ? undefined : st.rigs.find(r => r.name === KERNEL_RIG);
      const cut = k?.nodes.map(n => n.session);
      return row('rig.act', { kind }, `${verb} kernel`, { kind, rig: KERNEL_RIG, ...(cut ? cutVars(KERNEL_RIG, cut) : {}) }, cut ? { cuts: cut } : {});
    }
    const rig = st.rigs.find(r => r.name === a.rig);
    if (!rig) return no('unknown', `unknown rig ${String(a.rig)}`, 'rig');
    if (kind === 'rig.start' && rigRuns(rig)) return no('running', `${rig.name} already runs`);
    if ((kind === 'rig.stop' || kind === 'rig.restart') && !rigRuns(rig)) return no('not_running', `${rig.name} does not run`);
    const cut = kind === 'rig.stop' || kind === 'rig.restart' ? rig.nodes.map(n => n.session) : undefined;
    return row('rig.act', { kind, rig: rig.name }, `${verb} rig ${b(rig.name)}`, { kind, rig: rig.name, ...(cut ? cutVars(rig.name, cut) : {}) }, cut ? { cuts: cut } : {});
  },
  // A role's seats, as the Rigs screen changes them: removing one stops its agent, so that row is destructive.
  'rig.seats': (a, ctx) => {
    if (!ctx.rigs?.installed) return no('unknown', 'OpenRig is not on this machine', 'openrig');
    const rig = ctx.rigs.rigs.find(r => r.name === a.rig);
    if (!rig) return no('unknown', `unknown rig ${String(a.rig)}`, 'rig');
    if (!rigRuns(rig)) return no('not_running', `${rig.name} does not run`);
    const role = String(a.role); const count = Number(a.count);
    const now = seatsByRole(rig.nodes).get(role)?.length ?? 0;
    if (now === 0) return no('unknown', `${rig.name} has no ${role} seat`, 'role');
    if (now === count) return no('unchanged', `${rig.name} already has ${count} ${role} seat(s)`);
    const removed = seatPlan(rig.nodes, { [role]: count }).remove;
    // The seats OpenRig removes are the role's last ones: their sessions, for the sheet's « … s'arrêtent ».
    const cut = removed.map(id => rig.nodes.find(n => n.logicalId === id)?.session ?? id);
    return row('rig.seats', { rig: rig.name, role, count }, `Passer ${b(role)} de ${b(rig.name)} de ${now} à ${count} siège${count > 1 ? 's' : ''}`,
      { rig: rig.name, role, count: String(count), from: String(now), ...cutVars(rig.name, cut) }, cut.length ? { risk: 'destructive', cuts: cut } : {});
  },
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
  'session.resume': (a, ctx) => withSession(ctx, a.session, s => (s.source === 'hook_only' ? no('read_only', `${s.name} is read-only`) : s.source === 'rig' ? no('read_only', `${s.name} is an OpenRig seat: restart it from OpenRig`) : s.state !== 'exited' ? no('running', `${s.name} is still running`) : null),
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
  'task.cancel': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    const reason = a.reason as string | undefined;
    return row('task.cancel', { task: t.id, ...(reason ? { reason } : {}) }, `Annuler la tâche « ${title(t)} » de ${b(t.ownerName)}`,
      { task: t.title, owner: t.ownerName, reason }, { session: t.owner });
  },
  // The user's own answer to a decision a session put to it: shown whole on the card, never Ledge's choice.
  'task.answer': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    if (t.owner !== LEDGE_GIVER) return no('not_decision', `task ${t.id} is not a decision put to the user`);
    const answer = String(a.answer);
    return row('task.answer', { task: t.id, answer }, `Répondre à la décision « ${title(t)} » de ${b(t.giverName)}`,
      { task: t.title, session: t.giverName, answer }, { session: t.giver, ...detailOf(answer) });
  },
  'note.add': a => {
    const note = noteName(String(a.note));
    if (!note) return no('unknown', `unknown note ${String(a.note)}`);
    const fact = String(a.fact);
    return row('note.add', { note, fact, ...(a.source ? { source: String(a.source) } : {}) }, `Ajouter à la note ${b(note)}`, { note, fact }, detailOf(fact));
  },
  'task.pass': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    return withSession(ctx, a.to, s => writable(s) ?? (s.id === t.owner ? no('holder', `${s.name} already holds it`) : null), s => {
      const note = a.note as string | undefined;
      return row('task.pass', { task: t.id, to: s.id, ...(note ? { note } : {}) }, `Passer la tâche « ${title(t)} » de ${b(t.ownerName)} à ${b(s.name)}`,
        { task: t.title, owner: t.ownerName, session: s.name, note }, { session: s.id });
    });
  },
  // An open ask of the rigs, answered as « À toi » does (human.answer): the option's question is found here, since the handler wants it.
  'rig.answer': (a, ctx) => {
    const ask = ctx.asks?.find(x => x.id === a.qitem);
    if (!ask) return no('closed', `${String(a.qitem)} is not an open ask`);
    const ans = a.answer as { option?: string; text?: string; seen?: true };
    const from = ask.from.seat;
    if (ans.seen) {
      if (ask.kind !== 'update') return no('not_decision', `${ask.id} is not a piece of news`);
      return row('rig.answer', { qitem: ask.id, answer: { seen: true } }, `Marquer comme vue la nouvelle de ${b(from)}`, { ask: ask.summary, seat: from }, { detail: ask.summary });
    }
    if (ans.text !== undefined) {
      if (ask.kind === 'update') return no('not_decision', `${ask.id} is news: it is marked seen, not answered`);
      return row('rig.answer', { qitem: ask.id, answer: { text: ans.text, ...(ask.kind === 'parked' ? { parked: true } : {}) } },
        `Répondre à ${b(from)} : « ${fit(ans.text, 100)} »`, { ask: ask.summary, seat: from, answer: ans.text }, detailOf(ans.text));
    }
    const option = String(ans.option);
    const q = ask.questions.find(x => x.answer === null && x.options.some(o => o.id === option));
    if (!q) return no('unknown', `${ask.id} offers no open option ${option}`);
    const label = q.options.find(o => o.id === option)!.label;
    return row('rig.answer', { qitem: ask.id, answer: { option, question: q.id } }, `Répondre « ${fit(label, 100)} » à ${b(from)}`, { ask: ask.summary, seat: from, option: label },
      { risk: launches(ask, option) ? 'destructive' : 'reversible' });
  },
  // A goal for Max: the card's id is derived from the request, so a retry never makes a second row.
  'rig.goal': (a, ctx) => {
    if (ctx.rigs && !ctx.rigs.installed) return no('unknown', 'OpenRig is not on this machine', 'openrig');
    const text = String(a.text); const folder = a.folder as string | undefined;
    return row('rig.goal', { text, ...(folder ? { folder } : {}) }, `Donner un objectif à Max${folder ? ` dans ${b(folder)}` : ''}`, { folder }, detailOf(text));
  },
  'rig.goal.reply': (a, ctx) => {
    const g = ctx.goals?.find(x => x.goalId === a.goal || x.qitemId === a.goal);
    if (!g) return no('unknown', `unknown goal ${String(a.goal)}`);
    if (g.state === 'done' || g.state === 'closed') return no('closed', `goal ${g.goalId} is ${g.state}`);
    if (typeof a.answer === 'object') {
      const text = String((a.answer as { text: string }).text);
      return row('rig.goal.reply', { goal: g.goalId, answer: { text } }, `Écrire à Max au sujet de l'objectif « ${fit(g.text, 100)} »`, { goal: g.text, answer: text }, detailOf(text));
    }
    // A confirmation is the answer to Max's open team proposal for the goal, never a message of its own.
    const ask = ctx.asks?.find(x => x.goalId === g.goalId && x.team);
    const q = ask?.questions.find(x => x.answer === null && x.options.some(o => o.id === 'confirm'));
    if (!ask || !q) return no('no_request', `goal ${g.goalId} has no team proposal to confirm`);
    return row('rig.goal.reply', { goal: g.goalId, answer: 'confirm', qitem: ask.id, question: q.id }, `Confirmer l'équipe ${b(ask.team!.rig)} pour l'objectif « ${fit(g.text, 100)} »`,
      { goal: g.text, rig: ask.team!.rig }, { risk: launches(ask, 'confirm') ? 'destructive' : 'reversible' });
  },
  // A seat's session, written to as the seat tab does (a reply in its thread).
  'rig.send': (a, ctx) => {
    if (!ctx.rigs?.installed) return no('unknown', 'OpenRig is not on this machine', 'openrig');
    const rig = ctx.rigs.rigs.find(r => r.name === a.rig);
    if (!rig) return no('unknown', `unknown rig ${String(a.rig)}`, 'rig');
    const node = rig.nodes.find(n => n.logicalId === a.seat || n.session === a.seat);
    if (!node) return no('unknown', `${rig.name} has no seat ${String(a.seat)}`, 'role');
    if (node.stopped) return no('not_running', `${node.logicalId} of ${rig.name} is stopped`);
    const s = ctx.sessions.find(x => x.state !== 'exited' && (x.tmuxSession === node.session || x.name === node.session || x.id === node.session));
    if (!s) return no('unknown', `the seat ${node.logicalId} has no session`);
    const text = String(a.text);
    return writable(s) ?? row('rig.send', { rig: rig.name, seat: node.logicalId, text, session: s.id }, `Écrire à ${b(node.logicalId)} de ${b(rig.name)}`, { rig: rig.name, seat: node.logicalId, text }, { session: s.id, ...detailOf(text) });
  },
  'brain.answer': (a, ctx) => {
    const t = taskOf(String(a.task), ctx);
    if (isRefusal(t)) return t;
    if (!t.brain || t.owner !== LEDGE_GIVER) return no('not_decision', `task ${t.id} is not a note proposal`);
    const choice = a.choice as 'add' | 'refuse' | { edit: string };
    const what = choice === 'add' ? 'Ajouter' : choice === 'refuse' ? 'Refuser' : 'Ajouter, corrigée,';
    return row('brain.answer', { task: t.id, choice }, `${what} la proposition de note « ${title(t)} »`, { task: t.title, choice: typeof choice === 'string' ? choice : 'edit' },
      typeof choice === 'object' ? detailOf(choice.edit) : {});
  },
  'session.handover': (a, ctx) => withSession(ctx, a.session, s => (s.state === 'exited' || isArchived(s) ? no('exited', `${s.name} has exited`) : s.source !== 'launcher' ? no('read_only', `${s.name} was not launched by Ledge`) : null),
    s => row('session.handover', { session: s.id }, `Passer le relais de ${b(s.name)}`, { session: s.name }, { session: s.id })),
  // « Demander à X de corriger »: the same words as the Desktop's and the phone's, to the branch's most active session.
  'pr.fix': (a, ctx) => {
    const pr = ctx.prs?.find(p => p.id === a.pr);
    if (!pr) return no('unknown', `${String(a.pr)} is not a followed pull request`);
    if (pr.state === 'merged' || pr.state === 'closed') return no('closed', `${pr.ref} is ${pr.state}`);
    if (pr.pipeline !== 'fail') return no('no_request', `the pipeline of ${pr.ref} does not fail`);
    const ref = a.session as string | undefined;
    const target = ref ? sessionOf(ref, ctx) : pr.sessions.map(id => ctx.sessions.find(x => x.id === id && x.state !== 'exited')).find(Boolean) ?? no('unknown', `no session on ${pr.branch}`);
    if (isRefusal(target)) return target;
    return writable(target) ?? row('pr.fix', { pr: pr.id, session: target.id, text: `Le pipeline de ${pr.ref} échoue. Lis les jobs en échec, corrige et pousse.` }, `Demander à ${b(target.name)} de corriger ${b(pr.ref)}`, { pr: pr.ref, session: target.name }, { session: target.id });
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

const AGENT_REFUSED = 'une session agent ne peut que se fermer elle-même. Le reste, demande-le à l\'utilisateur (il le lance lui-même, avec --yes si c\'est irréversible)';

/**
 * Who may run what outside the chat (#93, point (a), decided by the user on 2026-10-26, option 4), from the row as resolved
 * (action, ids), and the session that asks (`by`, left out for the user); the rule lives here alone.
 * The user runs anything. A session closes itself; nothing else. Null when allowed, else the reason.
 */
export function runGuard(row: Pick<ChatAction, 'action' | 'session'>, by: string | undefined): string | null {
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
export function actionMessage(r: Pick<ChatAction, 'action' | 'args'>, rid: string): ClientMessage {
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
    case 'task.cancel': return { type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'cancel', task: String(a.task), ...(a.reason ? { text: String(a.reason) } : {}) };
    case 'task.answer': return { type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'done', task: String(a.task), text: String(a.answer) };
    case 'note.add': return { type: 'brain.add', rid, note: String(a.note), fact: String(a.fact), ...(a.source ? { source: String(a.source) } : {}) };
    case 'task.pass': return { type: 'task.cmd', rid, by: LEDGE_GIVER, op: 'pass', task: String(a.task), to: String(a.to), ...(a.note ? { text: String(a.note) } : {}) };
    case 'rig.act': return { type: 'openrig.act', requestId: rid, action: (a.rig !== undefined ? { kind: a.kind, rig: a.rig } : { kind: a.kind }) as OpenRigAction };
    case 'rig.seats': return { type: 'openrig.seats', requestId: rid, rig: String(a.rig), seats: { [String(a.role)]: Number(a.count) } };
    case 'rig.answer': {
      const ans = a.answer as { option?: string; question?: string; text?: string; parked?: true; seen?: true };
      const answer = ans.seen ? { kind: 'seen' as const } : ans.text !== undefined ? { kind: ans.parked ? 'resolve' as const : 'words' as const, text: ans.text }
        : { kind: 'choice' as const, questionId: String(ans.question), optionId: String(ans.option) };
      return { type: 'openrig.answer', requestId: rid, qitemId: String(a.qitem), answer };
    }
    case 'rig.goal': return { type: 'openrig.goal.send', requestId: rid, goalId: idFrom(rid, String(a.text), String(a.folder ?? '')), text: String(a.text), ...(a.folder ? { folder: String(a.folder) } : {}) };
    case 'rig.goal.reply': return a.answer === 'confirm'
      ? { type: 'openrig.answer', requestId: rid, qitemId: String(a.qitem), answer: { kind: 'choice', questionId: String(a.question), optionId: 'confirm' } }
      : { type: 'openrig.goal.reply', requestId: rid, goalId: String(a.goal), replyId: idFrom(rid, String(a.goal), String((a.answer as { text: string }).text)), text: String((a.answer as { text: string }).text) };
    case 'rig.send': return { type: 'session.reply', id: String(a.session), text: String(a.text) };
    case 'brain.answer': {
      const c = a.choice as 'add' | 'refuse' | { edit: string };
      return { type: 'brain.answer', rid, task: String(a.task), choice: c === 'add' ? { yes: true } : c === 'refuse' ? { yes: false } : { yes: true, text: c.edit } };
    }
    case 'session.handover': return { type: 'session.handover', rid, id: s };
    case 'pr.fix': return { type: 'session.reply', id: s, text: String(a.text) };
    default: throw new Error(`${r.action} is not a generic action`);
  }
}
