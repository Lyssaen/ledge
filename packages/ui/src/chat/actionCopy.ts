import { actionWords } from './actionWords';
import type { ActionCopy } from './copy';

// The generic card's words (#94, docs/mockups/ledge-action-card.html), once for every front on the PC that says « tu »: the
// Desktop, the island and the TUI. The rows' lines and refusals are actionWords'; the phone has its own (« vous »).

const fr: ActionCopy = {
  label: (n: number) => n > 1 ? `Plan de ${n} actions` : 'Action proposée',
  risk: { read: 'Lecture', reversible: 'Réversible', destructive: 'Irréversible' },
  riskTip: { read: 'rien ne change', reversible: 'Ledge peut le défaire', destructive: 'Ledge ne peut pas le défaire' },
  step: (k: number) => `Étape ${k}`,
  stepState: { done: (k: number) => `Étape ${k}, appliquée`, failed: (k: number) => `Étape ${k}, échouée`, refused: (k: number) => `Étape ${k}, refusée`, running: (k: number) => `Étape ${k}, en cours` },
  askAgain: 'je te redemanderai',
  verbs: {
    'session.model': 'Changer', 'session.interrupt': 'Interrompre', 'session.archive': 'Archiver', 'session.restore': 'Restaurer', 'session.resume': 'Reprendre',
    'session.decide': 'Accepter', 'team.join': 'Ajouter', 'team.leave': 'Retirer', 'team.resume': 'Reprendre', 'team.dissolve': 'Dissoudre', 'team.save': 'Enregistrer',
    'task.cancel': 'Abandonner', 'task.pass': 'Passer le relais', 'task.answer': 'Répondre'
  } as Record<string, string>,
  apply: 'Appliquer', deny: 'Refuser', ignore: 'Ignorer', review: 'Revoir', retry: 'Réessayer', running: 'En cours…',
  done: (at: string) => `Appliquée${at ? ` · ${at}` : ''}`, refusedState: 'Refusée', denied: (at: string) => `Refus envoyé${at ? ` · ${at}` : ''}`, open: (name: string) => `Ouvrir ${name}`,
  failed: (why: string) => `Échec : ${why}`, refused: (why: string) => `Refusée : ${why} Rien n’a été envoyé.`,
  held: (k: number) => `Pas appliquée : le plan s’est arrêté à l’étape ${k}.`,
  stale: (name: string) => `La demande de ${name} a changé depuis ma réponse : rien n’a été envoyé. Ouvre ${name} pour voir la nouvelle, ou redemande-moi.`,
  deniedNote: (name: string) => `${name} a reçu ton refus : la commande n’a pas été lancée.`,
  all: (n: number) => `Tout appliquer (${n})`, resume: (k: number, n: number) => `Reprendre à l’étape ${k} (${n})`, skip: (k: number, n: number) => `Continuer sans l’étape ${k} (${n})`,
  inOrder: 'dans l’ordre, s’arrête au premier échec', destructiveLater: (n: number) => `${n} ${n > 1 ? 'irréversibles' : 'irréversible'}, je te redemanderai`,
  notReplayed: 'les étapes faites ne sont pas rejouées', progress: (k: number, n: number) => `Étape ${k} sur ${n}…`, planDone: (at: string) => `Plan appliqué${at ? ` à ${at}` : ''}`,
  confirm: {
    label: 'Confirmation', many: (n: number, all: boolean) => `Appliquer ${all ? 'ces' : 'les'} ${n} actions, dans l’ordre ?`, one: (summary: string) => `${summary} ?`,
    oneWhy: 'Ledge ne pourra pas la défaire une fois envoyée.',
    manyWhy: (d: number) => `${d === 1 ? 'Une est irréversible' : `${d} sont irréversibles`} : relis ${d === 1 ? 'son' : 'leur'} détail ci-dessus. Si une étape échoue, les suivantes ne sont pas appliquées.`,
    cancel: 'Annuler', go: (n: number) => `Appliquer les ${n}`, alreadyDone: 'déjà faite'
  },
  ignored: (n, at, sent = { done: 0, denied: 0, failed: 0 }) => {
    const went = [
      ...(sent.done ? [`${sent.done} ${sent.done > 1 ? 'appliquées' : 'appliquée'}`] : []),
      ...(sent.denied ? [`${sent.denied} ${sent.denied > 1 ? 'refus envoyés' : 'refus envoyé'}`] : []),
      ...(sent.failed ? [`${sent.failed} ${sent.failed > 1 ? 'échouées' : 'échouée'}`] : [])
    ];
    if (!went.length) return `${n > 1 ? `Plan de ${n} actions ignoré` : 'Carte ignorée'} à ${at} · rien n’a été envoyé`;
    return n > 1 ? `Plan de ${n} actions : ${went.join(', ')}, le reste ignoré à ${at}` : `Carte ignorée à ${at} · l’action est partie, mais n’a pas abouti`;
  },
  words: actionWords.fr
};

const en: ActionCopy = {
  label: (n: number) => n > 1 ? `Plan of ${n} actions` : 'Proposed action',
  risk: { read: 'Read', reversible: 'Reversible', destructive: 'Irreversible' },
  riskTip: { read: 'nothing changes', reversible: 'Ledge can undo it', destructive: 'Ledge cannot undo it' },
  step: (k: number) => `Step ${k}`,
  stepState: { done: (k: number) => `Step ${k}, applied`, failed: (k: number) => `Step ${k}, failed`, refused: (k: number) => `Step ${k}, refused`, running: (k: number) => `Step ${k}, running` },
  askAgain: 'I’ll ask you again',
  verbs: {
    'session.model': 'Change', 'session.interrupt': 'Interrupt', 'session.archive': 'Archive', 'session.restore': 'Restore', 'session.resume': 'Resume',
    'session.decide': 'Accept', 'team.join': 'Add', 'team.leave': 'Remove', 'team.resume': 'Resume', 'team.dissolve': 'Dissolve', 'team.save': 'Save',
    'task.cancel': 'Drop', 'task.pass': 'Hand over', 'task.answer': 'Answer'
  } as Record<string, string>,
  apply: 'Apply', deny: 'Deny', ignore: 'Ignore', review: 'Review', retry: 'Retry', running: 'Running…',
  done: (at: string) => `Applied${at ? ` · ${at}` : ''}`, refusedState: 'Refused', denied: (at: string) => `Denial sent${at ? ` · ${at}` : ''}`, open: (name: string) => `Open ${name}`,
  failed: (why: string) => `Failed: ${why}`, refused: (why: string) => `Refused: ${why} Nothing was sent.`,
  held: (k: number) => `Not applied: the plan stopped at step ${k}.`,
  stale: (name: string) => `${name}’s request changed since my answer: nothing was sent. Open ${name} to see the new one, or ask me again.`,
  deniedNote: (name: string) => `${name} got your denial: the command did not run.`,
  all: (n: number) => `Apply all (${n})`, resume: (k: number, n: number) => `Resume at step ${k} (${n})`, skip: (k: number, n: number) => `Continue without step ${k} (${n})`,
  inOrder: 'in order, stops at the first failure', destructiveLater: (n: number) => `${n} irreversible, I’ll ask you again`,
  notReplayed: 'steps already done are not replayed', progress: (k: number, n: number) => `Step ${k} of ${n}…`, planDone: (at: string) => `Plan applied${at ? ` at ${at}` : ''}`,
  confirm: {
    label: 'Confirmation', many: (n: number, all: boolean) => `Apply ${all ? 'these' : 'the'} ${n} actions, in order?`, one: (summary: string) => `${summary}?`,
    oneWhy: 'Ledge cannot undo it once sent.',
    manyWhy: (d: number) => `${d === 1 ? 'One is irreversible' : `${d} are irreversible`}: read ${d === 1 ? 'its' : 'their'} detail above. If a step fails, the next ones are not applied.`,
    cancel: 'Cancel', go: (n: number) => `Apply the ${n}`, alreadyDone: 'already done'
  },
  ignored: (n, at, sent = { done: 0, denied: 0, failed: 0 }) => {
    const went = [
      ...(sent.done ? [`${sent.done} applied`] : []),
      ...(sent.denied ? [`${sent.denied} ${sent.denied > 1 ? 'denials' : 'denial'} sent`] : []),
      ...(sent.failed ? [`${sent.failed} failed`] : [])
    ];
    if (!went.length) return `${n > 1 ? `Plan of ${n} actions ignored` : 'Card ignored'} at ${at} · nothing was sent`;
    return n > 1 ? `Plan of ${n} actions: ${went.join(', ')}, the rest ignored at ${at}` : `Card ignored at ${at} · the action was sent but did not go through`;
  },
  words: actionWords.en
};

export const actionCopy = { fr, en } as const;
