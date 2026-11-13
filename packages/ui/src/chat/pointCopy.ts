import type { PointCopy } from './copy';

// The operator point's words (docs/mockups/ledge-operator.html, board 1), once for every front on the PC that says « tu »:
// the Desktop and the island. The phone has its own.

const fr: PointCopy = {
  by: 'de lui-même',
  groups: { atoi: 'À toi', done: 'Terminé', ongoing: 'En cours', rigs: 'Rigs' },
  reply: 'Répondre…',
  nav: { session: 'Voir', pr: 'Voir la PR', rig: 'Ouvrir le rig', task: 'Voir la tâche' },
  wantsToRun: 'veut lancer',
  quote: s => `« ${s} »`,
  suggest: {
    'session.archive': v => (v.session ? `Archiver ${v.session}` : undefined),
    'session.handover': () => 'Passer le relais',
    'rig.send': v => (v.seat ? `Écrire à ${v.seat}` : undefined)
  },
  folded: at => `Tout est réglé depuis ${at}`,
  settled: { terminal: 'réglé dans le terminal', phone: 'réglé sur le téléphone', desktop: 'réglé dans Ledge Desktop', chat: 'réglé ici', elsewhere: 'réglé ailleurs' },
  answer: { label: 'Ta réponse', placeholder: 'Ta réponse…', send: 'Envoyer', cancel: 'Annuler' },
  confirmAnswer: (label, who) => `${label} pour ${who} ?`,
  error: why => `Pas envoyé : ${why}`
};

const en: PointCopy = {
  by: 'on its own',
  groups: { atoi: 'For you', done: 'Done', ongoing: 'In progress', rigs: 'Rigs' },
  reply: 'Reply…',
  nav: { session: 'View', pr: 'View PR', rig: 'Open rig', task: 'View task' },
  wantsToRun: 'wants to run',
  quote: s => `“${s}”`,
  suggest: {
    'session.archive': v => (v.session ? `Archive ${v.session}` : undefined),
    'session.handover': () => 'Hand over',
    'rig.send': v => (v.seat ? `Write to ${v.seat}` : undefined)
  },
  folded: at => `All settled since ${at}`,
  settled: { terminal: 'settled in the terminal', phone: 'settled on the phone', desktop: 'settled in Ledge Desktop', chat: 'settled here', elsewhere: 'settled elsewhere' },
  answer: { label: 'Your answer', placeholder: 'Your answer…', send: 'Send', cancel: 'Cancel' },
  confirmAnswer: (label, who) => `${label} for ${who}?`,
  error: why => `Not sent: ${why}`
};

export const pointCopy = { fr, en } as const;
