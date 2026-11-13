import type { ActionErrorCode } from '@ledge/protocol';

/** A row's words as the daemon gives them (`ChatAction.vars`, chat.ts): names, the model, a task's title. */
export type ActionVars = Readonly<Record<string, string>>;

/** The generic card's sentences (#94) a front builds from a row's `vars`, in its own language: the Desktop and the island
 *  share them (docs/mockups/ledge-action-card-codes.md; they say « tu »). The phone adds a few of its own (apps/mobile/src/copy.ts), in « tu » as well. */
export interface ActionWords {
  /** A row's line by its registry id, names in **bold**; `undefined` when a word it needs is missing: the daemon's summary then. */
  line: Record<string, (v: ActionVars) => string | undefined>;
  /** Why a row was refused or failed, by its code: `undefined` (no code) or a word missing reads as « no longer possible ». */
  why: (code: ActionErrorCode | undefined, action: string | undefined, v: ActionVars) => string;
  /** A row's button when it says more than its action's verb (M3 Q34: an OpenRig row's button is its line's verb);
   *  `undefined`: the action's verb (`verbs`). */
  verb: (action: string | undefined, v: ActionVars) => string | undefined;
  /** A permission's request, by its kind (`vars.kind`): the line above the request quoted. */
  kind: Record<string, string>;
  /** A request too long to be quoted whole (`detailCut`): the mark at the foot of its quote, and why it is not accepted here. */
  cut: { mark: string; note: (name: string) => string };
}

const b = (name: string) => `**${name}**`;
/** A title quoted in a line, as the daemon's summary shortens it. */
const short = (text: string) => (text.length <= 100 ? text : `${text.slice(0, 99)}…`);
/** The line when every word it names is there (and `say` knows them: an unknown kind is the daemon's summary too). */
const need = <K extends string>(v: ActionVars, keys: readonly K[], say: (w: Record<K, string>) => string | undefined) =>
  (keys.every(k => v[k]) ? say(v as Record<K, string>) : undefined);
/** OpenRig's kernel, as `rig.act` names it (`vars.rig`). */
const KERNEL = 'kernel';
/** A role's seat change: how many, and whether it adds or removes (M3 Q34); `undefined` when a number is missing. */
const seatChange = (v: ActionVars) => {
  const from = Number(v.from), count = Number(v.count);
  return v.from && v.count && Number.isInteger(from) && Number.isInteger(count) && from !== count ? { from, count, n: Math.abs(count - from), add: count > from } : undefined;
};

/** Which verb an OpenRig row's button carries (M3 Q34): its kind's, or adding or removing seats; none when a word is missing. */
const rigVerb = (action: string | undefined, v: ActionVars): string | undefined => {
  if (action === 'rig.act') return v.kind?.split('.')[1];
  if (action === 'rig.seats') { const c = seatChange(v); return c ? (c.add ? 'add' : 'remove') : undefined; }
  return undefined;
};

/** Which target a code speaks of: the action's own kind first, then whatever the row names. */
const about = (action: string | undefined, v: ActionVars): 'session' | 'task' | null =>
  action?.startsWith('task.') && v.task ? 'task' : v.session ? 'session' : v.task ? 'task' : null;

const fr: ActionWords = {
  line: {
    'session.model': v => need(v, ['session'], w => `Passer ${b(w.session)} sur ${v.model ? `${v.model}${v.effort ? `, effort ${v.effort}` : ''}` : v.effort ? `son modèle par défaut, effort ${v.effort}` : 'son modèle et son effort par défaut'}`),
    'session.interrupt': v => need(v, ['session'], w => `Interrompre ${b(w.session)}`),
    'session.archive': v => need(v, ['session'], w => `Archiver ${b(w.session)}`),
    'session.restore': v => need(v, ['session'], w => `Sortir ${b(w.session)} de l’archive`),
    'session.resume': v => need(v, ['session'], w => `Reprendre ${b(w.session)} sur sa conversation`),
    'session.close': v => need(v, ['session'], w => `Fermer ${b(w.session)}`),
    'session.decide': v => need(v, ['session', 'decision', 'kind'], w => `${w.decision === 'deny' ? 'Refuser' : 'Accepter'} la demande de ${w.kind} de ${b(w.session)}${v.note ? ', avec une note' : ''}`),
    'task.cancel': v => need(v, ['task', 'owner'], w => `Annuler la tâche « ${short(w.task)} » de ${b(w.owner)}`),
    'task.pass': v => need(v, ['task', 'owner', 'session'], w => `Passer la tâche « ${short(w.task)} » de ${b(w.owner)} à ${b(w.session)}`),
    'task.answer': v => need(v, ['task', 'session'], w => `Répondre à la décision « ${short(w.task)} » de ${b(w.session)}`),
    'note.add': v => need(v, ['note'], w => `Ajouter à la note ${b(w.note)}`),
    'rig.answer': v => need(v, ['seat'], w => (v.option ? `Répondre « ${short(v.option)} » à ${b(w.seat)}` : v.answer ? `Répondre à ${b(w.seat)} : « ${short(v.answer)} »` : `Marquer comme vue la nouvelle de ${b(w.seat)}`)),
    'rig.goal': () => (`Donner un objectif à Max`),
    'rig.goal.reply': v => need(v, ['goal'], w => (v.rig ? `Confirmer l’équipe ${b(v.rig)} pour l’objectif « ${short(w.goal)} »` : `Écrire à Max au sujet de l’objectif « ${short(w.goal)} »`)),
    'rig.send': v => need(v, ['rig', 'seat'], w => `Écrire à ${b(w.seat)} de ${b(w.rig)}`),
    'brain.answer': v => need(v, ['task'], w => `${v.choice === 'refuse' ? 'Refuser' : v.choice === 'edit' ? 'Ajouter, corrigée,' : 'Ajouter'} la proposition de note « ${short(w.task)} »`),
    'session.handover': v => need(v, ['session'], w => `Passer le relais de ${b(w.session)}`),
    'pr.fix': v => need(v, ['pr', 'session'], w => `Demander à ${b(w.session)} de corriger ${b(w.pr)}`),
    'rig.act': v => need(v, ['kind', 'rig'], w => {
      const verb = ({ start: 'Démarrer', stop: 'Arrêter', restart: 'Redémarrer' } as Record<string, string>)[w.kind.split('.')[1]!];
      if (w.kind.startsWith('kernel.')) return verb ? `${verb} le kernel` : undefined;
      if (w.kind === 'rig.snapshot') return `Prendre un snapshot du rig ${b(w.rig)}`;
      return verb ? `${verb} le rig ${b(w.rig)}` : undefined;
    }),
    'rig.seats': v => need(v, ['rig', 'role'], w => {
      const c = seatChange(v);
      if (!c) return undefined;
      const span = `(${c.from} → ${c.count})`;
      if (c.add) return `Ajouter ${c.n} ${c.n > 1 ? 'sièges' : 'siège'} ${b(w.role)} à ${b(w.rig)} ${span}`;
      return c.count === 0 ? `Retirer tous les sièges ${b(w.role)} de ${b(w.rig)} ${span}` : `Retirer ${c.n} ${c.n > 1 ? 'sièges' : 'siège'} ${b(w.role)} de ${b(w.rig)} ${span}`;
    })
  },
  why: (code, action, v) => {
    const s = v.session ? b(v.session) : undefined, k = v.task ? `« ${short(v.task)} »` : undefined;
    const gone = 'cette action n’est plus possible.';
    if (action === 'rig.act' || action === 'rig.seats') {
      const r = v.rig === KERNEL && action === 'rig.act' ? 'le kernel' : v.rig ? b(v.rig) : undefined;
      switch (code) {
        case 'not_running': return r ? `${r} ne tourne pas.` : gone;
        case 'running': return r ? `${r} tourne déjà.` : gone;
        case 'unchanged': { const n = Number(v.count); return r && v.role && v.count ? `${r} a déjà ${n} ${n > 1 ? 'sièges' : 'siège'} ${b(v.role)}.` : gone; }
        // The cause the PC names (`missing`); none (an older PC): no cause is claimed.
        case 'unknown': return v.missing === 'openrig' ? 'OpenRig n’est pas sur ce PC.'
          : v.missing === 'rig' && v.rig && v.rig !== KERNEL ? `Ledge ne trouve plus le rig ${b(v.rig)}.`
          : v.missing === 'role' && v.rig && v.role ? `${b(v.rig)} n’a pas de siège ${b(v.role)}.` : gone;
      }
    }
    switch (code) {
      case 'unknown': { const on = about(action, v); return on === 'task' ? `Ledge ne trouve plus la tâche ${k}.` : on === 'session' ? `Ledge ne trouve plus ${s}.` : gone; }
      case 'ambiguous': { const on = about(action, v); return on === 'session' ? `plusieurs sessions s’appellent ${s} : redemande à Ledge en précisant laquelle.` : gone; }
      case 'read_only': return s ? `${s} est en lecture seule : Ledge ne peut pas lui écrire.` : gone;
      case 'exited': return s ? `${s} ne tourne plus.` : gone;
      case 'running': return !s ? gone : action === 'session.resume' ? `${s} tourne déjà : rien à reprendre.` : `${s} tourne encore : il faut d’abord fermer sa session.`;
      case 'archived': return s ? `${s} est déjà dans l’archive.` : gone;
      case 'not_archived': return s ? `${s} n’est pas dans l’archive : rien à en sortir.` : gone;
      case 'no_terminal': return s ? `${s} n’a pas de terminal : Ledge ne peut pas l’interrompre.` : gone;
      case 'same_model': return s ? `${s} tourne déjà sur ce modèle, avec cet effort.` : gone;
      case 'no_request': return s ? `${s} n’attend plus de réponse : la demande a été réglée entre-temps.` : gone;
      case 'in_session': return s ? `les demandes de ${s} se règlent dans sa session.` : gone;
      case 'no_note': return s ? `${s} ne peut pas recevoir de note avec cette réponse.` : gone;
      case 'closed': return k ? `la tâche ${k} est déjà close.` : gone;
      case 'holder': return s && k ? `${s} tient déjà la tâche ${k}.` : gone;
      case 'not_decision': return k ? `la tâche ${k} n’est pas une décision qui t’est posée.` : gone;
      case 'changed': return 'la situation a changé depuis ma réponse : redemande-moi.';
      case 'failed': return 'l’action est partie, mais n’a pas abouti.';
      default: return gone;
    }
  },
  verb: (action, v) => ({ start: 'Démarrer', stop: 'Arrêter', restart: 'Redémarrer', snapshot: 'Prendre le snapshot', add: 'Ajouter', remove: 'Retirer' } as Record<string, string>)[rigVerb(action, v) ?? ''],
  kind: { permission: 'Permission', diff: 'Modifications', plan: 'Plan' },
  cut: { mark: '… (tronqué, voir la session)', note: name => `Trop longue pour être citée en entier : lis-la dans ${name} pour l’accepter. Tu peux la refuser d’ici.` }
};

const en: ActionWords = {
  line: {
    'session.model': v => need(v, ['session'], w => `Switch ${b(w.session)} to ${v.model ? `${v.model}${v.effort ? `, effort ${v.effort}` : ''}` : v.effort ? `its default model, effort ${v.effort}` : 'its default model and effort'}`),
    'session.interrupt': v => need(v, ['session'], w => `Interrupt ${b(w.session)}`),
    'session.archive': v => need(v, ['session'], w => `Archive ${b(w.session)}`),
    'session.restore': v => need(v, ['session'], w => `Restore ${b(w.session)} from the archive`),
    'session.resume': v => need(v, ['session'], w => `Resume ${b(w.session)} on its conversation`),
    'session.close': v => need(v, ['session'], w => `Close ${b(w.session)}`),
    'session.decide': v => need(v, ['session', 'decision', 'kind'], w => `${w.decision === 'deny' ? 'Deny' : 'Accept'} ${b(w.session)}’s ${w.kind} request${v.note ? ', with a note' : ''}`),
    'task.cancel': v => need(v, ['task', 'owner'], w => `Cancel ${b(w.owner)}’s task “${short(w.task)}”`),
    'task.pass': v => need(v, ['task', 'owner', 'session'], w => `Pass ${b(w.owner)}’s task “${short(w.task)}” to ${b(w.session)}`),
    'task.answer': v => need(v, ['task', 'session'], w => `Answer ${b(w.session)}’s decision “${short(w.task)}”`),
    'note.add': v => need(v, ['note'], w => `Add to the note ${b(w.note)}`),
    'rig.answer': v => need(v, ['seat'], w => (v.option ? `Answer “${short(v.option)}” to ${b(w.seat)}` : v.answer ? `Answer ${b(w.seat)}: “${short(v.answer)}”` : `Mark ${b(w.seat)}’s news as seen`)),
    'rig.goal': () => (`Give Max a goal`),
    'rig.goal.reply': v => need(v, ['goal'], w => (v.rig ? `Confirm the team ${b(v.rig)} for the goal “${short(w.goal)}”` : `Write to Max about the goal “${short(w.goal)}”`)),
    'rig.send': v => need(v, ['rig', 'seat'], w => `Write to ${b(w.seat)} of ${b(w.rig)}`),
    'brain.answer': v => need(v, ['task'], w => `${v.choice === 'refuse' ? 'Refuse' : v.choice === 'edit' ? 'Add, corrected,' : 'Add'} the note proposal “${short(w.task)}”`),
    'session.handover': v => need(v, ['session'], w => `Hand over ${b(w.session)}`),
    'pr.fix': v => need(v, ['pr', 'session'], w => `Ask ${b(w.session)} to fix ${b(w.pr)}`),
    'rig.act': v => need(v, ['kind', 'rig'], w => {
      const verb = ({ start: 'Start', stop: 'Stop', restart: 'Restart' } as Record<string, string>)[w.kind.split('.')[1]!];
      if (w.kind.startsWith('kernel.')) return verb ? `${verb} the kernel` : undefined;
      if (w.kind === 'rig.snapshot') return `Take a snapshot of the rig ${b(w.rig)}`;
      return verb ? `${verb} the rig ${b(w.rig)}` : undefined;
    }),
    'rig.seats': v => need(v, ['rig', 'role'], w => {
      const c = seatChange(v);
      if (!c) return undefined;
      const span = `(${c.from} → ${c.count})`;
      if (c.add) return `Add ${c.n} ${b(w.role)} ${c.n > 1 ? 'seats' : 'seat'} to ${b(w.rig)} ${span}`;
      return c.count === 0 ? `Remove every ${b(w.role)} seat from ${b(w.rig)} ${span}` : `Remove ${c.n} ${b(w.role)} ${c.n > 1 ? 'seats' : 'seat'} from ${b(w.rig)} ${span}`;
    })
  },
  why: (code, action, v) => {
    const s = v.session ? b(v.session) : undefined, k = v.task ? `“${short(v.task)}”` : undefined;
    const gone = 'this action is no longer possible.';
    if (action === 'rig.act' || action === 'rig.seats') {
      const r = v.rig === KERNEL && action === 'rig.act' ? 'the kernel' : v.rig ? b(v.rig) : undefined;
      switch (code) {
        case 'not_running': return r ? `${r} is not running.` : gone;
        case 'running': return r ? `${r} is already running.` : gone;
        case 'unchanged': { const n = Number(v.count); return r && v.role && v.count ? `${r} already has ${n} ${b(v.role)} ${n > 1 ? 'seats' : 'seat'}.` : gone; }
        case 'unknown': return v.missing === 'openrig' ? 'OpenRig is not on this PC.'
          : v.missing === 'rig' && v.rig && v.rig !== KERNEL ? `Ledge can no longer find the rig ${b(v.rig)}.`
          : v.missing === 'role' && v.rig && v.role ? `${b(v.rig)} has no ${b(v.role)} seat.` : gone;
      }
    }
    switch (code) {
      case 'unknown': { const on = about(action, v); return on === 'task' ? `Ledge can no longer find the task ${k}.` : on === 'session' ? `Ledge can no longer find ${s}.` : gone; }
      case 'ambiguous': { const on = about(action, v); return on === 'session' ? `several sessions are called ${s}: ask Ledge again and say which one.` : gone; }
      case 'read_only': return s ? `${s} is read-only: Ledge cannot write to it.` : gone;
      case 'exited': return s ? `${s} is no longer running.` : gone;
      case 'running': return !s ? gone : action === 'session.resume' ? `${s} is already running: nothing to resume.` : `${s} is still running: its session has to be closed first.`;
      case 'archived': return s ? `${s} is already archived.` : gone;
      case 'not_archived': return s ? `${s} is not archived: nothing to restore.` : gone;
      case 'no_terminal': return s ? `${s} has no terminal: Ledge cannot interrupt it.` : gone;
      case 'same_model': return s ? `${s} already runs this model, at this effort.` : gone;
      case 'no_request': return s ? `${s} is no longer waiting for an answer: the request was settled in the meantime.` : gone;
      case 'in_session': return s ? `${s}’s requests are answered in its session.` : gone;
      case 'no_note': return s ? `${s} cannot take a note with this answer.` : gone;
      case 'closed': return k ? `the task ${k} is already closed.` : gone;
      case 'holder': return s && k ? `${s} already holds the task ${k}.` : gone;
      case 'not_decision': return k ? `the task ${k} is not a decision put to you.` : gone;
      case 'changed': return 'things have changed since my answer: ask me again.';
      case 'failed': return 'the action was sent but did not go through.';
      default: return gone;
    }
  },
  verb: (action, v) => ({ start: 'Start', stop: 'Stop', restart: 'Restart', snapshot: 'Take the snapshot', add: 'Add', remove: 'Remove' } as Record<string, string>)[rigVerb(action, v) ?? ''],
  kind: { permission: 'Permission', diff: 'Changes', plan: 'Plan' },
  cut: { mark: '… (truncated, see the session)', note: name => `Too long to be quoted in full: read it in ${name} to accept it. You can deny it from here.` }
};

export const actionWords = { fr, en } as const;
