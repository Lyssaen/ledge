import type { BotState } from '@ledge/ui/bots/poseFor';
import type { DaemonStatus, SshProblem } from '@ledge/fleet';
import type { DaemonInfo, UpdateFailure } from '@ledge/protocol';
import type { FinishedNotify, SoundCategory, SoundVolume } from '@ledge/ui/sounds/preferences';
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
  notify: {
    approval: (name: string) => `${name} attend votre accord`,
    question: (name: string) => `${name} a une question`,
    finished: (name: string) => `${name} a terminé`,
    failed: (name: string) => `${name} a rencontré une erreur`,
    manyTitle: 'Votre équipe',
    many: (n: number) => `${n} sessions vous attendent ou ont terminé`
  },
  settings: {
    title: 'Paramètres',
    subtitle: 'Personnalisez votre application Desktop et ses connexions.',
    back: 'Retour aux sessions',
    nav: 'Sections des paramètres',
    tabs: { display: 'Affichage', machines: 'Machines', notifications: 'Notifications', sounds: 'Sons', about: 'À propos' },
    display: {
      title: 'Votre application',
      autostart: 'Lancer au démarrage', autostartHint: 'Avec votre session Windows.', autostartMissing: 'Disponible dans l’application installée.',
      tool: 'Harnais par défaut', toolHint: 'Pour les nouvelles sessions et le chat Ledge.',
      lang: 'Langue', langHint: 'S’applique tout de suite, menu de la zone de notification compris.', langs: { fr: 'Français', en: 'English' } as Record<Lang, string>,
      scale: 'Échelle de l’interface', scaleHint: 'Taille du texte et des contrôles de Desktop.', auto: 'Auto',
      theme: 'Thème', themeHint: 'Change aussi la matière des mascottes.', themes: { dark: 'Sombre · Signal', light: 'Clair · Galet' },
      accent: 'Couleur de Ledge', accentHint: 'Accent personnalisable. Les couleurs des états restent inchangées.', hex: 'Code hexadécimal', coral: 'Corail',
      accentInvalid: 'Couleur invalide : utilisez # et six caractères hexadécimaux.',
      reduced: 'Mouvements réduits', reducedHint: 'Les états restent lisibles sans animation. La préférence système reste prioritaire.'
    },
    notifications: {
      title: 'Quand l’équipe a besoin de vous',
      dnd: 'Ne pas déranger', dndHint: 'Suspend les alertes et les sons ; les demandes restent visibles dans les sessions.',
      finished: 'Quand un bot ou Ledge a terminé', finishedHint: 'Choisissez comment Desktop vous avertit.',
      modes: { both: 'Alerte et son', bubble: 'Alerte visuelle', sound: 'Son', none: 'État de session uniquement' } as Record<FinishedNotify, string>,
      note: 'L’état de la session reste toujours visible, même sans alerte ni son.'
    },
    sounds: {
      title: 'Les signaux de votre équipe',
      enabled: 'Sons', enabledHint: 'Des tons courts et doux. Jamais en Ne pas déranger.',
      custom: 'Personnaliser les sons',
      volume: 'Volume', volumeHint: 'Le bouton Test représente le signal de question.',
      volumes: { quiet: 'Bas', normal: 'Normal', loud: 'Fort' } as Record<SoundVolume, string>,
      test: 'Test', dndOn: 'Ne pas déranger est activé.',
      when: 'Jouer un son quand',
      categories: { requests: 'Un bot a besoin de vous · accord, question', finished: 'Un bot ou Ledge a terminé sa tâche', errors: 'Quelque chose échoue', decisions: 'Vous acceptez ou refusez', team: 'Un bot arrive ou part' } as Record<SoundCategory, string>,
      behind: 'Seulement quand le terminal est derrière', behindHint: 'Pas de son si Windows Terminal est au premier plan. L’alerte visuelle reste disponible.',
      note: 'Un seul son à la fois ; les rafales sont regroupées. Ouvrir, fermer et survoler restent silencieux.'
    },
    machines: {
      title: 'Vos machines',
      note: 'Connexion SSH depuis WSL, comme dans Ledge classique.',
      status: { open: 'Connectée', connecting: 'Connexion…', unreachable: 'Déconnectée' } as Record<DaemonStatus, string>,
      localKind: 'Local · WSL',
      ssh: (alias: string) => `SSH · ${alias}`,
      version: (v: string | undefined) => (v ? `Ledge ${v}` : 'Version inconnue'),
      test: 'Tester', retry: 'Réessayer', edit: 'Modifier', remove: 'Retirer', cancel: 'Annuler',
      add: '＋ Ajouter une machine',
      addTitle: 'Ajouter une machine',
      editTitle: (label: string) => `Modifier ${label}`,
      label: 'Nom', labelAria: 'Nom de la machine', labelPlaceholder: 'Serveur de dev',
      alias: 'Alias SSH', aliasHint: 'Nom d’un bloc Host de ~/.ssh/config dans WSL.',
      before: 'Avant d’ajouter un serveur',
      checklist: ['L’alias fonctionne depuis WSL, sans mot de passe.', 'La clé du serveur est déjà approuvée.', 'Node 22+ et tmux sont installés.', 'Ledge est installé et démarré sur le serveur.'],
      probe: 'Tester la connexion', save: 'Enregistrer', saving: 'Enregistrement…',
      optional: 'Test facultatif : une machine injoignable peut être enregistrée.',
      probing: (alias: string) => `Connexion à ${alias}…`,
      probeOk: (v: string | undefined, n: number) => `${v ? `Ledge ${v}` : 'Ledge'} répond · ${n} ${plural(n, 'session', 'sessions')}`,
      problem: {
        alias: 'Alias introuvable. Ajoutez un bloc Host pour cet alias dans ~/.ssh/config de WSL.',
        key: 'La clé SSH est refusée. Vérifiez IdentityFile pour cet alias dans ~/.ssh/config de WSL.',
        hostKey: 'La clé du serveur n’est pas encore approuvée. Connectez-vous une fois depuis WSL avec ssh et cet alias.',
        unreachable: 'Le serveur ne répond pas. Il est peut-être éteint, ou hors du réseau.',
        ledge: 'Ledge est absent ou trop ancien sur ce serveur. Installez-le, puis lancez « ledge setup ».',
        stopped: 'Le service Ledge ne tourne pas sur le serveur. Lancez « ledge setup » sur le serveur.',
        local: 'Mettez à jour Ledge sur cette machine pour rejoindre un serveur.',
        other: 'La connexion a échoué.'
      } as Record<SshProblem, string>,
      errors: {
        invalid: 'Vérifiez le nom et l’alias SSH : lettres, chiffres, point, tiret ou souligné, sans espace.',
        duplicate: 'Cet alias est déjà ajouté.',
        full: 'Vous avez atteint 20 machines.',
        offline: 'Le daemon local n’est pas connecté : réessayez dans un instant.',
        timeout: 'Le daemon local n’a pas répondu. Rien n’a changé.',
        refused: 'Le daemon local a refusé cette liste. Rien n’a changé.'
      },
      saved: (label: string) => `${label} est enregistrée.`,
      removed: (label: string) => `${label} est retirée de la liste.`,
      confirm: (label: string) => `Retirer ${label} ? Ses sessions quitteront la vue ; le travail continue sur le serveur.`
    },
    about: {
      title: 'Application et daemon',
      app: 'Application Desktop',
      daemon: (label: string) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'clone git', unknown: 'installation inconnue' } as Record<DaemonInfo['install'], string>,
      unknown: 'Version inconnue',
      latest: 'Dernière version',
      latestUnknown: 'Pas encore vérifiée',
      latestCurrent: 'Desktop est à jour',
      auto: 'Rechercher les mises à jour',
      autoHint: 'Au démarrage, puis toutes les 6 heures. Installation seulement après votre clic.',
      never: 'Jamais vérifié',
      checkedAt: (when: string) => `Vérifié le ${when}`,
      phase: {
        idle: 'Aucune vérification pour l’instant.',
        checking: 'Recherche d’une nouvelle version…',
        current: 'Desktop est à jour.',
        available: (v: string) => `Ledge ${v} est disponible. Rien n’est installé sans votre clic.`,
        installing: (v: string) => `Installation de Ledge ${v}. Desktop redémarrera seul.`,
        failedCheck: 'La vérification a échoué. Vérifiez votre connexion.',
        failedInstall: 'L’installation a échoué. L’application n’a pas changé.'
      },
      check: 'Vérifier',
      updateApp: 'Mettre à jour l’application',
      installing: (percent: number | null) => (percent === null ? 'Installation…' : `Installation… ${percent} %`),
      updateDaemon: 'Mettre à jour le daemon',
      log: 'Journal du daemon',
      step: {
        sent: (v: string) => `Demande envoyée au daemon local : ${v}`,
        installing: 'Installation de la nouvelle version…',
        restarting: 'Redémarrage du daemon…',
        done: (v: string) => `Daemon à jour : ${v}`
      },
      failed: {
        'git-install': 'Votre daemon tourne depuis un clone git : mettez-le à jour vous-même.',
        'no-systemd': 'Le daemon ne tourne pas comme service : il ne peut pas se relancer seul.',
        'sessions-at-risk': 'Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. Fermez-les, ou redémarrez WSL, puis réessayez.',
        'npm-failed': 'Le daemon n’a pas pu se mettre à jour. Rien n’a changé.',
        busy: 'Une mise à jour est déjà en cours.',
        offline: 'Le daemon local n’est pas connecté : rien n’a été envoyé.',
        timeout: 'Le daemon ne répond plus.'
      } as Record<UpdateFailure | 'offline' | 'timeout', string>,
      timeoutCommand: 'systemctl --user status ledge-daemon'
    }
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
    /** The daemon's and fleet's chat, launch and relay errors, said in the UI's language (`chat/errors.ts`). */
    errors: {
      unknown: 'erreur inattendue',
      from: (machine: string, text: string) => `${machine} : ${text}`,
      oneAtATime: 'une autre question est en cours, attendez sa réponse',
      offline: (machine: string) => `${machine} est hors ligne`,
      noRouting: 'mettez à jour un daemon connecté pour parler à plusieurs machines',
      routingTimeout: 'le choix de la machine a pris trop de temps',
      routingFailed: 'le choix de la machine a échoué',
      noAnswer: (tool: string) => `${tool} n’a pas répondu en 3 minutes`,
      couldNotStart: (tool: string) => `${tool} n’a pas pu démarrer`,
      exited: (tool: string, code: string) => `${tool} s’est arrêté (code ${code})`,
      reported: (tool: string) => `${tool} a signalé une erreur`,
      unknownProposal: 'cette proposition n’existe plus',
      alreadyLaunched: 'cette session est déjà lancée',
      unknownRelay: 'cette instruction n’existe plus',
      alreadySent: 'cette instruction est déjà envoyée',
      alreadyQueued: 'cette instruction attend déjà son tour',
      nothingQueued: 'aucune instruction en attente',
      unknownDestination: 'la machine de cette question est inconnue',
      stoppedBefore: (name: string) => `la session ${name} s’est arrêtée avant de recevoir l’instruction`,
      unknownSession: 'la session n’existe plus',
      readOnly: 'session démarrée hors de Ledge, en lecture seule',
      choicePrompt: 'la session attend une acceptation ou un refus, pas un texte',
      emptyReply: 'l’instruction est vide',
      freeText: 'les réponses libres ne sont pas encore prises en charge, répondez dans le terminal',
      noPrompt: 'aucune invite visible dans le terminal, ouvrez l’onglet',
      notTaken: 'le terminal ne l’a pas prise en compte',
      invalidMessage: 'le daemon a refusé la demande',
      noFolder: (path: string) => `le dossier ${path} n’existe pas`,
      notFolder: (path: string) => `${path} n’est pas un dossier`,
      notAbsolute: (path: string) => `${path} n’est pas un chemin absolu`,
      tmuxFailed: 'tmux n’a pas pu ouvrir la session'
    },
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
  notify: {
    approval: (name) => `${name} needs your approval`,
    question: (name) => `${name} has a question`,
    finished: (name) => `${name} has finished`,
    failed: (name) => `${name} ran into an error`,
    manyTitle: 'Your team',
    many: (n) => `${n} sessions need you or have finished`
  },
  settings: {
    title: 'Settings',
    subtitle: 'Make Desktop yours and manage its connections.',
    back: 'Back to sessions',
    nav: 'Settings sections',
    tabs: { display: 'Display', machines: 'Machines', notifications: 'Notifications', sounds: 'Sounds', about: 'About' },
    display: {
      title: 'Your app',
      autostart: 'Launch at start-up', autostartHint: 'With your Windows session.', autostartMissing: 'Available in the installed app.',
      tool: 'Default harness', toolHint: 'For new sessions and the Ledge chat.',
      lang: 'Language', langHint: 'Applies at once, the notification area menu included.', langs: { fr: 'Français', en: 'English' },
      scale: 'Interface scale', scaleHint: 'Size of Desktop’s text and controls.', auto: 'Auto',
      theme: 'Theme', themeHint: 'Also changes the mascots’ material.', themes: { dark: 'Dark · Signal', light: 'Light · Pebble' },
      accent: 'Ledge colour', accentHint: 'Your own accent. State colours stay the same.', hex: 'Hex code', coral: 'Coral',
      accentInvalid: 'Invalid colour: use # and six hexadecimal characters.',
      reduced: 'Reduced motion', reducedHint: 'States stay readable without animation. The system setting wins.'
    },
    notifications: {
      title: 'When the team needs you',
      dnd: 'Do not disturb', dndHint: 'Holds alerts and sounds; requests stay visible in the sessions.',
      finished: 'When a bot or Ledge is done', finishedHint: 'Choose how Desktop tells you.',
      modes: { both: 'Alert and sound', bubble: 'Visual alert', sound: 'Sound', none: 'Session state only' },
      note: 'The session state always stays visible, even without an alert or a sound.'
    },
    sounds: {
      title: 'Your team’s signals',
      enabled: 'Sounds', enabledHint: 'Short, soft tones. Never in Do not disturb.',
      custom: 'Customise sounds',
      volume: 'Volume', volumeHint: 'The Test button plays the question signal.',
      volumes: { quiet: 'Low', normal: 'Normal', loud: 'Loud' },
      test: 'Test', dndOn: 'Do not disturb is on.',
      when: 'Play a sound when',
      categories: { requests: 'A bot needs you · approval, question', finished: 'A bot or Ledge has finished its task', errors: 'Something fails', decisions: 'You allow or deny', team: 'A bot arrives or leaves' },
      behind: 'Only when the terminal is behind', behindHint: 'No sound when Windows Terminal is in front. The visual alert stays available.',
      note: 'One sound at a time; bursts are grouped. Opening, closing and hovering stay silent.'
    },
    machines: {
      title: 'Your machines',
      note: 'SSH connection from WSL, as in classic Ledge.',
      status: { open: 'Connected', connecting: 'Connecting…', unreachable: 'Disconnected' },
      localKind: 'Local · WSL',
      ssh: (alias) => `SSH · ${alias}`,
      version: (v) => (v ? `Ledge ${v}` : 'Unknown version'),
      test: 'Test', retry: 'Retry', edit: 'Edit', remove: 'Remove', cancel: 'Cancel',
      add: '＋ Add a machine',
      addTitle: 'Add a machine',
      editTitle: (label) => `Edit ${label}`,
      label: 'Name', labelAria: 'Machine name', labelPlaceholder: 'Dev server',
      alias: 'SSH alias', aliasHint: 'Name of a Host block in ~/.ssh/config in WSL.',
      before: 'Before adding a server',
      checklist: ['The alias works from WSL, without a password.', 'The server’s host key is already approved.', 'Node 22+ and tmux are installed.', 'Ledge is installed and running on the server.'],
      probe: 'Test the connection', save: 'Save', saving: 'Saving…',
      optional: 'The test is optional: an unreachable machine can be saved.',
      probing: (alias) => `Connecting to ${alias}…`,
      probeOk: (v, n) => `${v ? `Ledge ${v}` : 'Ledge'} answers · ${n} ${plural(n, 'session', 'sessions')}`,
      problem: {
        alias: 'Alias not found. Add a Host block for this alias to ~/.ssh/config in WSL.',
        key: 'The SSH key is refused. Check IdentityFile for this alias in ~/.ssh/config in WSL.',
        hostKey: 'The server’s host key is not approved yet. Connect once from WSL with ssh and this alias.',
        unreachable: 'The server does not answer. It may be off, or out of the network.',
        ledge: 'Ledge is missing or too old on this server. Install it, then run “ledge setup”.',
        stopped: 'The Ledge service is not running on the server. Run “ledge setup” on the server.',
        local: 'Update Ledge on this machine to reach a server.',
        other: 'The connection failed.'
      },
      errors: {
        invalid: 'Check the name and SSH alias: letters, digits, dot, dash or underscore, no spaces.',
        duplicate: 'This alias is already added.',
        full: 'You have reached 20 machines.',
        offline: 'The local daemon is not connected: try again in a moment.',
        timeout: 'The local daemon did not answer. Nothing changed.',
        refused: 'The local daemon refused this list. Nothing changed.'
      },
      saved: (label) => `${label} is saved.`,
      removed: (label) => `${label} was removed from the list.`,
      confirm: (label) => `Remove ${label}? Its sessions will leave the view; the work on the server goes on.`
    },
    about: {
      title: 'App and daemon',
      app: 'Desktop app',
      daemon: (label) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'git clone', unknown: 'unknown install' },
      unknown: 'Unknown version',
      latest: 'Latest version',
      latestUnknown: 'Not checked yet',
      latestCurrent: 'Desktop is up to date',
      auto: 'Check for updates',
      autoHint: 'At start-up, then every 6 hours. Installs only after your click.',
      never: 'Never checked',
      checkedAt: (when) => `Checked on ${when}`,
      phase: {
        idle: 'No check yet.',
        checking: 'Looking for a new version…',
        current: 'Desktop is up to date.',
        available: (v) => `Ledge ${v} is available. Nothing is installed without your click.`,
        installing: (v) => `Installing Ledge ${v}. Desktop will restart on its own.`,
        failedCheck: 'The check failed. Check your connection.',
        failedInstall: 'The install failed. The app did not change.'
      },
      check: 'Check',
      updateApp: 'Update the app',
      installing: (percent) => (percent === null ? 'Installing…' : `Installing… ${percent}%`),
      updateDaemon: 'Update the daemon',
      log: 'Daemon log',
      step: {
        sent: (v) => `Request sent to the local daemon: ${v}`,
        installing: 'Installing the new version…',
        restarting: 'Restarting the daemon…',
        done: (v) => `Daemon up to date: ${v}`
      },
      failed: {
        'git-install': 'Your daemon runs from a git clone: update it yourself.',
        'no-systemd': 'The daemon does not run as a service: it cannot restart itself.',
        'sessions-at-risk': 'Your sessions run inside the daemon service: a restart would close them. Close them, or restart WSL, then retry.',
        'npm-failed': 'The daemon could not update. Nothing changed.',
        busy: 'An update is already running.',
        offline: 'The local daemon is not connected: nothing was sent.',
        timeout: 'The daemon is not answering.'
      },
      timeoutCommand: 'systemctl --user status ledge-daemon'
    }
  },
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
    errors: {
      unknown: 'unexpected error',
      from: (machine, text) => `${machine}: ${text}`,
      oneAtATime: 'another question is in progress, wait for its answer',
      offline: machine => `${machine} is offline`,
      noRouting: 'update a connected daemon to talk to several machines',
      routingTimeout: 'choosing the machine took too long',
      routingFailed: 'choosing the machine failed',
      noAnswer: tool => `${tool} did not answer within 3 minutes`,
      couldNotStart: tool => `${tool} could not start`,
      exited: (tool, code) => `${tool} stopped (code ${code})`,
      reported: tool => `${tool} reported an error`,
      unknownProposal: 'this proposal no longer exists',
      alreadyLaunched: 'this session has already been started',
      unknownRelay: 'this instruction no longer exists',
      alreadySent: 'this instruction has already been sent',
      alreadyQueued: 'this instruction is already waiting its turn',
      nothingQueued: 'no instruction is waiting',
      unknownDestination: 'the machine of this question is unknown',
      stoppedBefore: name => `the session ${name} stopped before it got the instruction`,
      unknownSession: 'the session no longer exists',
      readOnly: 'session started outside Ledge, read only',
      choicePrompt: 'the session waits for accept or deny, not text',
      emptyReply: 'the instruction is empty',
      freeText: 'free-text answers are not supported yet, answer in the terminal',
      noPrompt: 'no prompt visible in the terminal, open the tab',
      notTaken: 'the terminal did not take it',
      invalidMessage: 'the daemon refused the request',
      noFolder: path => `the folder ${path} does not exist`,
      notFolder: path => `${path} is not a folder`,
      notAbsolute: path => `${path} is not an absolute path`,
      tmuxFailed: 'tmux could not open the session'
    },
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
