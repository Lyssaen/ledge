import type { ReactNode } from 'react';
import { MANDATE_CATEGORY_LABEL } from '@ledge/protocol';
import { LedgeThreadCopyProvider, type LedgeThreadCopy } from '../src/chat/ledge/copy';

/** The thread's words in French, as an app would fill them (the labels the plan fixes verbatim). */
export const frThread: LedgeThreadCopy = {
  days: { today: "AUJOURD'HUI", yesterday: 'HIER', date: day => `${day.slice(8, 10)}/${day.slice(5, 7)}` },
  age: { now: "à l'instant", minutes: n => `${n} min`, hours: n => `${n} h`, days: n => `${n} j`, ago: span => `il y a ${span}` },
  category: c => MANDATE_CATEGORY_LABEL[c].fr,
  bubbles: { ledge: 'Ledge', you: 'Toi' },
  escalation: {
    advice: text => `Mon avis : ${text}`, talk: 'En parler', grace: "Ledge s'en occupe…",
    answeredByYou: label => `Répondu par toi : ${label}`, answeredByLedge: label => `Tranché par Ledge : ${label}`,
    alreadyAnswered: 'Déjà répondu', closed: 'Fermée', refused: (code, reason) => reason ?? `Échec (${code})`,
    seen: 'Vu', askLabel: 'Ta réponse', askPlaceholder: 'Répondre…', send: 'Envoyer'
  },
  exchanges: {
    count: n => (n === 1 ? '1 échange' : `${n} échanges entre agents`), fold: 'Replier', unfold: 'Voir',
    missing: n => (n === 1 ? '1 échange plus disponible' : `${n} échanges plus disponibles`),
    kind: { task: 'tâche', message: 'message', handoff: 'relève', ledge: 'Ledge' }
  },
  decided: { line: (to, summary) => `J'ai tranché pour ${to} : ${summary}`, rule: rule => `Règle ${rule}`, ruleOf: since => `Règle du ${since.slice(8, 10)}/${since.slice(5, 7)}`, revisit: 'Revenir dessus' },
  brain: { stopped: 'Ledge est arrêté', start: 'Démarrer' }
};

export function Fr({ children }: { children: ReactNode }) {
  return <LedgeThreadCopyProvider value={frThread}>{children}</LedgeThreadCopyProvider>;
}
