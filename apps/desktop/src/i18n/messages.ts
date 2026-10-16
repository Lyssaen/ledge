import type { BotState } from '@ledge/ui/bots/poseFor';
import type { SectionId } from '../nav/state';

/** French counts 0 and 1 as singular, English only 1. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const pluralEn = (n: number, one: string, many: string) => (n === 1 ? one : many);

const fr = {
  side: {
    label: 'Barre latérale', newSession: 'Nouvelle session', search: 'Rechercher', searchLabel: 'Rechercher une session',
    views: 'Vues', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projets', newProject: 'Nouveau projet', unassigned: 'Sans projet',
    machines: 'Machines', manageMachines: 'Gérer les machines', agents: (n: number) => plural(n, `${n} agent`, `${n} agents`), offline: 'hors ligne', settings: 'Réglages'
  },
  crumb: { atelier: 'Atelier', list: 'Liste', settings: 'Réglages', clearFilter: 'Retirer le filtre : voir tous les projets', clearFilterTitle: 'Tous les projets (Échap)', escape: 'Échap' },
  top: {
    viewTabs: 'Vue des agents', helpersHide: 'Masquer les sous-agents', helpersShow: 'Afficher les sous-agents', pause: 'Figer les animations', play: 'Animer',
    search: 'Rechercher une session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Raccourcis clavier (?)', fullscreen: 'Plein écran', fullscreenExit: 'Quitter le plein écran'
  },
  foot: { sessions: 'Sessions locales et SSH', search: 'Une session', chat: 'Chat Ledge', shortcuts: 'Raccourcis' },
  sections: { general: 'Général', appearance: 'Apparence', notifications: 'Notifications', sounds: 'Sons', machines: 'Machines', projects: 'Projets', shortcuts: 'Raccourcis', about: 'À propos' } as Record<SectionId, string>,
  pending: 'Cet écran arrive bientôt.',
  close: 'Fermer',
  // search and shortcuts: the mockup's titles, until the palette and the help (task 4) bring their own.
  modalTitles: { launch: 'Nouvelle session', project: 'Nouveau projet', search: 'Aller à une session', shortcuts: 'Raccourcis clavier' },
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
  stateLabel: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' }
};

const en: typeof fr = {
  side: {
    label: 'Sidebar', newSession: 'New session', search: 'Search', searchLabel: 'Search a session',
    views: 'Views', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projects', newProject: 'New project', unassigned: 'No project',
    machines: 'Machines', manageMachines: 'Manage machines', agents: (n) => pluralEn(n, `${n} agent`, `${n} agents`), offline: 'offline', settings: 'Settings'
  },
  crumb: { atelier: 'Atelier', list: 'List', settings: 'Settings', clearFilter: 'Remove the filter: show every project', clearFilterTitle: 'Every project (Esc)', escape: 'Esc' },
  top: {
    viewTabs: 'Agents view', helpersHide: 'Hide subagents', helpersShow: 'Show subagents', pause: 'Freeze animations', play: 'Animate',
    search: 'Search a session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Keyboard shortcuts (?)', fullscreen: 'Full screen', fullscreenExit: 'Exit full screen'
  },
  foot: { sessions: 'Local and SSH sessions', search: 'A session', chat: 'Chat Ledge', shortcuts: 'Shortcuts' },
  sections: { general: 'General', appearance: 'Appearance', notifications: 'Notifications', sounds: 'Sounds', machines: 'Machines', projects: 'Projects', shortcuts: 'Shortcuts', about: 'About' },
  pending: 'This screen is coming soon.',
  close: 'Close',
  modalTitles: { launch: 'New session', project: 'New project', search: 'Go to a session', shortcuts: 'Keyboard shortcuts' },
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
  stateLabel: { approval: 'Approval', question: 'Question', starting: 'Starting', idle: 'Available', working: 'Running', done: 'Done', error: 'Error', readonly: 'Read only' },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
