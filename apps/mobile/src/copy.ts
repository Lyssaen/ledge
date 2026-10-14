const unassessed = 'Impact non évalué';

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
    emptyFilter: 'Aucune demande dans ce filtre',
    emptyFilterHint: 'Les autres demandes restent dans « Tout ».',
    offlineNote: 'Vous pouvez consulter les demandes. Aucune décision ne sera envoyée hors connexion.'
  },
  nav: { label: 'Navigation principale', inbox: 'À traiter' },
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
    runsInProject: 'Exécution dans le projet',
    runsInProjectBody: 'Le script de test du dépôt sera exécuté avec les permissions de cette session. Il peut modifier des fichiers ou accéder au réseau.',
    destination: 'Destination'
  },
  decide: {
    deny: 'Refuser', allow: 'Autoriser une fois', verify: 'Vérifier et autoriser',
    hint: 'La décision sera transmise immédiatement au PC.',
    offlineHint: 'Aucune décision ne sera envoyée hors connexion.',
    connectingHint: 'Connexion en cours…',
    readOnly: 'Session démarrée hors de Ledge : répondez dans le terminal.',
    answerLater: 'Répondre depuis le téléphone : pas encore disponible. Répondez sur le PC.',
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
    body: 'Le terminal a reçu votre décision.',
    final: 'Une décision transmise ne peut pas être annulée.',
    back: 'Retour aux demandes'
  },
  risk: {
    badge: 'Impact élevé',
    body: 'Cette action peut avoir des effets difficiles à annuler. Une vérification sur votre appareil sera demandée avant de l’autoriser.',
    reasons: {
      pushes: 'Publie des modifications sur un dépôt distant',
      destroys: 'Peut supprimer des fichiers ou des données',
      deploys: 'Peut déployer vers un environnement',
      publishes: 'Peut publier un paquet ou une version',
      pipes_to_shell: 'Exécute du code téléchargé',
      network: 'Accède au réseau',
      writes_outside_folder: 'Écrit hors du dossier du projet',
      sensitive_path: 'Touche un fichier sensible',
      unsafe_flag: 'Utilise une option risquée',
      shell_syntax: 'Commande composée, difficile à vérifier',
      script: 'Exécute un script',
      plan: 'Un plan engage plusieurs actions',
      unknown: unassessed, question: unassessed, read_only_command: unassessed, edit_inside_folder: unassessed
    }
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
  pairing: {
    stepOf: (n: number) => `Connexion · ${n} / 4`,
    back: 'Étape précédente',
    steps: [
      { title: 'Votre PC, à portée de main', subtitle: 'Connectez le téléphone au réseau privé de votre PC pour retrouver vos agents.', button: 'Tailscale est connecté' },
      { title: 'Installer Ledge', subtitle: 'Le QR code du PC ouvre l’adresse privée de votre application.', button: 'Ledge est installé' },
      { title: 'Appairer ce téléphone', subtitle: 'Saisissez le code affiché dans Ledge sur votre PC.', button: 'Appairer mon téléphone' },
      { title: 'Vous êtes connecté', subtitle: 'Ce téléphone est appairé à votre PC.', button: 'Continuer' }
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
