import type { BotState } from '@ledge/ui/bots/poseFor';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

const fr = {
  app: { title: 'Votre équipe, à votre façon.' },
  views: { team: 'Équipe', room: 'Réunion' },
  attention: { filter: 'À votre attention' },
  newSession: 'Nouvelle session',
  team: { all: (n: number) => `Toute l’équipe · ${n}`, attention: 'À votre attention' },
  room: {
    grouping: 'Regrouper les tables',
    groupings: { all: 'Toutes ensemble', machine: 'Par machine', jira: 'Par story Jira' },
    tables: { all: 'Toute l’équipe', unassigned: 'Sans story identifiée', ambiguous: 'À clarifier', mine: 'Mon espace', unknownMachine: 'Machine inconnue' },
    pending: (n: number) => `${n} ${plural(n, 'demande', 'demandes')} en attente`,
    allGood: 'Tout le monde avance',
    tableCount: (n: number) => `${n} ${plural(n, 'table', 'tables')}`,
    eyebrow: { machine: 'MACHINE', detected: 'CLÉ JIRA DÉTECTÉE', unassigned: 'À RATTACHER', mine: 'MON ESPACE' },
    captions: {
      machine: 'Une table par machine, tous projets confondus.',
      detected: 'Clés détectées dans les branches et sujets.',
      unassigned: 'Aucune clé Jira détectée dans la branche ou le sujet.',
      mine: 'Vos propres sessions, hors équipe.'
    }
  },
  empty: { title: 'Votre équipe commence ici', text: 'Aucune session pour le moment. Choisissez un projet et confiez une première tâche à un agent.', none: 'Aucune demande en attente.' },
  offline: {
    title: (name: string) => `${name} est déconnectée`,
    reconnecting: (name: string) => `Reconnexion à ${name}…`,
    retry: 'Réessayer'
  },
  localDown: { title: 'Daemon local injoignable', text: 'Ledge ne peut pas joindre le daemon de cette machine. Tout est en lecture seule jusqu’à son retour.' },
  status: {
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
    connected: (name: string) => `${name} connecté`,
    unreachable: (name: string) => `${name} injoignable`
  },
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' },
  states: { starting: 'Démarrage', working: 'Au travail', waiting_permission: 'Votre accord', waiting_input: 'Une question', idle: 'Disponible', exited: 'Terminée', error: 'Erreur' }
};

const en: typeof fr = {
  app: { title: 'Your team, your way.' },
  views: { team: 'Team', room: 'Meeting' },
  attention: { filter: 'Needs you' },
  newSession: 'New session',
  team: { all: (n) => `Whole team · ${n}`, attention: 'Needs you' },
  room: {
    grouping: 'Group the tables',
    groupings: { all: 'All together', machine: 'By machine', jira: 'By Jira story' },
    tables: { all: 'Whole team', unassigned: 'No story identified', ambiguous: 'To clarify', mine: 'My space', unknownMachine: 'Unknown machine' },
    pending: (n) => `${n} ${plural(n, 'request', 'requests')} waiting`,
    allGood: 'Everyone is moving',
    tableCount: (n) => `${n} ${plural(n, 'table', 'tables')}`,
    eyebrow: { machine: 'MACHINE', detected: 'JIRA KEY DETECTED', unassigned: 'TO ATTACH', mine: 'MY SPACE' },
    captions: {
      machine: 'One table per machine, all projects together.',
      detected: 'Keys detected in branches and subjects.',
      unassigned: 'No Jira key detected in the branch or subject.',
      mine: 'Your own sessions, outside the team.'
    }
  },
  empty: { title: 'Your team starts here', text: 'No sessions yet. Pick a project and give an agent a first task.', none: 'No requests waiting.' },
  offline: {
    title: (name) => `${name} is disconnected`,
    reconnecting: (name) => `Reconnecting to ${name}…`,
    retry: 'Retry'
  },
  localDown: { title: 'Local daemon unreachable', text: 'Ledge cannot reach the daemon on this machine. Everything is read-only until it is back.' },
  status: {
    sessions: (n) => `${n} ${plural(n, 'session', 'sessions')}`,
    connected: (name) => `${name} connected`,
    unreachable: (name) => `${name} unreachable`
  },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' },
  states: { starting: 'Starting', working: 'Working', waiting_permission: 'Your approval', waiting_input: 'A question', idle: 'Available', exited: 'Finished', error: 'Error' }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
