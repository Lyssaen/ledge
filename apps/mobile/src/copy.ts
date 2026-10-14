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
    deny: 'Refuser', allow: 'Autoriser une fois',
    notYet: 'Décisions depuis le téléphone : pas encore disponibles. Répondez sur le PC.',
    readOnlyHint: 'Cette session est en lecture seule.'
  },
  gone: {
    header: 'Demande', title: 'Cette demande n’attend plus de décision.', body: 'Elle a été traitée, sur le PC ou ailleurs.', back: 'Retour aux demandes',
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
