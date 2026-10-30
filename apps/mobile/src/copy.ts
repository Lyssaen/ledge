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
    /** Why the PC or the phone refused an operation of this tab, for the reasons the chat has no copy for; any other reason says only that it was not launched (`copy.chat.team.notLaunched`). */
    reason: {
      changed: 'le fichier a changé sur le PC',
      exists: 'Un fichier de ce nom existe déjà.',
      unknown_project: 'Ce projet n’a pas de dépôt sur ce PC.',
      invalid: 'Cette équipe ne peut pas être levée telle quelle.',
      confirm_required: 'La confirmation avec l’appareil est requise.',
      assertion_invalid: 'La vérification de l’appareil a été refusée. Réessayez.',
      conflict: 'Une autre opération est en cours sur le PC. Réessayez.'
    } as Partial<Record<string, string>>,
    loading: 'Lecture du catalogue…', unavailable: 'Catalogue indisponible', retry: 'Réessayer',
    outdated: 'Ce PC ne sait pas encore lire les équipes : mettez Ledge à jour sur le PC.', updatePc: 'Mettre à jour le PC',
    problemsHead: 'FICHIERS ILLISIBLES', problemsLabel: 'Fichiers illisibles',
    /** The role editor (« Nouveau rôle » and a role's own page). */
    role: {
      newTitle: 'Nouveau rôle', idLabel: 'Identifiant', labelLabel: 'Libellé', idRule: 'Minuscules, chiffres, - et _ · 40 caractères au plus, commence par une lettre ou un chiffre.',
      idTaken: (scope: string) => `Cet identifiant est déjà pris (${scope}).`, labelRule: 'Un libellé de 40 caractères au plus.',
      prompt: 'Consigne', promptFetching: 'Lecture de la consigne entière…', promptFailed: 'Consigne illisible pour le moment.', promptRetry: 'Réessayer',
      defaults: 'PAR DÉFAUT', tool: 'Outil', model: 'IA', effort: 'Effort', autonomy: 'Autonomie', unset: 'Par défaut',
      modelRule: 'Un identifiant d’IA valide, ou vide.', effortRule: 'Des lettres minuscules, ou vide.',
      scopeHead: 'RANGER DANS', scopeLegend: 'Portée du rôle', home: 'Maison', repo: (project: string) => `Dépôt ${project}`,
      homeHint: 'Maison : disponible pour tous vos projets.', repoHint: (project: string) => `Dépôt : seulement dans ${project}.`,
      fixedScope: (scope: string) => `Rangé dans : ${scope}.`,
      shadows: (id: string) => `@${id} de ce dépôt cache le @${id} de Maison.`, shadowed: (id: string) => `@${id} de Maison est caché par le @${id} du dépôt.`,
      shadowedIn: (id: string, projects: readonly string[]) => `@${id} de Maison est masqué dans ${projects.join(', ')}.`,
      save: 'Enregistrer le rôle', saveNote: 'Votre passkey confirme l’écriture sur le PC.', delete: 'Supprimer', deleteTitle: (id: string) => `Supprimer @${id} ?`,
      seatedIn: (names: string) => `encore dans : ${names}`, deleteHint: 'Ces équipes perdront ce siège.', cancel: 'Annuler',
      notSaved: 'Pas enregistré.', changedKept: 'Votre texte est gardé. Enregistrer écrase la version du PC.', takePc: 'Reprendre la version du PC',
      taken: 'Cet identifiant est déjà pris.', invalid: 'Ce rôle ne peut pas être enregistré tel quel.',
      missing: 'Ce rôle n’existe pas sur ce PC.', gone: 'Ce rôle n’existe plus sur le PC. Votre texte est gardé ici, mais il ne peut plus être enregistré.'
    },
    /** The team editor (a team's own page, a copy of a live team, a live team's composition). */
    team: {
      nameRule: 'Un nom de 60 caractères au plus.',
      composeTitle: 'Modifier la composition', copyTitle: 'Enregistrer comme équipe',
      seats: (n: number, max: number) => `SIÈGES · ${n} SUR ${max}`, seatsLabel: 'Sièges',
      noSeats: 'Aucun siège : ajoutez au moins un rôle.',
      addRole: 'Ajouter un rôle', newRole: 'Nouveau rôle…', noRoleLeft: 'Tous les rôles sont déjà dans l’équipe.',
      change: 'Changer', changeSeat: (role: string) => `Changer @${role}`, removeSeat: (role: string) => `Retirer @${role}`,
      modified: 'modifié', apply: 'Appliquer', unknownRole: (role: string) => `@${role} n’existe pas sur ce PC : retirez-le de l’équipe.`,
      scopeHead: 'RANGER DANS', scopeLegend: 'Où ranger l’équipe', home: 'Maison', repo: (project: string) => project ? `Dépôt ${project}` : 'Dépôt',
      homeHint: 'Maison : disponible pour tous vos projets.', repoHint: (project: string) => project ? `Dépôt : seulement dans ${project}.` : 'Dépôt : choisissez le projet ci-dessus.',
      fixedScope: (scope: string) => `Rangée dans : ${scope}.`,
      launchNote: 'Votre passkey confirme le lancement.', saveNote: 'Votre passkey confirme l’écriture sur le PC.', composeNote: 'Votre passkey confirme le changement de composition.',
      save: 'Enregistrer', delete: 'Supprimer', deleteTitle: (name: string) => `Supprimer ${name} ?`, deleteHint: 'Les équipes déjà levées ne changent pas.',
      notSaved: 'Pas enregistré.', notDeleted: 'Pas supprimée.', exists: 'Une équipe de ce nom existe déjà.', invalid: 'Cette équipe ne peut pas être enregistrée telle quelle.',
      composed: 'Composition enregistrée.',
      /** Saved, but the seats named (or one, when none can be) did not start. */
      composedUnstarted: (roles: readonly string[]) => roles.length === 0 ? 'Composition enregistrée ; un siège n\'a pas démarré.'
        : `Composition enregistrée ; ${roles.map(r => `@${r}`).join(', ')} n${roles.length > 1 ? '\'ont' : '\'a'} pas démarré.`,
      composeChanged: 'La composition a changé sur le PC.',
      handNamed: 'Ce fichier porte un nom fait main : il ne se modifie que sur le PC. Vous pouvez quand même lever l’équipe.',
      changedKept: 'Vos modifications sont gardées. Enregistrer écrase la version du PC.',
      missing: 'Cette équipe n’existe pas sur ce PC.', gone: 'Cette équipe n’existe plus sur le PC. Vos modifications sont gardées ici, mais elles ne peuvent plus être enregistrées.',
      restart: 'Redémarrer ce siège', restartHint: 'La conversation du siège n’est pas reprise.', notRestarted: 'Pas redémarré.', start: 'Démarrer ce siège', notStarted: 'Pas démarré.',
      nextStart: 'au prochain démarrage du siège'
    },
    /** The live team's sheet, opened from its header in Agents. */
    sheet: {
      seats: (n: number) => `SIÈGES · ${n}`, seatsLabel: 'Sièges', free: 'libre', leaving: 'termine puis part', unknownSession: 'session inconnue',
      since: (at: string) => `au travail depuis ${at}`, resting: 'au repos', from: (name: string) => `d'après « ${name} »`,
      readPrompt: 'Lire et modifier la consigne', compose: 'Modifier la composition', saveAs: 'Enregistrer comme équipe',
      dissolve: 'Dissoudre l\'équipe', dissolveTitle: (name: string) => `Dissoudre ${name} ?`,
      dissolveHint: 'Irréversible. Les sessions de l’équipe restent ouvertes.', dissolveNote: 'Votre passkey confirme la dissolution.',
      notDissolved: 'Pas dissoute.', loading: 'Lecture de l’équipe…', unavailable: 'Équipe indisponible'
    }
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
  /** Changing a live session's model and effort (the chip above the reply field and its sheet). */
  model: {
    title: 'Modèle et effort',
    subtitle: (tool: string) => `Les modèles de ${tool} connus du PC`,
    byDefault: 'Par défaut',
    defaultHint: "Celui que l'agent prend de lui-même",
    current: 'actuel',
    effortTitle: 'Effort',
    effortHint: 'Temps de réflexion par tour',
    noteIdle: (name: string) => `${name} redémarre sur la même conversation et garde son contexte.`,
    noteWorking: (name: string) => `${name} travaille : le changement attendra la fin de son tour.`,
    apply: 'Appliquer',
    cancel: 'Annuler',
    cancelPending: 'Annuler le changement',
    nextTurn: 'au prochain tour',
    listError: 'Liste des modèles indisponible',
    applied: 'Appliqué',
    scheduled: 'Appliqué au prochain tour',
    notApplied: 'Changement de modèle non appliqué',
    uncertain: 'Changement de modèle envoyé ; vérifiez sur le PC',
    failed: {
      not_launched: 'pas lancé par Ledge', ended: 'session terminée', no_conversation: 'aucune conversation à reprendre',
      not_running: "l'agent ne tourne pas", effort_in_model: "cet outil prend l'effort dans le modèle",
      restart_failed: 'le redémarrage a échoué', refused: "refusé par l'outil"
    },
    failedLine: (reason: string) => `Changement de modèle non appliqué : ${reason}`,
    chip: (what: string) => `Modèle et effort : ${what}`,
    /** The seat card's sheet: what a model change on a live team's seat saves, and what it does to the session holding it. */
    seat: {
      change: (role: string) => `Changer le modèle de @${role}`,
      heldBy: (label: string, name: string, working: boolean) => `${label} · tenu par ${name}${working ? ', qui travaille' : ''}`,
      tool: 'Outil', toolRestart: 'changer redémarre le siège',
      saved: 'Enregistré sur le siège pour ses prochains démarrages.',
      now: (name: string) => `Appliqué aussi tout de suite à ${name}, sur la même conversation.`,
      nowWorking: (name: string) => `Appliqué aussi tout de suite à ${name}, sur la même conversation : il travaille, ce sera à la fin de ce tour.`,
      later: 'au prochain démarrage du siège',
      /** « Par défaut » on a seat whose role sets a model: clearing the seat's own value gives the role's. */
      roleDefault: (model: string) => `Celui du rôle : ${model}`,
      passkey: 'Votre passkey confirme le changement.',
      restarts: (name: string) => `${name} redémarre sur la même conversation.`,
      close: 'Fermer',
      outcome: {
        saved: 'Enregistré',
        next: 'Enregistré · au prochain démarrage du siège',
        applied: (name: string) => `Enregistré ; appliqué à ${name}`,
        scheduled: (name: string) => `Enregistré ; appliqué à ${name} à la fin de son tour`,
        notApplied: (name: string, reason: string) => `Enregistré sur le siège ; pas appliqué à ${name} : ${reason}`
      }
    }
  },
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
  /** Closing a session from its page, and resuming it once ended (mockup mobile-session-close). */
  sessionEnd: {
    close: (bot: string) => `Fermer ${bot}`, closingNamed: (bot: string) => `Fermeture de ${bot} en cours`,
    closeTitle: (bot: string) => `Fermer ${bot} ?`,
    closeBody: 'Ledge quitte l’agent proprement, comme /exit dans son terminal. Sa conversation est gardée : vous pourrez la reprendre d’ici ou depuis le PC.',
    cutsTitle: 'Ce que la fermeture coupe',
    working: (bot: string) => `${bot} travaille : son tour en cours sera interrompu. Ce qui est déjà fait reste fait.`,
    turn: (bot: string) => `Le tour en cours de ${bot} sera interrompu. Ce qui est déjà fait reste fait.`,
    request: 'La demande en attente sera refusée.', question: 'La question en attente restera sans réponse.',
    helpers: (n: number) => n > 1 ? `${n} sous-agents s’arrêtent avec la session.` : '1 sous-agent s’arrête avec la session.',
    force: 'Si l’agent ne répond pas, Ledge ferme son terminal de force.',
    check: 'Une vérification sur votre appareil sera demandée.',
    goClose: 'Fermer avec mon appareil', goCloseApple: 'Fermer avec Face ID',
    resumeTitle: (bot: string) => `Reprendre ${bot} ?`,
    resumeBody: 'L’agent repart sur sa conversation, dans le même dossier et sur la même branche.',
    goResume: 'Reprendre avec mon appareil', goResumeApple: 'Reprendre avec Face ID',
    cancel: 'Annuler',
    offlineTitle: 'PC injoignable',
    offlineClose: (bot: string) => `Reconnectez-vous pour fermer ${bot}. Rien n’a été envoyé.`,
    offlineResume: (bot: string) => `Reconnectez-vous pour reprendre ${bot}. Rien n’a été envoyé.`,
    reconnect: 'Reconnecter',
    unprotectedTitle: 'Vérification impossible',
    unprotectedClose: (bot: string) => `Protégez d’abord vos accords depuis Connexion. Vous pouvez aussi fermer ${bot} sur le PC.`,
    unprotectedResume: (bot: string) => `Protégez d’abord vos accords depuis Connexion. Vous pouvez aussi reprendre ${bot} sur le PC.`,
    openConnection: 'Ouvrir Connexion',
    closing: (bot: string) => `Fermeture de ${bot}…`,
    closingHint: 'L’agent termine ce qu’il tape, puis quitte. Cela peut prendre jusqu’à 30 s.',
    ended: 'Session terminée',
    endedBody: 'Sa conversation est gardée. Reprendre relance l’agent sur cette conversation, dans le même dossier.',
    endedOnPc: 'Sa conversation est gardée : reprenez-la depuis le PC.',
    killed: 'Fermée de force : l’agent ne répondait pas. Son dernier tour peut manquer.',
    resume: (bot: string) => `Reprendre ${bot}`,
    resuming: (bot: string) => `Reprise de ${bot}…`,
    closedHere: (time: string) => `Session fermée depuis le téléphone · ${time}`,
    notClosed: (bot: string) => `${bot} n’a pas été fermée`,
    closeFailed: 'Le PC n’a pas pu arrêter l’agent. Vérifiez sur le PC, ou réessayez.',
    readOnly: 'Elle a été démarrée hors de Ledge : fermez-la dans son terminal sur le PC.',
    uncertainTitle: 'Fermeture non confirmée',
    uncertain: (bot: string) => `La connexion a été perdue. ${bot} est peut-être déjà fermée : son état se mettra à jour à la reconnexion.`,
    notResumed: (bot: string) => `${bot} n’a pas repris`,
    resumeUncertainTitle: 'Reprise non confirmée',
    resumeUncertain: (bot: string) => `La connexion a été perdue. ${bot} a peut-être déjà repris : son état se mettra à jour à la reconnexion.`,
    noConversation: 'Aucune conversation à reprendre pour cette session.',
    resumeFailed: 'Le PC n’a pas pu relancer l’agent. Vérifiez sur le PC, ou réessayez.',
    retry: 'Réessayer',
    /** Next to « Terminée » in the list: today's time, yesterday, or the day. */
    at: (time: string) => `à ${time}`, yesterday: 'hier', on: (day: string) => `le ${day}`
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
    staleTitle: 'Cette demande ne figure plus dans le dernier état connu.', staleBody: 'Reconnectez-vous pour vérifier si elle attend toujours une décision.',
    /** The same screen for a live team that is no longer on the PC (dissolved there, or here). */
    team: {
      header: 'Équipe', title: 'Cette équipe n’existe plus', body: 'Elle a été dissoute. Ses sessions encore ouvertes restent dans Agents.', back: 'Retour aux agents',
      staleTitle: 'Cette équipe ne figure plus dans le dernier état connu.', staleBody: 'Reconnectez-vous pour vérifier si elle existe encore.'
    }
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
    themes: { system: 'Système', light: 'Clair', dark: 'Sombre' },
    pcVersion: 'Version du PC',
    /** « Le PC »: updating or restarting the PC's daemon from the phone (spec 2026-10-28 mobile daemon update). */
    pcUpdate: {
      title: 'Le PC',
      behind: 'Le PC a du retard sur l’app',
      versions: (pc: string, app: string) => `PC ${pc} · app ${app}`,
      why: 'Certaines fonctions de l’app demandent la même version sur le PC.',
      update: 'Mettre à jour le PC',
      keepGoing: 'Vos sessions continuent. Le lien se coupe quelques secondes pendant le redémarrage.',
      manual: 'Le PC ne peut pas se mettre à jour seul',
      clone: 'Son daemon tourne depuis un clone git. Mettez-le à jour sur le PC, puis redémarrez le daemon ici.',
      byHand: 'Mettez Ledge à jour sur le PC.',
      restart: 'Redémarrer le daemon', restartHint: 'Sans rien installer. Les sessions continuent.', restartGo: 'Redémarrer',
      updating: (v: string) => `Mise à jour vers ${v}`, restarting: 'Redémarrage du daemon', running: 'En cours',
      steps: { asked: 'Confirmée avec l’appareil', installing: 'Installation par npm', restarting: 'Redémarrage du daemon', back: 'Retour du lien' },
      leave: 'Vous pouvez quitter l’app : la mise à jour continue sur le PC.',
      done: (v: string) => `Le PC est en ${v}`, restarted: 'Le daemon a redémarré', upToDate: 'À jour', close: 'Fermer',
      failed: 'Le PC n’a pas été mis à jour', notRestarted: 'Le daemon n’a pas redémarré', unchanged: (v: string) => `Rien n’a changé : il reste en ${v}.`, refused: 'Refusé',
      reasons: {
        'sessions-at-risk': 'Redémarrer le daemon arrêterait des sessions qu’il fait tourner lui-même (OMP). Terminez-les sur le PC, puis réessayez.',
        'npm-failed': 'npm a échoué sur le PC. Le détail est dans le journal du daemon.',
        busy: 'Une mise à jour est déjà en cours sur le PC.',
        'git-install': 'Son daemon tourne depuis un clone git : mettez-le à jour sur le PC.',
        'no-systemd': 'Le PC n’a pas pu redémarrer le daemon : faites-le sur le PC.',
        timeout: 'Le PC ne répond plus. Vérifiez-le sur place.'
      } as Record<string, string>,
      retry: 'Réessayer',
      confirmUpdate: 'Mettre à jour le PC ?',
      confirmUpdateBody: (pc: string, from: string, to: string) => `${pc} passe de ${from} à ${to}. npm installe la version, puis le daemon redémarre. Vos sessions continuent.`,
      confirmRestart: 'Redémarrer le daemon ?',
      confirmRestartBody: (pc: string) => `Le daemon de ${pc} redémarre sans rien installer. Vos sessions continuent, et le lien revient en quelques secondes.`,
      passkey: 'La passkey de ce téléphone confirme l’action. Sans elle, le PC refuse.',
      noPasskey: 'Protégez d’abord les accords avec l’appareil, plus haut.',
      confirm: 'Confirmer', cancel: 'Annuler', notDone: 'Pas fait.'
    }
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
  checklist: {
    title: 'Plan de travail',
    allDone: 'Tout est fait',
    paused: 'En pause',
    progress: (done: number, total: number) => `${done} sur ${total} tâches faites`,
    box: { completed: 'Fait', in_progress: 'En cours', pending: 'À faire' },
    cut: 'Liste raccourcie : la suite est sur le PC'
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
