import type { BotState } from '@ledge/ui/bots/poseFor';

/** French counts 0 and 1 as singular, English only 1. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const pluralEn = (n: number, one: string, many: string) => (n === 1 ? one : many);

const fr = {
  waiting: { title: 'Ledge Desktop', text: 'L’Atelier se construit. Ledge suit vos agents en attendant.' },
  tray: { open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', dndOff: 'Réactiver les alertes', quit: 'Quitter Ledge Desktop' },
  notify: {
    approval: (name: string) => `${name} attend votre accord`,
    question: (name: string) => `${name} a une question`,
    finished: (name: string) => `${name} a terminé`,
    failed: (name: string) => `${name} a rencontré une erreur`,
    manyTitle: 'Votre équipe',
    many: (n: number) => `${n} sessions vous attendent ou ont terminé`
  },
  status: {
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
    // A machine is feminine (« la machine »), as in the mockup: « Devbox connectée », « Devbox déconnectée »; the local one is « Local connecté ».
    connected: (name: string, isLocal = false) => isLocal ? `${name} connecté` : `${name} connectée`,
    disconnected: (name: string, isLocal = false) => isLocal ? `${name} déconnecté` : `${name} déconnectée`
  },
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' }
};

const en: typeof fr = {
  waiting: { title: 'Ledge Desktop', text: 'The Atelier is being built. Ledge keeps watch over your agents meanwhile.' },
  tray: { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', dndOff: 'Resume alerts', quit: 'Quit Ledge Desktop' },
  notify: {
    approval: (name) => `${name} needs your approval`,
    question: (name) => `${name} has a question`,
    finished: (name) => `${name} has finished`,
    failed: (name) => `${name} ran into an error`,
    manyTitle: 'Your team',
    many: (n) => `${n} sessions need you or have finished`
  },
  status: {
    sessions: (n) => `${n} ${pluralEn(n, 'session', 'sessions')}`,
    connected: (name, _isLocal) => `${name} connected`,
    disconnected: (name, _isLocal) => `${name} disconnected`
  },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
