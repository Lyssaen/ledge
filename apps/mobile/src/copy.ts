/** Every French string of the phone app lives here (decision D13). */
export const copy = {
  appName: 'Ledge',
  inbox: {
    title: 'À traiter',
    subtitle: (n: number) => n === 0 ? 'Toutes les demandes ont été traitées.' : n === 1 ? '1 demande. Choisissez par où commencer.' : `${n} demandes. Choisissez par où commencer.`,
    filtersLabel: 'Filtrer les demandes',
    filters: { all: 'Tout', permission: 'Autorisations', question: 'Questions' },
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
  nav: { label: 'Navigation principale', inbox: 'À traiter', agents: 'Agents' },
  agents: {
    title: 'Agents',
    subtitle: (sessions: number, projects: number) => `${sessions} ${sessions > 1 ? 'sessions' : 'session'} · ${projects} ${projects > 1 ? 'projets' : 'projet'} sur ce PC`,
    offline: 'Dernier état connu · connexion perdue',
    unread: '● Non lu',
    working: 'Travaille sur les dernières modifications.',
    state: { working: 'Au travail', idle: 'Disponible', exited: 'Terminée', error: 'Erreur' },
    empty: 'Aucune session sur ce PC', emptyHint: 'Les agents lancés depuis Ledge apparaissent ici.',
    open: (name: string, task: string) => `${name} · ${task}`
  },
  link: {
    online: 'connecté', offline: 'déconnecté', settings: 'Connexion du téléphone',
    lostTitle: 'Connexion au PC perdue',
    lostBody: 'Le PC, le réseau ou Tailscale est indisponible. Les demandes ci-dessous peuvent avoir changé.',
    lostDetail: 'Dernier état connu. Reconnectez-vous pour vérifier si cette demande attend toujours une décision.',
    lastKnownAt: (t: string) => `Dernier état connu · ${t}`,
    reconnect: 'Reconnecter et actualiser',
    reconnecting: 'Reconnexion…'
  },
  kind: { permission: 'Autorisation', question: 'Question', plan: 'Plan', diff: 'Modification' },
  tools: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' },
  detail: {
    back: 'Retour aux demandes',
    heading: { permission: 'Une autorisation', question: 'Une question', plan: 'Un plan', diff: 'Des modifications' },
    commandTitle: 'Commande à autoriser',
    folder: 'Dossier', branch: 'Branche', asked: 'Demandé',
    ago: (age: string) => `Il y a ${age}`,
    context: 'Contexte du terminal',
    options: 'Réponses proposées',
    editsInProject: 'Modification dans le projet',
    editsInProjectBody: 'Le fichier sera modifié dans le dossier de cette session, et nulle part ailleurs.',
    destination: 'Destination'
  },
  decide: {
    deny: 'Refuser', allow: 'Autoriser une fois', verify: 'Vérifier et autoriser',
    hint: 'La décision sera transmise immédiatement au PC.',
    offlineHint: 'Aucune décision ne sera envoyée hors connexion.',
    connectingHint: 'Connexion en cours…',
    readOnly: 'Session démarrée hors de Ledge : répondez dans le terminal.',
    answerLater: 'Répondre depuis le téléphone : pas encore disponible. Répondez sur le PC.',
    answerHint: 'La réponse sera transmise immédiatement au PC.',
    send: 'Envoyer ma réponse',
    otherInvalid: 'Le PC n’a pas accepté cette réponse. Corrigez-la, elle tient sur une ligne de 2000 caractères au plus.',
    otherUnsupported: 'Cet agent ne peut pas recevoir de réponse libre depuis le téléphone. Choisissez une option ou répondez sur le PC.',
    assertionExpired: 'La vérification a expiré. Recommencez.',
    assertionInvalid: 'La vérification n’a pas été acceptée par le PC.',
    sending: 'Transmission au PC…', sendingBody: 'En attente de confirmation du terminal.',
    uncertain: 'Réception non confirmée',
    uncertainBody: 'La connexion a été perdue pendant l’envoi. La décision a peut-être été reçue. Vérifiez son état avant de recommencer.',
    check: 'Reconnecter et vérifier', checking: 'Vérification…',
    changed: 'La demande a été mise à jour. Relisez-la avant de décider.',
    reread: 'J’ai relu la demande',
    unknown: 'État de la décision inconnu',
    unknownPending: 'La demande attend toujours une décision sur le PC. Vous pouvez la reprendre ci-dessous.',
    unknownGone: 'La demande n’attend plus de décision sur le PC. Vérifiez le terminal pour connaître son état.',
    busy: 'Une autre décision est en cours sur le PC.',
    notTaken: 'Le terminal n’a pas confirmé. La demande est toujours en attente.',
    noPrompt: 'Le terminal n’affiche plus la demande. Ouvrez-le sur le PC.',
    forbidden: 'Ce téléphone n’est plus autorisé.',
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
      failTitle: 'Message non envoyé', uncertainTitle: 'Réception non confirmée',
      lost: 'Le PC est injoignable. Votre brouillon est conservé.',
      busy: 'L’agent n’est plus disponible pour une consigne. Votre brouillon est conservé.',
      invalid: 'Le message n’a pas été accepté par le PC (4000 caractères au plus). Votre brouillon est conservé.',
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
    uncertain: 'Réception non confirmée : vérifiez le terminal avant de recommencer.'
  },
  question: {
    legend: 'Choisir une réponse',
    other: 'Autre réponse',
    fieldLabel: (bot: string) => `Votre réponse à ${bot}`,
    placeholder: 'Précisez votre choix…',
    long: (max: number) => `La réponse est trop longue (${max} caractères au plus).`,
    untypable: 'La réponse doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.'
  },
  confirm: {
    label: (title: string) => `Confirmer : ${title}`,
    title: 'Autoriser cette commande ?', titleForce: 'Autoriser ce push forcé ?',
    close: 'Fermer la confirmation',
    note: 'Une vérification sur votre appareil sera demandée. Elle confirme votre identité, pas la sûreté de la commande.',
    go: 'Confirmer avec mon appareil', back: 'Revenir à la demande',
    preparing: 'Préparation de la vérification…',
    asking: 'Vérification en cours sur cet appareil…',
    cancelled: 'Vérification annulée. Rien n’a été envoyé.',
    expired: 'La vérification a expiré. Recommencez.',
    failed: 'La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessayez.',
    prepareFailed: 'La vérification n’a pas pu être préparée. Rien n’a été envoyé.',
    retry: 'Réessayer',
    offline: 'Connexion au PC perdue. Rien n’a été envoyé.',
    context: (bot: string, task: string, repo: string) => `${bot} · ${task} · ${repo}`
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
    title: 'Connexion', back: 'Retour aux demandes', pc: 'PC', device: 'Ce téléphone', status: 'État',
    repair: 'Réappairer', repairTitle: 'Réappairer ce téléphone ?',
    repairBody: 'Vous allez repasser par le code affiché sur le PC. L’accès actuel reste valable jusqu’à la fin de l’appairage.',
    repairConfirm: 'Oui, réappairer', repairCancel: 'Annuler', unknown: 'Inconnu',
    status_: { online: 'Connecté', offline: 'Déconnecté', connecting: 'Connexion en cours…', unpaired: 'Non appairé' }
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
  pairing: {
    stepOf: (n: number) => `Connexion · ${n} / 4`,
    back: 'Étape précédente',
    steps: [
      { title: 'Votre PC, à portée de main', subtitle: 'Connectez le téléphone au réseau privé de votre PC pour retrouver vos agents.', button: 'Tailscale est connecté' },
      { title: 'Installer Ledge', subtitle: 'Le QR code du PC ouvre l’adresse privée de votre application.', button: 'Ledge est installé' },
      { title: 'Appairer ce téléphone', subtitle: 'Saisissez le code affiché dans Ledge sur votre PC.', button: 'Appairer mon téléphone' },
      { title: 'Vous êtes connecté', subtitle: 'Ce téléphone est appairé à votre PC.', button: 'Activer les notifications' }
    ],
    checklist: [
      { title: 'Connecter Tailscale', hint: 'Sur le PC et le téléphone, utilisez le même réseau privé.' },
      { title: 'Ouvrir le QR code du PC', hint: 'Dans Ledge : Réglages → Mobile. Scannez avec l’appareil photo du téléphone.' },
      { title: 'Installer et appairer Ledge', hint: 'Gardez le PC à proximité pour cette première connexion.' }
    ],
    install: { title: 'Dans Safari sur votre téléphone', body: 'Ouvrez le menu de partage, puis « Sur l’écran d’accueil ». Ouvrez ensuite Ledge depuis sa nouvelle icône.', note: 'Le code d’appairage se saisit dans l’application installée. Les notifications seront proposées ensuite.' },
    codeLabel: 'Code à six chiffres',
    codeHint: 'Code valable 2 minutes.',
    pending: 'Vérification…',
    verify: 'Vérifier avec cet appareil',
    privacy: { title: 'Réseau privé', body: 'Vous pourrez retirer l’accès de ce téléphone depuis Réglages → Mobile sur le PC.' },
    done: { title: 'Accès confirmé', body: 'Vos demandes et conversations sont disponibles tant que le PC et Tailscale sont connectés.' },
    errors: {
      invalid_code: 'Code non reconnu. Vérifiez le code affiché sur le PC.',
      expired: 'Ce code a expiré. Demandez-en un nouveau sur le PC.',
      locked: "Trop d'essais. Demandez un nouveau code sur le PC.",
      webauthn_failed: "La vérification de l'appareil n'a pas abouti. Réessayez.",
      not_configured: 'Ouvrez Réglages › Mobile sur le PC pour obtenir un code.',
      no_window: 'Ouvrez Réglages › Mobile sur le PC pour obtenir un code.',
      network: 'PC injoignable. Vérifiez Tailscale.'
    }
  }
} as const;
