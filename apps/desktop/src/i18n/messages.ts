import type { BotState } from '@ledge/ui/bots/poseFor';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

const fr = {
  heading: {
    team: { title: 'L’équipe', subtitle: 'Ce que chacun fait, et ce qui attend votre réponse.' },
    room: { title: 'La salle de travail', subtitle: 'Des tables par machine ou par story, avec les mêmes sessions.' }
  },
  views: { label: 'Vue des sessions', team: 'Équipe', room: 'Réunion' },
  attention: { filter: 'À votre attention' },
  newSession: 'Nouvelle session',
  team: {
    all: (n: number) => `Tous les participants · ${n}`, attention: (n: number) => `À votre attention · ${n}`, byProject: 'Par projet',
    participants: (n: number) => `${n} ${plural(n, 'PARTICIPANT', 'PARTICIPANTS')}`
  },
  room: {
    hints: { all: 'Tous les participants autour d’une seule table.', machine: 'Une table par machine, tous projets confondus.', jira: 'Clés détectées dans les branches et sujets · sans connexion Jira.' },
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
    badge: 'Déconnectée',
    machine: 'Machine déconnectée',
    text: 'Les sessions distantes affichent leur dernier état connu. Les échanges reprendront après la reconnexion ; les sessions locales restent disponibles.',
    retry: 'Réessayer'
  },
  localDown: { title: 'Daemon local injoignable', text: 'Ledge ne peut pas joindre le daemon de cette machine. Tout est en lecture seule jusqu’à son retour.' },
  status: {
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
    // A machine is feminine (« la machine »), as in the mockup: « Devbox connectée », « Devbox déconnectée »; the local one is « Local connecté ».
    connected: (name: string, isLocal = false) => isLocal ? `${name} connecté` : `${name} connectée`,
    disconnected: (name: string, isLocal = false) => isLocal ? `${name} déconnecté` : `${name} déconnectée`
  },
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' },
  states: { starting: 'Démarrage', working: 'Au travail', waiting_permission: 'Votre accord', waiting_input: 'Une question', idle: 'Disponible', exited: 'Terminée', error: 'Erreur' },
  conversation: {
    eyebrow: 'CONVERSATION',
    label: (name: string) => `Conversation avec ${name}`,
    expand: '↗ Agrandir',
    collapse: '↙ Réduire',
    local: 'Cette machine',
    meta: {
      summary: 'Détails de la session',
      duration: (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`),
      jira: (key: string, from: 'branch' | 'topic') => `${key} · détectée dans ${from === 'branch' ? 'la branche' : 'le sujet'}`,
      ambiguous: (keys: readonly string[]) => `À clarifier : ${keys.join(', ')}`,
      noJira: 'Aucune clé Jira détectée'
    },
    offline: 'Machine déconnectée · historique figé. Votre brouillon sera conservé jusqu’à la reconnexion.',
    readonly: 'Session suivie par les hooks · lecture seule.',
    thread: {
      label: (name: string) => `Historique des échanges avec ${name}`,
      start: (time: string) => `Début de la session · ${time}`,
      partial: 'Historique partiel · seule la dernière réponse est connue.',
      you: 'Vous',
      actions: (n: number) => `${n} ${plural(n, 'action', 'actions')} · Voir le détail`,
      permission: (tool: string, accepted: boolean) => `${accepted ? 'Accord donné' : 'Accord refusé'} · ${tool}`,
      helper: (task: string, done: boolean) => `Sous-agent · ${task}${done ? ' · terminé' : ''}`
    },
    request: {
      kinds: { permission: 'Demande d’accord', question: 'Question', plan: 'Plan à valider', diff: 'Modifications à valider' },
      deny: 'Refuser',
      allow: 'Autoriser',
      orReply: 'Ou précisez votre réponse dans le champ ci-dessous.',
      sent: 'Envoyé…',
      failed: (msg: string) => `Échec de l’envoi : ${msg}`
    },
    composer: {
      label: (name: string) => `Répondre à ${name}`,
      placeholder: 'Écrivez votre message…',
      send: 'Envoyer ↑',
      hint: 'Ctrl / ⌘ + Entrée pour envoyer · Entrée pour une nouvelle ligne',
      sent: 'Envoyé…',
      failed: (msg: string) => `Message non envoyé : ${msg}`,
      blocked: {
        offline: 'Machine déconnectée : envoi impossible.',
        readonly: 'Session en lecture seule.',
        request: 'Répondez d’abord à la demande ci-dessus.',
        options: 'Choisissez une des options ci-dessus.'
      }
    },
    actions: {
      label: 'Actions de la session',
      terminal: 'Ouvrir le terminal',
      interrupt: 'Interrompre',
      kill: 'Arrêter',
      dismiss: 'Retirer',
      rename: 'Renommer',
      why: { offline: 'Machine déconnectée', noTerminal: 'Aucun terminal pour cette session', idle: 'Rien à interrompre', unavailable: 'Terminal introuvable sur cette machine' },
      confirmKill: (name: string) => `Arrêter ${name} ? Le travail en cours sera interrompu.`,
      confirm: 'Oui, arrêter',
      cancel: 'Annuler',
      renameLabel: 'Sujet de la session',
      renameHint: 'Entrée pour enregistrer · Échap pour annuler',
      save: 'Enregistrer',
      sent: 'Envoyé…',
      failed: (msg: string) => `Échec : ${msg}`
    },
    panel: {
      label: 'Largeur de la conversation',
      valueText: (n: number) => `Conversation : ${n} % de la largeur`,
      title: 'Glisser pour ajuster la largeur · flèches gauche et droite au clavier'
    }
  }
};

const en: typeof fr = {
  heading: {
    team: { title: 'The team', subtitle: 'What everyone is doing, and what is waiting for your answer.' },
    room: { title: 'The meeting room', subtitle: 'Tables by machine or by story, with the same sessions.' }
  },
  views: { label: 'Session view', team: 'Team', room: 'Meeting' },
  attention: { filter: 'Needs you' },
  newSession: 'New session',
  team: {
    all: (n) => `All participants · ${n}`, attention: (n) => `Needs you · ${n}`, byProject: 'By project',
    participants: (n) => `${n} ${plural(n, 'PARTICIPANT', 'PARTICIPANTS')}`
  },
  room: {
    hints: { all: 'Everyone around a single table.', machine: 'One table per machine, all projects together.', jira: 'Keys detected in branches and subjects · no Jira connection.' },
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
    badge: 'Disconnected',
    machine: 'Machine disconnected',
    text: 'Remote sessions show their last known state. Conversations resume once it reconnects; local sessions stay available.',
    retry: 'Retry'
  },
  localDown: { title: 'Local daemon unreachable', text: 'Ledge cannot reach the daemon on this machine. Everything is read-only until it is back.' },
  status: {
    sessions: (n) => `${n} ${plural(n, 'session', 'sessions')}`,
    connected: (name, _isLocal) => `${name} connected`,
    disconnected: (name, _isLocal) => `${name} disconnected`
  },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' },
  states: { starting: 'Starting', working: 'Working', waiting_permission: 'Your approval', waiting_input: 'A question', idle: 'Available', exited: 'Finished', error: 'Error' },
  conversation: {
    eyebrow: 'CONVERSATION',
    label: (name: string) => `Conversation with ${name}`,
    expand: '↗ Expand',
    collapse: '↙ Collapse',
    local: 'This machine',
    meta: {
      summary: 'Session details',
      duration: (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`),
      jira: (key: string, from: 'branch' | 'topic') => `${key} · found in the ${from === 'branch' ? 'branch' : 'subject'}`,
      ambiguous: (keys: readonly string[]) => `To clarify: ${keys.join(', ')}`,
      noJira: 'No Jira key found'
    },
    offline: 'Machine disconnected · history frozen. Your draft is kept until it reconnects.',
    readonly: 'Session followed through hooks · read-only.',
    thread: {
      label: (name: string) => `Conversation history with ${name}`,
      start: (time: string) => `Session started · ${time}`,
      partial: 'Partial history · only the last reply is known.',
      you: 'You',
      actions: (n: number) => `${n} ${plural(n, 'action', 'actions')} · Show details`,
      permission: (tool: string, accepted: boolean) => `${accepted ? 'Allowed' : 'Denied'} · ${tool}`,
      helper: (task: string, done: boolean) => `Helper · ${task}${done ? ' · done' : ''}`
    },
    request: {
      kinds: { permission: 'Approval request', question: 'Question', plan: 'Plan to approve', diff: 'Changes to approve' },
      deny: 'Deny',
      allow: 'Allow',
      orReply: 'Or give your answer in the field below.',
      sent: 'Sent…',
      failed: (msg: string) => `Not sent: ${msg}`
    },
    composer: {
      label: (name: string) => `Reply to ${name}`,
      placeholder: 'Write your message…',
      send: 'Send ↑',
      hint: 'Ctrl / ⌘ + Enter to send · Enter for a new line',
      sent: 'Sent…',
      failed: (msg: string) => `Message not sent: ${msg}`,
      blocked: {
        offline: 'Machine disconnected: cannot send.',
        readonly: 'Read-only session.',
        request: 'Answer the request above first.',
        options: 'Pick one of the options above.'
      }
    },
    actions: {
      label: 'Session actions',
      terminal: 'Open terminal',
      interrupt: 'Interrupt',
      kill: 'Stop',
      dismiss: 'Dismiss',
      rename: 'Rename',
      why: { offline: 'Machine disconnected', noTerminal: 'No terminal for this session', idle: 'Nothing to interrupt', unavailable: 'No terminal found on this machine' },
      confirmKill: (name: string) => `Stop ${name}? Its current work will be interrupted.`,
      confirm: 'Yes, stop',
      cancel: 'Cancel',
      renameLabel: 'Session subject',
      renameHint: 'Enter to save · Escape to cancel',
      save: 'Save',
      sent: 'Sent…',
      failed: (msg: string) => `Failed: ${msg}`
    },
    panel: {
      label: 'Conversation width',
      valueText: (n: number) => `Conversation: ${n}% of the width`,
      title: 'Drag to adjust the width · left and right arrows on the keyboard'
    }
  }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
