import { MESSAGE_MAX } from '@ledge/protocol';

/** Every French string of the phone app lives here (decision D13). */
export const copy = {
  appName: 'Ledge',
  inbox: {
    title: 'À traiter',
    subtitle: (n: number) => n === 0 ? 'Tout est calme' : n === 1 ? '1 demande. Choisissez par où commencer.' : `${n} demandes. Choisissez par où commencer.`,
    filtersLabel: 'Filtrer les demandes',
    filters: { all: 'Tout', permission: 'Autorisations', question: 'Questions', tasks: 'Tâches' },
    /** With the closed tasks of Ledge (ledge home spec §2.4). */
    subtitleTasks: (requests: number, tasks: number) => {
      const r = requests === 0 ? '' : requests === 1 ? '1 demande' : `${requests} demandes`;
      const t = tasks === 1 ? '1 tâche finie' : `${tasks} tâches finies`;
      return `${r ? `${r} et ` : ''}${t}. Choisissez par où commencer.`;
    },
    taskDone: 'Tâche finie', taskClosed: 'Tâche close',
    finishedTitle: (title: string) => `A fini « ${title} »`, refusedTitle: (title: string) => `A refusé « ${title} »`, droppedTitle: (title: string) => `A abandonné « ${title} »`,
    ledgeTask: 'Tâche de Ledge', seeResult: 'Voir le résultat', putAway: 'Ranger',
    oldestFirst: 'LES PLUS ANCIENNES D’ABORD',
    examine: 'Examiner',
    lastKnown: 'Dernier état connu',
    upToDate: 'Vous êtes à jour',
    upToDateHint: 'Aucune demande n’attend de décision.',
    seeAgents: 'Voir les agents',
    emptyFilter: 'Aucune demande dans ce filtre',
    emptyFilterHint: 'Les autres demandes restent dans « Tout ».',
    offlineNote: 'Vous pouvez consulter les demandes. Aucune décision ne sera envoyée hors connexion.'
  },
  nav: {
    label: 'Navigation principale', inbox: 'À traiter', agents: 'Agents', chat: 'Ledge', teams: 'Équipes',
    /** « Retour », named after the screen it leads to; plain when that screen is not known (after a reload). */
    back: 'Retour',
    backTo: { inbox: 'Retour aux demandes', agents: 'Retour aux agents', teams: 'Retour aux équipes', chat: 'Retour à Ledge', thread: 'Retour au fil', terminal: 'Retour au terminal', request: 'Retour à la demande', connection: 'Retour à la connexion' } as Partial<Record<string, string>>
  },
  images: {
    attach: 'Joindre une image', remove: 'Retirer l\'image', tooLarge: 'Image trop lourde, même réduite', notImage: 'Ce fichier n\'est pas une image', max: '5 images au plus par message',
    dialog: 'Répondez d\'abord à la question, l\'image partira après', failed: 'Image non envoyée',
    noPreview: 'Image trop lourde pour le téléphone · ouvrir sur le PC', unavailable: 'Image indisponible',
    view: 'Image', share: 'Partager', save: 'Enregistrer', close: 'Fermer', prev: 'Image précédente', next: 'Image suivante'
  },
  chat: {
    title: 'Ledge',
    subtitle: (agents: number, repos: number) => `Fil du téléphone · ${agents} ${agents > 1 ? 'agents' : 'agent'}, ${repos} ${repos > 1 ? 'repos' : 'repo'}`,
    /** With teams (ledge home spec §2.4): Ledge is the operator. */
    operator: (agents: number, teams: number) => `Opérateur · ${agents} ${agents > 1 ? 'agents' : 'agent'}, ${teams} ${teams > 1 ? 'équipes' : 'équipe'}`,
    point: {
      title: 'Le point', label: 'Le point', ago: (s: string) => `il y a ${s}`,
      yours: 'À TOI', yoursLabel: 'À toi', teams: 'ÉQUIPES', teamsLabel: 'Équipes', given: 'CONFIÉES PAR LEDGE', givenLabel: 'Confiées par Ledge',
      yes: 'Oui', no: 'Non', see: 'Voir', finished: 'a fini sa tâche', refused: 'a refusé sa tâche', dropped: 'a abandonné sa tâche',
      seats: (n: number) => `${n} ${n > 1 ? 'postes' : 'poste'}`, resting: 'au repos', resume: 'Reprendre',
      progress: (done: number, given: number) => `${done}/${given}`,
      state: { open: 'ouverte', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' },
      calm: 'Rien ne t’attend. Demande à Ledge ce que tu veux savoir ou faire.',
      near: (pct: number) => `contexte ${pct} %`, nearHint: 'La relève se lance depuis le PC.'
    },
    team: {
      label: 'Équipe proposée', team: 'Équipe', seats: 'Postes', newTable: (project: string) => `nouvelle table dans la pièce ${project}`,
      launch: 'Lancer l’équipe', launched: (at: string) => `Équipe lancée à ${at}`, byKey: 'confirmé avec la clé de l’appareil',
      notLaunched: 'Pas lancée.', autonomy: { ask: 'ask', edits: 'edits', auto: 'auto' },
      autoWarning: (who: string) => `${who} travaillera sans demander.`, openAgents: 'Voir la table'
    },
    task: {
      label: 'Tâche à confier', give: 'Confier', waitTeam: 'active une fois l’équipe lancée',
      given: (name: string, id: string, state: string) => `Confiée à ${name} · ${id} · ${state}`, notGiven: 'Pas confiée.'
    },
    reset: 'Nouvelle conversation',
    empty: 'Posez une question sur vos agents et vos repos. Ce fil est propre à ce téléphone.',
    suggestions: {
      waiting: 'Qui attend quelque chose de moi ?',
      session: (name: string) => `Où en est ${name} sur le badge d'attente ?`,
      repo: (repo: string) => `Qu'est-ce qui a changé dans ${repo} aujourd'hui ?`,
      team: 'Monte une équipe…',
      teamWhere: (name: string) => `Où en est ${name} ?`
    },
    stop: 'Arrêter',
    stepsLabel: 'Étapes',
    sources: 'Sources : ',
    field: 'Question pour Ledge',
    placeholder: 'Demander à Ledge…',
    send: 'Envoyer la question',
    busy: 'Ledge répond déjà à d\'autres questions. Réessayez dans un instant.',
    timeout: 'Ledge n\'a pas répondu à temps.',
    failed: 'Ledge n\'a pas pu répondre.',
    cancelled: 'Question arrêtée.',
    offline: 'Hors ligne : posez la question quand le PC sera joignable.',
    cut: 'Réponse coupée : la suite est sur le PC.',
    relayLabel: 'Consigne proposée', launchLabel: 'Session proposée',
    relayHead: (name: string) => `Envoyer à ${name}`,
    launchHead: (tool: string, project: string) => `Lancer ${tool} dans ${project}`,
    ignore: 'Ignorer', relayGo: 'Envoyer',
    queued: (name: string) => `En attente : ${name} est occupé.`,
    sentTo: (name: string) => `Envoyé à ${name} · `, launchedTo: 'Lancée · ', seeThread: 'voir son fil',
    notSent: 'Pas envoyé.', notLaunched: 'Pas lancée.',
    launchSetup: 'Protégez d\'abord vos accords depuis Connexion.',
    closeLabel: 'Sessions à fermer', closeRow: 'Fermer', closeAll: (n: number) => `Fermer tout (${n})`,
    closing: 'Fermeture…', closed: 'Fermée', killed: 'Fermée de force', ended: 'Terminée',
    closeFailed: 'Échec de la fermeture', closeSetup: 'Protégez d\'abord vos accords depuis Connexion.',
    steps: {
      sessions: (n: number) => `Lit les ${n} sessions…`,
      pane: (name: string) => `Regarde le terminal de ${name}…`,
      reply: (name: string) => `Lit la dernière réponse de ${name}…`,
      look: (name: string) => `Regarde ${name}…`
    }
  },
  /** The Équipes tab: the team definitions and the roles the PC offers, and « Lever » (raising a team from a definition). The word « modèle » stays out of the phone. */
  teams: {
    subtitle: (teams: number, roles: number) => `${teams} ${teams > 1 ? 'équipes' : 'équipe'} · ${roles} ${roles > 1 ? 'rôles' : 'rôle'}`,
    newTeam: 'Nouvelle équipe', newRole: '+ Nouveau rôle',
    teamsHead: 'ÉQUIPES', teamsLabel: 'Équipes disponibles', rolesHead: 'RÔLES', rolesLabel: 'Rôles',
    noTeams: 'Aucune équipe définie.', noRoles: 'Aucun rôle défini.',
    lever: 'Lever', noProject: 'Aucun projet avec un dépôt local sur ce PC : impossible de lever une équipe.',
    autonomy: { ask: 'demande', edits: 'édite', auto: 'auto' } as Record<'ask' | 'edits' | 'auto', string>,
    live: (name: string) => `${name} est levée · la suivre dans Agents ›`,
    launched: (name: string) => `${name} levée.`,
    levering: (name: string) => `Lever ${name}`, name: 'Nom', project: 'Projet', pickProject: 'Choisir un projet',
    launchSeats: (n: number) => `Lancer l'équipe · ${n} ${n > 1 ? 'sièges' : 'siège'}`, cancel: 'Annuler',
    notLaunched: 'Pas levée.',
    /** Why the PC or the phone refused an operation of this tab; any other reason says only that it was not done. */
    reason: {
      changed: 'le fichier a changé sur le PC',
      exists: 'Un fichier de ce nom existe déjà.',
      unknown_project: 'Ce projet n’a pas de dépôt sur ce PC.',
      invalid: 'Cette équipe ne peut pas être levée telle quelle.',
      confirm_required: 'La confirmation avec l’appareil est requise.',
      assertion_invalid: 'La vérification de l’appareil a été refusée. Réessayez.',
      assertion_expired: 'La vérification a expiré. Recommencez.',
      conflict: 'Une autre opération est en cours sur le PC. Réessayez.'
    } as Partial<Record<string, string>>,
    loading: 'Lecture du catalogue…', unavailable: 'Catalogue indisponible', retry: 'Réessayer',
    problemsHead: 'FICHIERS ILLISIBLES', problemsLabel: 'Fichiers illisibles'
  },
  agents: {
    title: 'Agents',
    subtitle: (sessions: number, projects: number) => `${sessions} ${sessions > 1 ? 'sessions' : 'session'} · ${projects} ${projects > 1 ? 'projets' : 'projet'} sur ce PC`,
    offline: 'Dernier état connu · connexion perdue',
    unread: '● Non lu',
    working: 'Travaille sur les dernières modifications.',
    state: { working: 'Au travail', idle: 'Disponible', exited: 'Terminée', error: 'Erreur' },
    empty: 'Aucune session sur ce PC', emptyHint: 'Les agents lancés depuis Ledge apparaissent ici.',
    open: (name: string, task: string) => `${name} · ${task}`,
    /** The tables of a project (atelier rooms spec, as the phone draws them). */
    teamsWorking: (n: number) => n === 0 ? '' : ` · ${n} ${n > 1 ? 'équipes' : 'équipe'} au travail`,
    tables: (label: string, n: number) => `${label} · ${n} ${n > 1 ? 'tables' : 'table'}`,
    team: 'équipe · opérateur Ledge', common: 'table commune', resting: 'au repos', resume: 'Reprendre',
    teamLabel: (name: string) => `Équipe ${name}`,
    /** A session's context and relief (context handover spec §3.2): shown here, started from the PC. */
    context: (pct: number) => `contexte ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`
  },
  link: {
    online: 'connecté', offline: 'déconnecté',
    /** The header's way to the connection screen, for screen readers. */
    openConnection: 'Connexion du téléphone',
    lostTitle: 'Connexion au PC perdue',
    lostBody: 'Le PC, le réseau ou Tailscale est indisponible. Les demandes ci-dessous peuvent avoir changé.',
    lostDetail: 'Dernier état connu. Reconnectez-vous pour vérifier si cette demande attend toujours une décision.',
    lastKnownAt: (t: string) => `Dernier état connu · ${t}`,
    reconnect: 'Reconnecter et actualiser',
    reconnecting: 'Reconnexion…'
  },
  /** A request's badge: the desktop's words for what waits on the user. */
  kind: { permission: 'Votre accord', question: 'Une question', plan: 'Plan', diff: 'Modification' },
  tools: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', omp: 'OMP' },
  detail: {
    back: 'Retour aux demandes',
    heading: { permission: 'Une autorisation', question: 'Une question', plan: 'Un plan', diff: 'Des modifications' },
    commandTitle: 'Commande à autoriser',
    branch: 'Branche', asked: 'Demandé',
    ago: (age: string) => `Il y a ${age}`,
    context: 'Contexte de la demande',
    options: 'Réponses proposées',
    editsInProject: 'Modification dans le projet',
    editsInProjectBody: 'Le fichier sera modifié dans le dossier de cette session, et nulle part ailleurs.',
    destination: 'Destination'
  },
  decide: {
    deny: 'Refuser', allow: 'Autoriser une fois',
    onPc: 'À accepter sur le PC',
    onPcHint: 'Une demande à impact élevé s’accepte sur le PC. Vous pouvez la refuser d’ici.',
    hint: 'La décision sera transmise immédiatement au PC.',
    offlineHint: 'Aucune décision ne sera envoyée hors connexion.',
    readOnly: 'Session démarrée hors de Ledge : répondez dans le terminal.',
    answerOnPc: 'Cet agent ne peut pas recevoir de réponse libre depuis le téléphone. Répondez sur le PC.',
    answerHint: 'La réponse sera transmise immédiatement au PC.',
    send: 'Envoyer ma réponse',
    otherInvalid: `Le PC n’a pas accepté cette réponse. Corrigez-la, elle tient sur une ligne de ${MESSAGE_MAX} caractères au plus.`,
    otherUnsupported: 'Cet agent ne peut pas recevoir de réponse libre depuis le téléphone. Choisissez une option ou répondez sur le PC.',
    sending: 'Transmission au PC…', sendingBody: 'En attente de confirmation du terminal.',
    uncertain: 'Réception non confirmée',
    uncertainBody: 'La connexion a été perdue pendant l’envoi. La décision a peut-être été reçue. Vérifiez son état avant de recommencer.',
    check: 'Reconnecter et vérifier', checking: 'Vérification…',
    changed: 'La demande a été mise à jour. Relisez-la avant de décider.',
    reread: 'J’ai relu la demande',
    busy: 'Une autre décision est en cours sur le PC.',
    notTaken: 'Le terminal n’a pas confirmé. La demande est toujours en attente.',
    noPrompt: 'Le terminal n’affiche plus la demande. Ouvrez-le sur le PC.',
    failed: 'La décision n’a pas pu être transmise.'
  },
  result: {
    header: 'Demande traitée',
    allowed: 'Autorisation prise en compte', denied: 'Refus pris en compte', answered: 'Réponse prise en compte',
    body: 'Le terminal a reçu votre décision. Elle apparaît maintenant dans le fil de cette session.',
    thread: (bot: string) => `Voir le fil de ${bot}`,
    final: 'Une décision transmise ne peut pas être annulée.',
    back: 'Retour aux demandes'
  },
  thread: {
    back: 'Retour aux agents', title: 'Conversation avec un agent',
    terminal: (bot: string) => `Ouvrir le terminal de ${bot}`,
    log: (bot: string) => `Échanges avec ${bot}`,
    cut: 'Message raccourci', more: 'Messages plus anciens sur le PC',
    loading: 'Chargement du fil…', unavailable: 'Fil indisponible hors connexion', empty: 'Aucun échange pour le moment.',
    unknown: 'Cette session n’existe plus sur le PC.', unknownBack: 'Retour aux agents',
    suggestion: 'Suggestion pour la suite',
    agentLabel: 'Réponse de l’agent',
    awaiting: 'Décision attendue · dans « À traiter »', examine: 'Examiner la demande',
    event: {
      accept: (from: string) => `Accord pris en compte · depuis ${from}`,
      deny: (from: string) => `Refus pris en compte · depuis ${from}`,
      answer: (option: string) => `Réponse prise en compte · ${option}`,
      resolved: 'Traitée dans le terminal', interrupt: 'Interruption transmise',
      fromPc: 'le PC', fromPhone: 'le téléphone'
    },
    delivery: { sending: 'Envoi au PC…', taken: 'Pris par le terminal', takenNow: 'Pris par le terminal · à l’instant', uncertain: 'Réception non confirmée' },
    composer: {
      label: (bot: string) => `Message pour ${bot}`, send: (bot: string) => `Envoyer à ${bot}`,
      quickLabel: 'Consignes rapides',
      placeholder: { idle: (bot: string) => `Écrire à ${bot}…`, working: 'L’agent travaille…', awaiting: 'Traitez la demande ci-dessus', offline: 'Reconnectez-vous pour écrire', connecting: 'Connexion en cours…', ended: 'Session terminée', readOnly: 'Répondez dans le terminal' },
      status: { idle: 'Disponible pour votre consigne', working: 'Au travail · consultez le terminal', awaiting: 'En attente d’une décision', offline: 'Connexion perdue · dernier état connu', connecting: 'Connexion en cours…', sending: 'Envoi au PC…', taken: 'Consigne reçue · l’agent reprend', ended: 'Session terminée', readOnly: 'Session démarrée hors de Ledge' },
      reconnect: 'Reconnecter', tooLong: (max: number) => `Le message est trop long : ${max} caractères au plus.`,
      untypable: 'Le message doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.',
      failTitle: 'Message non envoyé', uncertainTitle: 'Réception non confirmée',
      lost: 'Le PC est injoignable. Votre brouillon est conservé.',
      imageGone: 'Une image n’est plus disponible : retirez-la et recollez-la. Votre brouillon est conservé.',
      busy: 'L’agent n’est plus disponible pour une consigne. Votre brouillon est conservé.',
      invalid: (max: number) => `Le message n’a pas été accepté par le PC (${max} caractères au plus). Votre brouillon est conservé.`,
      readOnly: 'Cette session a été démarrée hors de Ledge : écrivez dans le terminal.',
      forbidden: 'Ce téléphone n’est plus autorisé. Votre brouillon est conservé.',
      uncertain: 'La connexion a été perdue ou le terminal n’a pas confirmé. Le message a peut-être été reçu : vérifiez le terminal avant de le renvoyer. Votre brouillon est conservé.'
    }
  },
  terminal: {
    title: (bot: string) => `Terminal de ${bot}`, back: 'Retour au fil',
    live: 'Lecture seule · en direct', waiting: 'Lecture seule · en attente', offline: 'Lecture seule · dernier état connu',
    smaller: 'Réduire le texte', larger: 'Agrandir le texte',
    output: 'Sortie du terminal, défilement horizontal', empty: 'Aucune sortie pour le moment.', unknown: 'Cette session n’existe plus sur le PC.',
    scrollHint: 'Faites défiler horizontalement pour lire les lignes longues.',
    interrupt: (bot: string) => `Interrompre ${bot}`, sending: 'Interruption en cours…', sent: 'Interruption transmise',
    note: 'Interrompre n’annule pas les actions déjà effectuées.',
    why: { waiting: 'Une décision est attendue : traitez-la d’abord.', offline: 'Reconnectez-vous pour interrompre.', idle: 'L’agent ne travaille pas.' },
    fail: 'L’interruption n’a pas été transmise. Vérifiez le terminal sur le PC.',
    readOnly: 'Session démarrée hors de Ledge : interrompez-la dans le terminal du PC.',
    uncertain: 'Réception non confirmée : vérifiez le terminal avant de recommencer.'
  },
  question: {
    legend: 'Choisir une réponse',
    other: 'Autre réponse',
    fieldLabel: (bot: string) => `Votre réponse à ${bot}`,
    placeholder: 'Précisez votre choix…',
    long: (max: number) => `La réponse est trop longue (${max} caractères au plus).`,
    untypable: 'La réponse doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.',
    digit: 'Un chiffre seul serait lu comme le numéro d’une option. Choisissez l’option ci-dessus, ou écrivez la réponse en toutes lettres.'
  },
  /** OMP's dialogs: an option to tap, or every question of an `ask` answered together. */
  answers: {
    send: 'Envoyer les réponses',
    cancel: 'Annuler la demande',
    missing: (n: number) => `${n} question${n > 1 ? 's' : ''} sans réponse`,
    change: 'Choisir une autre réponse',
    legend: 'Choisir une option'
  },
  consequence: {
    forceTitle: 'Peut remplacer l’historique distant',
    forceBody: (dest?: string) => `Les commits présents sur ${dest ?? 'le dépôt distant'} peuvent être écrasés. Les autres personnes travaillant sur cette branche peuvent être affectées.`,
    pushTitle: 'Publie sur un dépôt distant',
    pushBody: 'Les modifications seront visibles par les personnes qui ont accès à ce dépôt.',
    configuredRemote: 'le dépôt distant configuré',
    destroys: ['Supprime des fichiers ou des modifications', 'Des fichiers ou des modifications non enregistrées peuvent être perdus.'],
    deploys: ['Modifie un déploiement ou une infrastructure', 'Un environnement en service peut changer ou devenir indisponible.'],
    publishes: ['Publie un paquet', 'Une version publiée peut déjà avoir été téléchargée et ne se retire pas toujours.'],
    pipes_to_shell: ['Exécute un script téléchargé', 'Le code téléchargé s’exécute sans avoir été lu, avec les permissions de cette session.'],
    network: ['Accède au réseau', 'La commande peut envoyer ou recevoir des données sur le réseau.'],
    writes_outside_folder: ['Écrit hors du dossier de la session', 'La commande peut modifier des fichiers en dehors du dossier de cette session.'],
    sensitive_path: ['Touche un fichier sensible', 'Ce fichier peut contenir des secrets ou une configuration sensible.'],
    script: ['Exécute un script du dépôt', 'Il s’exécute avec les permissions de cette session et peut modifier des fichiers ou accéder au réseau.'],
    plan: ['Valide un plan : l’agent passera à l’exécution', 'Après votre accord, l’agent exécute le plan sans redemander chaque étape.'],
    unknown: ['Commande que Ledge ne sait pas analyser', 'Ledge ne peut pas dire ce que cette commande fera. Lisez-la attentivement avant de confirmer.']
  },
  risk: {
    badge: 'Impact élevé'
  },
  gone: {
    header: 'Demande', title: 'Déjà traitée sur le PC', body: 'Cette demande a été résolue ailleurs. Aucune nouvelle décision n’a été envoyée.', back: 'Retour aux demandes',
    staleTitle: 'Cette demande ne figure plus dans le dernier état connu.', staleBody: 'Reconnectez-vous pour vérifier si elle attend toujours une décision.'
  },
  loading: 'Chargement de la demande…',
  connection: {
    title: 'Connexion', back: 'Retour aux demandes', pc: 'PC', status: 'État', unknown: 'Inconnu',
    states: { online: 'Connecté', offline: 'Déconnecté', connecting: 'Connexion en cours…' },
    account: 'Compte', relay: 'Serveur', pcFingerprint: 'Empreinte du PC', version: 'Version de l’app', appFingerprint: 'Empreinte de l’app',
    /** A value not known yet (the build, before the service worker gives it). */
    none: '—',
    signOut: 'Se déconnecter',
    /** The theme: the phone's setting, or one of the two. */
    appearance: 'Apparence',
    themes: { system: 'Système', light: 'Clair', dark: 'Sombre' }
  },
  /** The user left while the PC could not confirm that it removed this phone: shown on the screen they land on. */
  forget: {
    pending: 'Le PC n’a pas confirmé. Retirez ce téléphone dans Ledge sur le PC, section Accès mobile.'
  },
  /** The GitHub login, as the boards write it. */
  account: (login: string) => `@${login}`,
  /** The PC before its first snapshot named it. */
  yourPc: 'votre PC',
  replaced: {
    title: 'Ledge est ouvert ailleurs',
    body: 'Un autre onglet de ce téléphone a pris la connexion. Fermez-le, ou reprenez la connexion ici.',
    here: 'Utiliser ici'
  },
  insecure: {
    title: 'Connexion non sécurisée',
    body: 'Ledge sur téléphone ne s’ouvre que sur une adresse HTTPS. Ouvrez l’adresse https:// du serveur.'
  },
  /** The app or its start failed to load (a lost connection mid-update, a blocked storage): no board shows it. */
  bootFailed: {
    title: 'Ledge n’a pas pu démarrer',
    body: 'Le chargement de l’app a échoué. Vérifiez la connexion du téléphone, puis rechargez la page.',
    reload: 'Recharger'
  },
  login: {
    title: 'Vos agents, dans la poche',
    subtitle: 'Connectez-vous avec le même compte GitHub que dans Ledge sur votre PC.',
    notes: [
      'Ce téléphone crée sa propre clé. Elle ne le quitte jamais.',
      'Rien n’est accessible avant que vous ayez confirmé un code sur votre PC.',
      'Le serveur relaie des messages chiffrés : il ne peut ni les lire, ni répondre à votre place.'
    ],
    github: 'Continuer avec GitHub',
    /** What the relay's `?signin=` said went wrong; the boards show none, these are the desktop's words. */
    errors: { denied: 'La connexion a été refusée sur GitHub.', failed: 'La connexion à GitHub a échoué. Réessayez.' }
  },
  /** Confirming a high-impact accept with the device's own check (Face ID, fingerprint, PIN). */
  confirm: {
    heading: 'Confirmer l’autorisation',
    note: 'Une vérification sur votre appareil sera demandée. Elle confirme votre identité, pas la sûreté de la commande.',
    go: 'Confirmer avec mon appareil', goApple: 'Autoriser avec Face ID',
    preparing: 'Préparation de la vérification…',
    asking: 'Vérification en cours sur cet appareil…',
    cancelled: 'Vérification annulée. Rien n’a été envoyé.',
    expired: 'La vérification a expiré. Recommencez.',
    failed: 'La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessayez.',
    prepareFailed: 'La vérification n’a pas pu être préparée. Rien n’a été envoyé.',
    retry: 'Réessayer'
  },
  /** Protecting the high-impact accepts with this device, at pairing and in Connection. */
  enroll: {
    title: 'Protéger les accords',
    body: 'Face ID ou le code de ce téléphone sera demandé pour autoriser une commande à impact élevé.',
    go: 'Protéger les accords', later: 'Plus tard',
    done: 'Protégés par cet appareil', row: 'Accords à impact élevé',
    unsupported: 'Cet appareil ne peut pas protéger les accords.'
  },
  notifications: {
    title: 'Être prévenu quand un agent attend', body: 'Activez les notifications pour ouvrir une demande directement depuis votre écran verrouillé.',
    enable: 'Activer les notifications', later: 'Plus tard', working: 'Activation…', waiting: 'Connexion au PC…',
    row: 'Notifications', on: 'Activées', off: 'Désactivées',
    denied: 'Notifications refusées. Vous pourrez les autoriser dans les réglages du téléphone.',
    unsupported: 'Ce navigateur ne propose pas les notifications. Sur iPhone, ouvrez Ledge depuis son icône de l’écran d’accueil.',
    failed: 'L’activation n’a pas abouti : le PC n’a pas reçu l’abonnement. Vérifiez la connexion, puis réessayez.',
    noPush: 'Les notifications ne sont pas disponibles sur ce PC.',
    stale: 'Le PC a changé de clés : réactivez les notifications pour que ce téléphone les reçoive à nouveau.'
  },
  compare: {
    /** The name this phone gives itself in its `pair_commit`, when its user agent names no known device. */
    deviceLabel: 'Téléphone',
    title: 'Comparez ce code',
    waitCode: 'En attente du code du PC…',
    codeLabel: (code: string) => `Code de liaison ${code}`,
    intro: (pc: string) => `Ledge vient d’afficher un code sur ${pc}. Il doit être identique à celui-ci.`,
    basis: 'Calculé à partir des clés du PC et de ce téléphone',
    same: 'Les codes sont identiques',
    different: 'Ils sont différents',
    waitTitle: 'Confirmez sur le PC',
    waitBody: (pc: string, code: string) => `Dans Ledge sur ${pc}, cliquez sur Approuver sous le même code ${code}.`,
    cancel: 'Annuler',
    doneTitle: (pc: string) => `Téléphone lié à ${pc}`,
    doneBody: 'Vous pouvez lire, approuver et écrire. Retirez ce téléphone à tout moment depuis Ledge sur le PC.',
    seePending: 'Voir ce qui attend',
    cancelledTitle: 'Liaison annulée',
    cancelledBody: 'Des codes différents signifient que ce téléphone et le PC ne voient pas les mêmes clés. Quelqu’un tente peut-être de s’interposer. Refusez aussi sur le PC.',
    expiredTitle: 'Code expiré',
    expiredBody: 'Le code n’a pas été confirmé à temps sur les deux appareils.',
    refusedTitle: 'Liaison refusée sur le PC',
    refusedBody: 'Ledge sur le PC a refusé ce téléphone.',
    lostTitle: 'Ce téléphone n’est plus lié',
    lostBody: 'Ses clés ont disparu (données du site effacées ou navigation privée) et le dernier état connu a été effacé avec. Comparez un nouveau code pour le lier.',
    /** A pairing was asked and none could start (no key could be made, the link closed): no board shows it. */
    stalledTitle: 'La liaison n’a pas pu démarrer',
    stalledBody: 'Ce téléphone n’a pas pu préparer sa clé. Recommencez ; si cela persiste, rechargez la page.',
    retry: 'Recommencer',
    /** Waiting for the PC's code while it is not on the relay: the pairing starts by itself once it is. */
    offlineTitle: 'PC hors ligne',
    offlineBody: (pc: string) => `Activez l’accès mobile dans Ledge sur ${pc} : la liaison démarre dès qu’il est en ligne.`,
    relayTitle: 'Relais injoignable',
    relayBody: 'Ce téléphone n’arrive pas à joindre le relais Ledge. Vérifiez sa connexion à internet, puis réessayez.',
    retryNow: 'Réessayer'
  },
  denied: {
    title: 'Ce compte n’a pas accès',
    /** The relay's redirect names no account: the board's sentence without the login. */
    bodyNoLogin: 'Ce compte GitHub n’est pas dans la liste de ce serveur. Demandez à son administrateur de vous ajouter.',
    other: 'Utiliser un autre compte'
  },
  keyChanged: {
    title: (pc: string) => `La clé de ${pc} a changé`,
    body: 'Ce téléphone a coupé la connexion. Il n’envoie plus rien et n’affiche plus rien de ce PC tant que vous n’avez pas refait la liaison.',
    known: 'Connue', received: 'Reçue',
    knownDetail: (fp: string, date: string) => `${fp} · liée le ${date}`,
    receivedDetail: (fp: string) => `${fp} · inconnue`,
    reinstalledTitle: 'Vous avez réinstallé Ledge ou changé de PC ?',
    reinstalledBody: 'C’est normal : refaites la liaison et comparez le nouveau code.',
    otherwise: 'Sinon,',
    warning: 'n’allez pas plus loin et prévenez l’administrateur du serveur.',
    relink: 'Refaire la liaison',
    signOut: 'Se déconnecter'
  },
  /** The PC answered a hello with `denied` (this phone was removed in Ledge on the PC): no board shows it, KeyChanged is the model. */
  unrecognized: {
    title: (pc: string | null) => `${pc ?? 'Votre PC'} ne reconnaît plus ce téléphone`,
    body: 'Ce téléphone a sans doute été retiré dans Ledge sur le PC. Il n’envoie plus rien à ce PC.',
    kept: 'Le dernier état connu et vos brouillons restent sur ce téléphone. Refaire la liaison les efface et fait comparer un nouveau code.',
    relink: 'Refaire la liaison',
    signOut: 'Se déconnecter'
  },
  /** The key store could not be read (a lost IndexedDB connection): no board shows it. Nothing was erased. */
  storage: {
    title: 'Stockage du téléphone illisible',
    body: 'Le navigateur n’a pas pu lire les clés de ce téléphone. Rien n’a été effacé : réessayez, ou rechargez la page.',
    retry: 'Réessayer',
    reload: 'Recharger'
  },
  update: {
    title: 'Nouvelle version',
    version: (v: string) => `Nouvelle version · ${v}`,
    body: 'Le serveur propose une mise à jour de l’app. Rien ne change tant que vous ne l’acceptez pas.',
    fingerprint: 'Empreinte de cette version',
    current: 'Actuelle : ',
    /** After « Actuelle : », the running build: its version and short fingerprint. */
    currentBuild: (v: string, fp: string) => `${v} · ${fp}`,
    compare: (v: string) => `Comparer avec la release ${v} sur GitHub`,
    later: 'Plus tard',
    apply: 'Mettre à jour'
  },
  offline: {
    lastKnown: (t: string) => `Dernier état connu · ${t}`,
    title: (pc: string | null) => pc ? `${pc} ne répond plus` : 'Votre PC ne répond plus',
    body: (t: string) => `Le PC est sans doute en veille depuis ${t}. Ledge n’envoie aucune décision plus tard à votre place : une demande peut avoir changé entre-temps.`,
    /** The board's sentence when no state was ever received, so no time to give. */
    bodyUnknown: 'Le PC est sans doute en veille. Ledge n’envoie aucune décision plus tard à votre place : une demande peut avoir changé entre-temps.',
    retry: 'Réessayer',
    seen: (when: string) => `vu à ${when}`,
    badge: 'Hors ligne',
    pcOffline: 'PC hors ligne'
  }
} as const;
