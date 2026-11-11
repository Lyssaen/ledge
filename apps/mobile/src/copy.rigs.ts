// The Rigs tab's French words (docs/mockups/ledge-mobile-refonte/m4-rigs.html and its handover sheet), kept apart from copy.ts so
// the other lots' sections stay untouched; copy.ts spreads them into its `rigs` section. English: copy.rigs.en.ts.

const plural = (n: number, one: string, many: string) => (n <= 1 ? one : many);
const list = (names: string[]) => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;

export const rigsFr = {
  updatedAt: (t: string) => `mis à jour à ${t}`,
  openrig: 'OpenRig',
  daemon: 'Daemon',
  kernel: 'Kernel',
  daemonState: { running: 'Actif', stopped: 'Arrêté', stale: 'Arrêté sans arrêt propre', unknown: 'Inconnu' },
  kernelState: { ready: 'Prêt', starting: 'Démarrage…', stopped: 'Arrêté', skipped: 'Désactivé', absent: 'Absent', unknown: 'Inconnu' },
  daemonSub: (version: string | undefined, since: string | null) => [version ? `OpenRig ${version}` : 'OpenRig', since ? `depuis ${since}` : ''].filter(Boolean).join(' · '),
  kernelSub: (seats: string[]) => `${seats.join(', ')} · le rig d'OpenRig lui-même`,
  kernelSubShort: (seats: string[]) => seats.join(', '),
  rigsHead: (running: number) => running ? `Rigs · ${running} en marche` : 'Rigs',
  status: { running: 'En marche', starting: 'Démarrage…', partial: 'Partiel', stopped: 'Arrêté' },
  seats: (running: number, all: number) => `${running}/${all} ${plural(all, 'siège', 'sièges')}`,
  seatCount: (n: number) => `${n} ${plural(n, 'siège', 'sièges')}`,
  stoppedCount: (n: number) => `${n} ${plural(n, 'arrêté', 'arrêtés')}`,
  since: (t: string) => `depuis ${t}`,
  at: (t: string) => `à ${t}`,
  snapshot: (t: string) => `snapshot ${t}`,
  noSnapshot: 'aucun snapshot',
  attention: {
    permission: (n: number) => `${n} ${plural(n, 'autorisation', 'autorisations')}`,
    question: (n: number) => `${n} ${plural(n, 'question', 'questions')}`
  },
  launchNote: 'Un nouveau rig se compose avec Max ou se lance depuis Ledge Desktop.',
  /** §2: the list's states. */
  loading: 'Lecture d\'OpenRig…',
  empty: { title: 'Aucun rig pour l\'instant.', body: 'Un rig est une équipe d\'agents. Max, l\'opérateur du kernel, peut t\'aider à en composer un.', talk: 'Parler à Max' },
  stopped: { title: 'OpenRig est arrêté.', body: 'Les rigs et le kernel repartent avec le daemon.', start: 'Démarrer OpenRig', note: 'Ces deux choix sont gardés sur ce téléphone, comme Desktop garde les siens.' },
  notInstalled: { title: 'OpenRig n\'est pas installé', body: (pc: string) => `La commande rig est introuvable sur ${pc}. Ledge n'installe rien lui-même.` },
  unavailable: { title: 'OpenRig n\'a pas répondu à temps.', body: (t: string) => `La liste ci-dessous est celle lue à ${t}.`, retry: 'Réessayer' },
  offlineBody: (t: string) => `Dernier état connu · ${t}. Rien ne peut être démarré ni arrêté tant que le PC ne répond pas.`,
  relaunch: 'Au démarrage, relancer les rigs qui tournaient',
  noKernel: 'Démarrer sans le kernel',
  noKernelHint: 'Max ne sera pas là pour aider.',
  noKernelNext: 'Vaut au prochain démarrage ou redémarrage.',
  /** §3: the rig's view. */
  back: 'Retour aux rigs',
  more: 'Plus d\'actions',
  tiles: { seats: 'Sièges', permissions: 'Permissions', snapshot: 'Snapshot' },
  level: { auto: 'Auto', standard: 'Standard', open: 'Ouvert', yolo: 'YOLO', locked: 'Verrouillé', spec: 'Spec', mixed: 'Mixte' },
  waits: { question: (seat: string): [string, string, string] => ['Une question de ', seat, ' t\'attend'], permission: (seat: string): [string, string, string] => ['Une autorisation de ', seat, ' t\'attend'], see: 'Voir' },
  topology: 'Topologie',
  topologyHint: 'appuie sur un siège',
  topologyStopped: 'les sièges démarrent avec le rig',
  seatsByRole: 'Sièges par rôle',
  seatState: { perm: 'autorisation', ask: 'question', work: 'au travail', idle: 'disponible', off: 'arrêté', starting: 'démarrage…', waiting: 'en attente' },
  seatLabel: (seat: string, state: string) => `${seat}, ${state}`,
  queue: {
    title: (n: number) => `File OpenRig · ${n} ${plural(n, 'ouverte', 'ouvertes')}`,
    tone: { mine: 'à toi', progress: 'en cours', pending: 'en attente', blocked: 'bloquée' },
    closed: (n: number) => `Closes (${n})`,
    closedTone: { done: 'terminée', handed: 'passée', stopped: 'annulée' },
    none: 'Aucune ligne ouverte ne nomme un siège de ce rig.',
    truncated: 'Les plus anciennes ne sont pas montrées.',
    prompt: 'une invite attend sur le siège',
    from: 'De → à', blockedOn: 'Bloquée sur', created: 'Créée', claimed: (t: string) => `prise ${t}`,
    readOnly: 'Le téléphone montre la file ; il n\'en déplace pas les lignes. Une ligne qui t\'attend se répond dans À toi.',
    seeAtoi: 'Voir dans À toi',
    unavailable: 'La file n\'a pas pu être lue.'
  },
  actions: { seats: 'Sièges', restart: 'Redémarrer', stop: 'Arrêter', start: 'Démarrer', snapshot: 'Prendre un snapshot', snapshots: 'Snapshots', permissions: 'Permissions', refresh: 'Actualiser', restartRig: 'Redémarrer le rig' },
  /** With the device's check: « Arrêter avec Face ID » on an iPhone or an iPad, « … avec mon appareil » elsewhere. */
  withCheck: (verb: string, apple: boolean) => `${verb} avec ${apple ? 'Face ID' : 'mon appareil'}`,
  protectFirst: 'Protège d\'abord tes accords depuis Réglages.',
  openSettings: 'Ouvrir Réglages',
  /** The seat's sheet (Q39). */
  seat: {
    of: (seat: string, rig: string) => `siège ${seat} de ${rig}`,
    harness: 'Harnais', context: 'Contexte', now: 'En ce moment', work: 'Travail', links: 'Liens',
    prompt: (what: string) => `une invite attend sur le siège (${what})`,
    tasks: (n: number) => `${n} ${plural(n, 'tâche', 'tâches')}`,
    noTask: 'aucune tâche',
    delegatesTo: (who: string) => `${who} lui délègue`,
    delegates: (who: string) => `délègue à ${who}`,
    collaborates: (who: string) => `collabore avec ${who}`,
    escalates: (who: string) => `remonte à ${who}`,
    linked: (who: string, kind: string) => `${kind} · ${who}`,
    noLink: 'aucun',
    openSession: 'Ouvrir sa session',
    settings: 'Réglages du siège',
    noSession: 'Ledge ne suit pas encore la session de ce siège.'
  },
  /** §4: stop and restart. */
  confirm: {
    stop: (rig: string, pc: string) => `Arrêter le rig « ${rig} » sur ${pc} ?`,
    restart: (rig: string, pc: string) => `Redémarrer le rig « ${rig} » sur ${pc} ?`,
    working: (n: number) => n === 1 ? '1 siège travaille ; son travail en cours s\'arrête avec lui.' : `${n} sièges travaillent ; leur travail en cours s'arrête avec eux.`,
    noneWorking: 'Aucun siège ne travaille en ce moment.',
    restartNote: 'Un snapshot est pris d\'abord ; chaque siège reprend ensuite sa conversation quand son harnais le permet.',
    snapshot: 'Prendre un snapshot avant (pour le relancer tel quel)',
    force: 'Couper tout de suite, sans laisser finir',
    stopDaemon: (pc: string) => `Arrêter le daemon OpenRig sur ${pc} ?`,
    restartDaemon: (pc: string) => `Redémarrer le daemon OpenRig sur ${pc} ?`,
    daemonStops: (rigs: number) => `${rigs === 0 ? 'Le kernel s\'arrête' : rigs === 1 ? '1 rig et le kernel s\'arrêtent' : `${rigs} rigs et le kernel s'arrêtent`} avec lui.`,
    stopKernel: (pc: string) => `Arrêter le kernel sur ${pc} ?`,
    restartKernel: (pc: string) => `Redémarrer le kernel sur ${pc} ?`,
    kernelNote: 'Arrêter ou redémarrer le kernel arrête Max : une équipe en cours de composition attend.',
    cancel: 'Annuler'
  },
  /** An action under way, then its receipt. */
  running: {
    'rig.stop': (rig: string) => `Arrêt de ${rig}…`, 'rig.restart': (rig: string) => `Redémarrage de ${rig}…`, 'rig.start': (rig: string) => `Démarrage de ${rig}…`,
    'rig.snapshot': (rig: string) => `Snapshot de ${rig}…`, 'rig.permissions': (rig: string) => `Permissions de ${rig}…`, 'rig.policy': (rig: string) => `Permissions de ${rig}…`,
    'seat.set': (seat: string) => `Réglages de ${seat}…`, seats: (rig: string) => `Sièges de ${rig}…`,
    'daemon.start': () => 'Démarrage d\'OpenRig…', 'daemon.stop': () => 'Arrêt du daemon…', 'daemon.restart': () => 'Redémarrage du daemon…',
    'kernel.start': () => 'Démarrage du kernel…', 'kernel.stop': () => 'Arrêt du kernel…', 'kernel.restart': () => 'Redémarrage du kernel…',
    note: 'le rig répond quand c\'est fait',
    checking: 'Vérification de l\'appareil…'
  },
  done: {
    'rig.stop': (rig: string) => `${rig} arrêté`, 'rig.restart': (rig: string) => `${rig} redémarré`, 'rig.start': (rig: string) => `${rig} démarré`,
    'rig.snapshot': (rig: string) => `Snapshot de ${rig} pris`, 'rig.permissions': (rig: string) => `Permissions de ${rig} appliquées`, 'rig.policy': (rig: string) => `Permissions de ${rig} appliquées`,
    'seat.set': (seat: string) => `Réglages de ${seat} enregistrés`,
    'daemon.start': () => 'OpenRig démarré', 'daemon.stop': () => 'Daemon arrêté', 'daemon.restart': () => 'Daemon redémarré',
    'kernel.start': () => 'Kernel démarré', 'kernel.stop': () => 'Kernel arrêté', 'kernel.restart': () => 'Kernel redémarré',
    snapshotFirst: 'snapshot pris avant',
    close: 'Fermer'
  },
  /** The verb a refusal names (« Pas arrêté : … »). */
  notDone: {
    'rig.stop': 'Pas arrêté', 'rig.restart': 'Pas redémarré', 'rig.start': 'Pas démarré', 'rig.snapshot': 'Pas de snapshot', 'rig.permissions': 'Pas appliqué', 'rig.policy': 'Pas appliqué',
    'seat.set': 'Pas enregistré', seats: 'Rien n\'a changé',
    'daemon.start': 'Pas démarré', 'daemon.stop': 'Pas arrêté', 'daemon.restart': 'Pas redémarré', 'kernel.start': 'Pas démarré', 'kernel.stop': 'Pas arrêté', 'kernel.restart': 'Pas redémarré'
  },
  rejected: {
    confirm_required: 'Protège d\'abord tes accords depuis Réglages.',
    assertion_expired: (apple: boolean) => `la vérification ${apple ? 'Face ID' : 'de l\'appareil'} a expiré.`,
    assertion_invalid: (apple: boolean) => `la vérification ${apple ? 'Face ID' : 'de l\'appareil'} n'a pas été reconnue.`,
    cancelled: 'vérification annulée.',
    unavailable: 'ce PC n\'expose pas OpenRig.',
    unsent: 'pas envoyé, le PC ne répond pas.',
    againStop: 'Rien n\'a été envoyé. Arrête de nouveau pour vérifier encore.',
    nothingSent: 'Rien n\'a été envoyé.'
  },
  busy: { title: (pc: string) => `Une autre action OpenRig est en cours sur ${pc}.`, body: 'Réessaie quand elle sera finie.' },
  failed: (why: string) => `Échec : ${why}`,
  /** « Pas arrêté : la vérification Face ID a expiré. » */
  because: (verb: string, why: string) => `${verb} : ${why}`,
  errors: {
    not_installed: 'OpenRig n\'est pas installé sur le PC.',
    spec_unknown: 'La spec de ce rig est inconnue du PC : « Spec » n\'est pas possible.',
    spec_no_policy: 'La spec de ce rig ne donne aucune politique de permissions : « Spec » n\'est pas possible.',
    spec_policy_unsupported: 'La politique de la spec n\'est pas une de celles qu\'OpenRig applique.',
    rig_not_running: 'Ce rig ne tourne pas.',
    rig_root_unknown: 'Le dossier de ce rig est inconnu : ses sièges ne se changent que depuis le PC.',
    failed: 'OpenRig a échoué.'
  } as Record<string, string>,
  completed: (n: number, all: number) => `Arrêté après ${n} ${plural(n, 'siège', 'sièges')} sur ${all}.`,
  /** §5: stopped, starting, partial. */
  resume: 'Reprise',
  resumeLast: (when: string) => `Reprendre le dernier snapshot (${when})`,
  resumeLastBody: 'chaque siège retrouve sa conversation',
  fresh: 'À neuf',
  freshBody: 'nouvelles conversations, depuis la spec',
  startingSeats: (rig: string, up: number, all: number) => `Démarrage de ${rig}… · ${up}/${all} ${plural(up, 'siège', 'sièges')}`,
  partial: (stopped: string[], others: number) => `${stopped.length === 1 ? `« ${stopped[0]} » est arrêté` : `${list(stopped.map(s => `« ${s} »`))} sont arrêtés`} ; ${others === 1 ? 'l\'autre tourne' : `les ${others} autres tournent`}.`,
  /** §6: seats. */
  reseat: {
    title: (rig: string, pc: string) => `Sièges du rig « ${rig} » · ${pc}`,
    today: (parts: string) => `Le rig reste en marche. Aujourd'hui : ${parts}.`,
    part: (n: number, role: string) => `${n} ${role}`,
    fewer: (role: string) => `Un siège de moins pour ${role}`,
    more: (role: string) => `Un siège de plus pour ${role}`,
    adds: (id: string) => `+ ${id}`,
    removes: (id: string) => `retire ${id}`,
    delegation: 'Liens des sièges ajoutés', pairs: 'Par paires', all: 'Chacun à tous',
    working: (ids: string[]) => ids.length === 1 ? `${ids[0]} travaille : son travail en cours s'arrête.` : `${list(ids)} travaillent : leur travail en cours s'arrête.`,
    lastFirst: 'Les dernières copies partent d\'abord ; le premier siège seulement à 0.',
    add: (n: number) => `Ajouter ${n} ${plural(n, 'siège', 'sièges')}`,
    remove: (n: number) => `Retirer ${n} ${plural(n, 'siège', 'sièges')}`,
    change: (add: number, remove: number) => `Ajouter ${add}, retirer ${remove}`,
    noChange: 'Rien à changer',
    added: (n: number, links: number | undefined) => `+${n} ${plural(n, 'siège', 'sièges')}${links ? `, ${links} ${plural(links, 'lien', 'liens')}` : ''}. Un snapshot suit, pour qu'un redémarrage garde la nouvelle taille.`,
    removed: (n: number) => `−${n} ${plural(n, 'siège', 'sièges')}. Un snapshot suit, pour qu'un redémarrage garde la nouvelle taille.`,
    new: 'nouveau',
    notRunning: { title: 'Ce rig ne tourne pas.', body: 'Les sièges se changent quand le rig tourne.' },
    wouldLeave: { title: 'Un siège partirait : vérifie avec Face ID.', titleDevice: 'Un siège partirait : vérifie avec ton appareil.', body: 'Le rig a changé depuis la lecture du téléphone ; rien n\'a été retiré.' },
    noLinks: { title: 'Les sièges ajoutés n\'ont pas de lien de délégation.', body: 'Cet OpenRig ne sait pas lier des sièges ajoutés à un rig en marche (avant 0.7).' }
  },
  /** §7: permissions, seat settings, snapshots. */
  permissions: {
    title: (rig: string) => `Permissions de ${rig}`,
    sub: 'Ce que les agents peuvent faire sans demander.',
    spec: (level: string) => `Spec : ${level}.`,
    hint: {
      auto: 'Claude décide seul avec son mode auto ; Codex n\'en a pas et garde la posture par défaut.',
      standard: 'Tout passe, sauf PR, publication, fusion, force push et actions destructrices, qui demandent une personne.',
      open: 'Tout passe, sauf les actions destructrices.',
      yolo: 'Aucune demande.',
      locked: 'Seuls la chaîne d\'outils et rig up / down passent ; le reste est refusé.',
      spec: 'Remettre la politique de la spec (elle peut être YOLO).'
    },
    faceId: 'Face ID', check: 'Appareil',
    apply: 'Appliquer',
    unavailable: 'Les permissions de ce rig n\'ont pas pu être lues.'
  },
  seatSettings: {
    title: (seat: string, rig: string) => `Réglages du siège ${seat} · ${rig}`,
    today: (parts: string[]) => `Aujourd'hui sur ${parts.join(' · ')}.`,
    harness: 'Harnais', whenNow: 'tout de suite',
    model: 'Modèle', whenResume: 'à la reprise',
    effort: 'Effort',
    permissions: 'Permissions', whenLaunch: 'au lancement',
    perm: { inherit: 'Celle du rig', auto: 'Auto', full_bypass: 'YOLO' },
    effortLevel: { medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé' },
    moveNote: 'Changer de harnais arrête le siège : un successeur reprend son contexte.',
    save: 'Enregistrer',
    modelLabel: 'Modèle du siège'
  },
  snapshots: {
    title: (rig: string) => `Snapshots de ${rig}`,
    kind: { manual: 'manuel', 'auto-pre-down': 'avant un arrêt', 'auto-periodic': 'périodique', pre_restore: 'avant une reprise' } as Record<string, string>,
    status: { complete: 'fait', completed: 'fait', done: 'fait', ok: 'fait', failed: 'échoué', pending: 'en cours' } as Record<string, string>,
    today: (t: string) => `aujourd'hui ${t}`, yesterday: (t: string) => `hier ${t}`,
    take: 'Prendre un snapshot maintenant',
    utc: 'Les heures sont celles du téléphone (OpenRig les donne en UTC).',
    none: 'Aucun snapshot pour l\'instant.',
    unavailable: 'Les snapshots n\'ont pas pu être lus.'
  },
  /** §8: the kernel and the daemon. */
  kernelView: {
    role: 'Le rig d\'OpenRig lui-même. Max t\'aide à composer et lancer une équipe ; l\'advisor relit les plans ; le queue worker route les lignes de queue entre les sièges.',
    max: 'Max',
    lastMessage: (t: string) => `Max · dernier message · ${t}`,
    talk: 'Parler à Max',
    driven: 'Rigs pilotés',
    routing: 'Routage de la file', allRigs: 'tous les rigs',
    noRouting: 'Aucun mouvement récent.',
    change: {
      claimed: 'a pris', completed: 'a terminé', canceled: 'a annulé', resumed: 'a repris', failed: 'a échoué',
      handed: (to: string) => `a passé à ${to}`, blocked: (on: string) => `attend ${on}`
    },
    actor: (seat: string) => `« ${seat} »`,
    stoppedTitle: 'Le kernel est arrêté.', stoppedBody: 'Max ne peut pas t\'aider à composer un rig.', startKernel: 'Démarrer le kernel',
    skippedTitle: 'Le daemon a démarré sans le kernel.', skippedBody: 'Désactive « Démarrer sans le kernel » puis redémarre le daemon, ou démarre le kernel seul.',
    daemonNote: 'Arrêter le daemon arrête tous les rigs et le kernel. Ces deux choix vivent sur ce téléphone ; Desktop garde les siens.'
  },
  /** §9: Max. */
  max: {
    title: 'Max', role: 'opérateur du kernel',
    newGoal: 'Objectif',
    goalPlaceholder: 'Un nouvel objectif pour Max…',
    replyPlaceholder: 'Écrire à Max sur cet objectif…',
    offlinePlaceholder: 'Reconnecte-toi pour écrire',
    send: 'Envoyer à Max',
    goalsLabel: 'Objectifs donnés à Max',
    none: 'Aucun objectif pour l\'instant. Écris le premier ci-dessous.',
    asks: 'Max te pose une question',
    state: { sent: 'envoyé', taken: 'pris', asking: 'question', proposed: 'équipe proposée', running: 'en cours', done: 'fini', closed: 'clos' },
    statePill: { sent: 'envoyé', taken: 'pris', asking: 'question', proposed: 'proposée', running: 'en cours', done: 'fini', closed: 'clos' },
    since: (t: string) => `depuis ${t}`,
    atoiNote: 'Les propositions et questions de Max attendent aussi dans À toi, où elles se répondent.',
    trail: {
      sent: 'Tu l\'as donné', taken: 'Max l\'a pris', note: (text: string) => `Tu as écrit : « ${text} »`, handed: (to: string) => `passé à ${to}`, closed: 'clos'
    },
    taken: 'pris',
    proposal: 'Équipe proposée',
    proposalBody: 'Réponds dans À toi : la même carte, les mêmes boutons.',
    question: 'Max te pose une question',
    questionBody: 'Réponds dans À toi.',
    seeAtoi: 'Voir dans À toi',
    partial: 'Les plus anciens ne sont pas montrés.',
    errors: {
      no_operator: { title: 'Le kernel n\'a pas d\'operator pour recevoir la demande.', body: 'Démarre le kernel, puis renvoie.' },
      openrig_stopped: { title: (pc: string) => `OpenRig est arrêté sur ${pc}.`, body: 'Démarre OpenRig, puis renvoie.' },
      unreachable: { title: 'Max ne répond pas.', body: 'Pas envoyé. Réessaie.' },
      uncertain: { title: 'La demande est peut-être partie, sans confirmation.', body: 'La renvoyer est sans risque : Max ne la recevra pas deux fois.' },
      refused: { title: 'Max a refusé la demande.', body: '' }
    },
    sendAgain: 'Renvoyer',
    unsent: 'Pas envoyé : le PC ne répond pas.',
    sending: 'Envoi à Max…',
    goalsUnavailable: 'Les objectifs de Max n\'ont pas pu être lus.'
  },
  readError: { unknown_rig: 'Ce rig n\'existe plus sur le PC.', not_installed: 'OpenRig n\'est pas installé sur le PC.', daemon_stopped: 'OpenRig est arrêté.', unavailable: 'OpenRig n\'a pas répondu à temps.' },
  /** Sessions › a rig's group (Q48): its rig opens in the Rigs tab. */
  openRig: 'Ouvrir le rig'
};

export type RigsCopy = typeof rigsFr;
