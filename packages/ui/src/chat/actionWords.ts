import type { ActionErrorCode } from '@ledge/protocol';

/** A row's words as the daemon gives them (`ChatAction.vars`, chat.ts): names, the model, . */
export type ActionVars = Readonly<Record<string, string>>;

/** The generic card's sentences (#94) a front builds from a row's `vars`, in its own language: the Desktop and the island
 *  share them (docs/mockups/ledge-action-card-codes.md; they say « tu »). The phone will have its own, which say « vous ». */
export interface ActionWords {
  /** A row's line by its registry id, names in **bold**; `undefined` when a word it needs is missing: the daemon's summary then. */
  line: Record<string, (v: ActionVars) => string | undefined>;
  /** Why a row was refused or failed, by its code: `undefined` (no code) or a word missing reads as « no longer possible ». */
  why: (code: ActionErrorCode | undefined, action: string | undefined, v: ActionVars) => string;
  /** A permission's request, by its kind (`vars.kind`): the line above the request quoted. */
  kind: Record<string, string>;
  /** A request too long to be quoted whole (`detailCut`): the mark at the foot of its quote, and why it is not accepted here. */
  cut: { mark: string; note: (name: string) => string };
}

const b = (name: string) => `**${name}**`;
/** A title quoted in a line, as the daemon's summary shortens it. */
const short = (text: string) => (text.length <= 100 ? text : `${text.slice(0, 99)}…`);
/** The line when every word it names is there. */
const need = <K extends string>(v: ActionVars, keys: readonly K[], say: (w: Record<K, string>) => string) =>
  (keys.every(k => v[k]) ? say(v as Record<K, string>) : undefined);
const fr: ActionWords = {
  line: {
    'session.model': v => need(v, ['session'], w => `Passer ${b(w.session)} sur ${v.model ? `${v.model}${v.effort ? `, effort ${v.effort}` : ''}` : v.effort ? `son modèle par défaut, effort ${v.effort}` : 'son modèle et son effort par défaut'}`),
    'session.interrupt': v => need(v, ['session'], w => `Interrompre ${b(w.session)}`),
    'session.archive': v => need(v, ['session'], w => `Archiver ${b(w.session)}`),
    'session.restore': v => need(v, ['session'], w => `Sortir ${b(w.session)} de l’archive`),
    'session.resume': v => need(v, ['session'], w => `Reprendre ${b(w.session)} sur sa conversation`),
    'session.close': v => need(v, ['session'], w => `Fermer ${b(w.session)}`),
    'session.decide': v => need(v, ['session', 'decision', 'kind'], w => `${w.decision === 'deny' ? 'Refuser' : 'Accepter'} la demande de ${w.kind} de ${b(w.session)}${v.note ? ', avec une note' : ''}`),
  },
  why: (code, action, v) => {
    const s = v.session ? b(v.session) : undefined;
    const gone = 'cette action n’est plus possible.';
    switch (code) {
      case 'unknown': return s ? `Ledge ne trouve plus ${s}.` : gone;
      case 'ambiguous': return s ? `plusieurs sessions s’appellent ${s} : redemande à Ledge en précisant laquelle.` : gone;
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
      case 'changed': return 'la situation a changé depuis ma réponse : redemande-moi.';
      case 'failed': return 'l’action est partie, mais n’a pas abouti.';
      default: return gone;
    }
  },
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
  },
  why: (code, action, v) => {
    const s = v.session ? b(v.session) : undefined;
    const gone = 'this action is no longer possible.';
    switch (code) {
      case 'unknown': return s ? `Ledge can no longer find ${s}.` : gone;
      case 'ambiguous': return s ? `several sessions are called ${s}: ask Ledge again and say which one.` : gone;
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
      case 'changed': return 'things have changed since my answer: ask me again.';
      case 'failed': return 'the action was sent but did not go through.';
      default: return gone;
    }
  },
  kind: { permission: 'Permission', diff: 'Changes', plan: 'Plan' },
  cut: { mark: '… (truncated, see the session)', note: name => `Too long to be quoted in full: read it in ${name} to accept it. You can deny it from here.` }
};

export const actionWords = { fr, en } as const;
