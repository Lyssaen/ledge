import type { BotState } from '@ledge/ui/bots/poseFor';
import type { Availability, LaunchProblem } from '../launch/form';

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
  empty: { start: 'Démarrer une session', title: 'Votre équipe commence ici', text: 'Aucune session pour le moment. Choisissez un projet et confiez une première tâche à un agent.', none: 'Aucune demande en attente.' },
  launch: {
    title: 'Nouvelle session',
    subtitle: 'Un projet, un agent et une première consigne.',
    back: 'Retour aux sessions',
    cancel: 'Annuler le démarrage',
    form: 'Paramètres de la nouvelle session',
    machine: 'Machine',
    machineName: (label: string, remote: boolean) => `${label} · ${remote ? 'SSH' : 'WSL'}`,
    availability: { ready: '', connecting: ' · connexion…', unreachable: ' · déconnectée' } as Record<Availability, string>,
    project: 'Projet',
    custom: 'Autre dossier…',
    folder: 'Dossier de travail',
    folderPlaceholder: '/chemin/du/projet',
    folderHint: 'Dossier sur la machine choisie : chemin absolu (/…) ou commençant par ~.',
    agent: 'Agent',
    prompt: 'Première consigne',
    promptPlaceholder: 'Que souhaitez-vous confier à cet agent ?',
    footnote: 'L’agent démarre dans tmux sur la machine choisie.',
    submit: 'Démarrer la session',
    someDown: (names: string[], target: string) => `${names.join(', ')} ${names.length > 1 ? 'sont déconnectées' : 'est déconnectée'}. Vous pouvez démarrer une session sur ${target}.`,
    noneReady: 'Aucune machine n’est connectée. Rétablissez une connexion pour démarrer une session.',
    invalid: {
      machine: 'Choisissez une machine connectée.',
      cwd: 'Indiquez un dossier absolu (/…) ou commençant par ~.',
      prompt: 'Écrivez une première consigne.'
    } as Record<LaunchProblem, string>,
    summary: { machine: 'Machine', agent: 'Agent', folder: 'Dossier' },
    starting: {
      label: 'Démarrage de la session',
      title: 'Démarrage de votre agent',
      text: (machine: string) => `Préparation de la session sur ${machine}…`,
      connected: 'Connexion à la machine',
      folder: 'Dossier de travail sélectionné',
      tool: (name: string) => `Démarrage de ${name}`
    },
    failed: {
      label: 'Échec du lancement',
      title: 'L’agent n’a pas pu démarrer',
      daemon: (why: string) => `Le daemon a refusé : ${why}`,
      offline: (machine: string) => `La machine ${machine} n’est pas connectée : rien n’a été envoyé.`,
      lost: (machine: string) => `La connexion à ${machine} a été perdue pendant le démarrage. La session a peut-être démarré : vérifiez la liste avant de réessayer.`,
      timeout: 'Le daemon n’a pas répondu à temps. Aucune nouvelle session n’a été confirmée.',
      edit: 'Modifier les paramètres',
      retry: 'Réessayer',
      kept: 'Votre consigne est conservée.'
    },
    browse: {
      button: 'Parcourir…',
      title: (machine: string) => `Dossiers sur ${machine}`,
      close: 'Fermer',
      path: 'Chemin du dossier',
      up: 'Dossier parent',
      open: (name: string) => `Ouvrir ${name}`,
      empty: 'Aucun sous-dossier.',
      loading: 'Chargement…',
      newFolder: 'Nouveau dossier',
      newFolderName: 'Nom du nouveau dossier',
      create: 'Créer',
      choose: 'Choisir ce dossier',
      failed: (why: string) => `Impossible : ${why}`,
      offline: (machine: string) => `La machine ${machine} n’est pas connectée : les dossiers ne peuvent pas être listés.`
    }
  },
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
      folder: 'Dossier',
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
  },
  chat: {
    trigger: 'Parler à Ledge',
    label: 'Parler à Ledge',
    eyebrow: 'PARLER À LEDGE',
    identity: (sessions: number, projects: number) => `${sessions} ${plural(sessions, 'session', 'sessions')} · ${projects} ${plural(projects, 'projet', 'projets')}`,
    purpose: 'Faites le point sur vos projets ou préparez votre prochaine tâche.',
    reset: 'Nouvelle conversation',
    thread: 'Historique avec Ledge',
    welcome: { title: 'De quoi avez-vous besoin ?', text: 'Retrouvez les demandes en attente et le contexte de votre équipe.' },
    starters: { label: 'Suggestions pour Ledge', items: ['Qui a besoin de moi ?', 'Fais le point sur les projets', 'Préparer une nouvelle session'] as readonly string[] },
    author: 'Ledge',
    thinking: 'Ledge cherche…',
    step: { sessions: 'Relit les sessions', pane: (name: string) => `Lit le terminal de ${name}`, reply: (name: string) => `Lit la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => `Lit ${path}` },
    source: { sessions: 'les sessions', pane: (name: string) => `le terminal de ${name}`, reply: (name: string) => `la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => path },
    sourcesNone: 'aucune lecture',
    sourcesLine: (list: string, time: string) => `Sources : ${list} · ${time}`,
    stop: 'Annuler',
    stopLabel: 'Annuler la question en cours',
    stopped: 'Question annulée.',
    error: (why: string) => `Ledge n’a pas pu répondre : ${why}`,
    choose: (name: string) => `Sur ${name}.`,
    choices: 'Machines proposées',
    clarification: 'Vous pouvez aussi répondre par écrit.',
    destination: (name: string) => `Destination : ${name}`,
    unavailable: 'déconnectée',
    links: 'Sessions citées',
    open: (name: string) => `Ouvrir ${name}`,
    readonly: 'Lecture seule : le daemon local ne répond pas. L’historique avec Ledge reste lisible.',
    frozen: (names: string) => `${names} : connexion perdue. Ledge s’appuie sur le dernier état connu de ces machines.`,
    composer: {
      label: 'Parler à Ledge',
      placeholder: 'Posez votre question à Ledge…',
      send: 'Envoyer ↑',
      hint: 'Ctrl / ⌘ + Entrée pour envoyer',
      busy: 'Ledge répond… Vous pouvez préparer la suite.',
      refused: 'Ledge n’a pas pris cette question. Réessayez dans un instant.',
      readonly: 'Lecture seule : le daemon local ne répond pas.'
    },
    card: {
      label: 'Session proposée', folder: 'Dossier', tool: 'Harnais', byDefault: (tool: string) => `${tool} · par défaut`, prompt: 'Instruction', noPrompt: 'Aucune, session vide',
      launch: 'Lancer la session', launching: 'Lancement…', retry: 'Réessayer', orRephrase: 'ou reformulez votre demande', orFolder: 'ou indiquez un autre dossier',
      failed: (why: string) => `Échec du lancement : ${why}`, started: (name: string) => `${name} a démarré`, startedUnknown: 'Session démarrée'
    },
    relay: {
      label: 'Instruction à envoyer', session: 'Session', instruction: 'Instruction',
      send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', retry: 'Réessayer', orRephrase: 'ou reformulez votre demande',
      queued: 'travaille ; l’instruction partira dès qu’il aura fini', sentTo: 'Envoyé à', failed: (why: string) => `Échec de l’envoi : ${why}`,
      pill: { yours: 'à vous', working: 'travaille', waiting: 'attend votre réponse', stopped: 'arrêtée' }
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
  empty: { start: 'Start a session', title: 'Your team starts here', text: 'No sessions yet. Pick a project and give an agent a first task.', none: 'No requests waiting.' },
  launch: {
    title: 'New session',
    subtitle: 'A project, an agent and a first instruction.',
    back: 'Back to sessions',
    cancel: 'Cancel launch',
    form: 'New session settings',
    machine: 'Machine',
    machineName: (label: string, remote: boolean) => `${label} · ${remote ? 'SSH' : 'WSL'}`,
    availability: { ready: '', connecting: ' · connecting…', unreachable: ' · disconnected' },
    project: 'Project',
    custom: 'Other folder…',
    folder: 'Working folder',
    folderPlaceholder: '/path/to/project',
    folderHint: 'A folder on the chosen machine: an absolute path (/…) or one starting with ~.',
    agent: 'Agent',
    prompt: 'First instruction',
    promptPlaceholder: 'What would you like this agent to do?',
    footnote: 'The agent starts in tmux on the chosen machine.',
    submit: 'Start the session',
    someDown: (names: string[], target: string) => `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} disconnected. You can start a session on ${target}.`,
    noneReady: 'No machine is connected. Restore a connection to start a session.',
    invalid: {
      machine: 'Choose a connected machine.',
      cwd: 'Enter an absolute folder (/…) or one starting with ~.',
      prompt: 'Write a first instruction.'
    },
    summary: { machine: 'Machine', agent: 'Agent', folder: 'Folder' },
    starting: {
      label: 'Starting the session',
      title: 'Starting your agent',
      text: (machine: string) => `Preparing the session on ${machine}…`,
      connected: 'Connected to the machine',
      folder: 'Working folder selected',
      tool: (name: string) => `Starting ${name}`
    },
    failed: {
      label: 'Launch failed',
      title: 'The agent could not start',
      daemon: (why: string) => `The daemon refused: ${why}`,
      offline: (machine: string) => `${machine} is not connected: nothing was sent.`,
      lost: (machine: string) => `The connection to ${machine} was lost during the start. The session may have started: check the list before retrying.`,
      timeout: 'The daemon did not answer in time. No new session was confirmed.',
      edit: 'Edit settings',
      retry: 'Retry',
      kept: 'Your instruction is kept.'
    },
    browse: {
      button: 'Browse…',
      title: (machine: string) => `Folders on ${machine}`,
      close: 'Close',
      path: 'Folder path',
      up: 'Parent folder',
      open: (name: string) => `Open ${name}`,
      empty: 'No subfolders.',
      loading: 'Loading…',
      newFolder: 'New folder',
      newFolderName: 'New folder name',
      create: 'Create',
      choose: 'Choose this folder',
      failed: (why: string) => `Could not: ${why}`,
      offline: (machine: string) => `${machine} is not connected: the folders cannot be listed.`
    }
  },
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
      folder: 'Folder',
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
  },
  chat: {
    trigger: 'Talk to Ledge',
    label: 'Talk to Ledge',
    eyebrow: 'TALK TO LEDGE',
    identity: (sessions, projects) => `${sessions} ${plural(sessions, 'session', 'sessions')} · ${projects} ${plural(projects, 'project', 'projects')}`,
    purpose: 'Check where your projects stand or prepare your next task.',
    reset: 'New conversation',
    thread: 'History with Ledge',
    welcome: { title: 'What do you need?', text: 'Find the waiting requests and your team’s context.' },
    starters: { label: 'Suggestions for Ledge', items: ['Who needs me?', 'Give me a status of the projects', 'Prepare a new session'] },
    author: 'Ledge',
    thinking: 'Ledge is looking…',
    step: { sessions: 'Reads the sessions', pane: name => `Reads ${name}'s terminal`, reply: name => `Reads ${name}'s last reply`, git: name => `git in ${name}'s folder`, repo: path => `Reads ${path}` },
    source: { sessions: 'the sessions', pane: name => `${name}'s terminal`, reply: name => `${name}'s last reply`, git: name => `git in ${name}'s folder`, repo: path => path },
    sourcesNone: 'nothing read',
    sourcesLine: (list, time) => `Sources: ${list} · ${time}`,
    stop: 'Cancel',
    stopLabel: 'Cancel the current question',
    stopped: 'Question cancelled.',
    error: why => `Ledge could not answer: ${why}`,
    choose: name => `On ${name}.`,
    choices: 'Suggested machines',
    clarification: 'You can also answer in writing.',
    destination: name => `Destination: ${name}`,
    unavailable: 'disconnected',
    links: 'Sessions mentioned',
    open: name => `Open ${name}`,
    readonly: 'Read-only: the local daemon does not answer. The history with Ledge stays readable.',
    frozen: names => `${names}: connection lost. Ledge relies on the last known state of these machines.`,
    composer: {
      label: 'Talk to Ledge',
      placeholder: 'Ask Ledge your question…',
      send: 'Send ↑',
      hint: 'Ctrl / ⌘ + Enter to send',
      busy: 'Ledge is answering… You can prepare what comes next.',
      refused: 'Ledge did not take this question. Try again in a moment.',
      readonly: 'Read-only: the local daemon does not answer.'
    },
    card: {
      label: 'Proposed session', folder: 'Folder', tool: 'Harness', byDefault: tool => `${tool} · default`, prompt: 'Instruction', noPrompt: 'None, empty session',
      launch: 'Start the session', launching: 'Starting…', retry: 'Retry', orRephrase: 'or rephrase your request', orFolder: 'or give me another folder',
      failed: why => `Could not start: ${why}`, started: name => `${name} has started`, startedUnknown: 'Session started'
    },
    relay: {
      label: 'Instruction to send', session: 'Session', instruction: 'Instruction',
      send: 'Send', sending: 'Sending…', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or rephrase your request',
      queued: "is working; I'll send it as soon as it's done", sentTo: 'Sent to', failed: why => `Could not send: ${why}`,
      pill: { yours: 'your turn', working: 'working', waiting: 'waiting for you', stopped: 'stopped' }
    }
  }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
