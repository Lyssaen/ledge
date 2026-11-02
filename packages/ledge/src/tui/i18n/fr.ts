import { formatBytes } from '@ledge/ui/images/encode';
import type { BotState } from '@ledge/ui/bots/poseFor';
import { actionCopy } from '@ledge/ui/chat/actionCopy';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** `ledge tui`'s copy in French, the source of truth: `en.ts` is typed against it. */
export const fr = {
  lang: { fr: 'Français', en: 'English' },
  state: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  time: {
    now: 'à l’instant', decimal: ',', s: (n: number) => `${n} s`, min: (n: number) => `${n} min`, h: (n: number) => `${n} h`, d: (n: number) => `${n} j`
  },
  tabs: { overview: 'Accueil', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages', teams: 'Modèles' },
  bar: {
    machines: (n: number) => `${n} ${plural(n, 'machine', 'machines')}`,
    rigs: (n: number) => `${n} ${plural(n, 'équipe', 'équipes')}`,
    agents: (n: number) => `${n} ${plural(n, 'agent', 'agents')}`,
    solo: (n: number) => `${n} ${plural(n, 'session seule', 'sessions seules')}`,
    waiting: (n: number) => `${n} t’${plural(n, 'attend', 'attendent')}`,
    connecting: 'connexion au daemon…',
    unreachable: 'daemon injoignable, nouvel essai…',
    tokenMissing: 'pas de jeton : lancez une session avec `ledge claude` ou `ledge daemon`'
  },
  keys: {
    seats: 'sièges', openSeat: 'ouvrir le siège', attachSeat: 'attacher', ledge: 'Ledge',
    image: 'image', openImage: "ouvrir l'image",
    navigate: 'naviguer', open: 'ouvrir', answer: 'répondre', attach: 'attacher (tmux)', ask: 'demander à Ledge', launch: 'nouvelle session',
    settings: 'réglages', help: 'aide', quit: 'quitter', back: 'retour', write: 'écrire', diffs: 'diffs', terminal: 'terminal', model: 'modèle',
    interrupt: 'interrompre', next: 'suivante en attente', unfold: 'déplier', send: 'envoyer / lancer', nextCard: 'carte suivante',
    newChat: 'nouvelle conversation', stopAnswer: 'arrêter la réponse', nextField: 'champ suivant', choose: 'choisir', tick: 'cocher',
    start: 'lancer', cancel: 'annuler', change: 'changer', scroll: 'défiler', space: 'espace', redraw: 'autre nom',
    save: 'enregistrer l’équipe', tasks: 'tâches de l’équipe', join: 'rejoindre une équipe', resume: 'reprendre l’équipe', teamMode: 'session ou équipe', handover: 'passer le relais', answerDecision: 'répondre à la décision', sendAnswer: 'envoyer la réponse', edit: 'modifier',
    sendOnly: 'envoyer', newLine: 'nouvelle ligne', keepAndLeave: 'garder et sortir', lineHistory: 'ligne · historique', history: 'historique',
    word: 'mot', clear: 'effacer', resend: 'renvoyer', backToDraft: 'revenir au brouillon', keep: 'garder', wipe: 'effacer',
    line: 'ligne', page: 'page', end: 'fin', question: 'question', conversation: 'conversation', cycle: 'cartes · conversation',
    applyRow: 'appliquer la ligne', apply: 'appliquer', applyAll: 'tout appliquer', deny: 'refuser', ignore: 'ignorer', review: 'revoir',
    openSession: (name: string) => `ouvrir ${name}`,
    screens: 'Ledge · équipe · session · modèles',
    decide: 'trancher', revisit: 'revenir dessus', fold: 'replier', talk: 'en parler', complete: 'compléter',
    tabs: 'onglets', summarize: 'résumer', point: 'le point', close: 'fermer', mandate: 'le mandat',
    rolesTemplates: 'rôles / modèles', folder: 'dossier', launchRole: 'lancer avec ce rôle', launchTeam: 'lancer cette équipe', openFile: 'ouvrir le fichier', ignored: 'ignorés', reread: 'relire'
  },
  home: {
    ledge: 'Ledge', crumb: '1 Ledge · 2 Équipe · 3 Session · 4 Modèles',
    decision: (n: number) => `${n > 1 ? `${n} décisions t’attendent` : 'Une décision t’attend'}`,
    grace: 'Ledge s’en occupe…', calm: 'Rien à trancher.',
    projects: 'Projets · sessions seules', rigs: 'Équipes', resting: 'au repos',
    working: (w: number, n: number) => `${w}/${n} au travail`,
    inProject: (name: string) => `dans ${name}`, offProject: 'hors projet', onMachine: (m: string) => `sur ${m}`,
    available: (names: string, n: number) => `${names} · ${plural(n, 'disponible', 'disponibles')}`,
    kernel: 'Noyau OpenRig',
    kernelState: { idle: 'au repos', working: 'au travail', absent: 'absent', stopped: 'arrêté', starting: 'démarre', unsupported: 'non pris en charge', error: 'en erreur', unreachable: 'injoignable' } as Record<'idle' | 'working' | 'absent' | 'stopped' | 'starting' | 'unsupported' | 'error' | 'unreachable', string>,
    noOpenRig: 'OpenRig n’est pas installé · + pour lancer une équipe',
    conversation: 'Ledge · Conversation',
    noSeat: 'Aucun siège.', seatAlone: 'Ce siège n’a pas de session Ledge : rien à afficher ici pour l’instant.'
  },
  /** The home's centre for Ledge: its tabs, and the rail on its right (folded into one line from 100 to 139 columns). */
  ledgeTabs: { conversation: 'Conversation', rigs: 'Équipes', mandat: 'Mandat' },
  rail: {
    rigs: (n: number) => `Équipes · ${n}`, kernel: 'noyau', room: '2 · la pièce de l’équipe',
    settled: (n: number) => `Tranché aujourd’hui · ${n}`, revisit: 'u revenir dessus',
    mandate: 'Mandat', alone: 'Ledge tranche seul :', always: 'Te reviennent toujours :', more: 'm le mandat et ses souvenirs',
    summary: 'Résumer la journée',
    summaryAsk: 'Résume ma journée : ce que les équipes ont fait, ce que j\'ai tranché, ce qui m\'attend.',
    folded: (n: number) => `${n} ${plural(n, 'tranchée', 'tranchées')}`, detail: 'détail',
    noRig: 'Aucune équipe.', spec: (s: string) => `spec ${s}`,
    coming: 'Le mandat arrive avec le cerveau de Ledge.', rules: 'Règles', toValidate: 'à valider',
    applied: (n: number) => `appliquée ${n} fois`
  },
  /** Ledge's conversation in the home: its thread, the decisions drawn in its messages, the exchanges between agents. */
  conv: {
    days: { today: 'Aujourd’hui', yesterday: 'Hier', date: (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}` },
    age: { now: 'à l’instant', minutes: (n: number) => `${n} min`, hours: (n: number) => `${n} h`, days: (n: number) => `${n} j`, ago: (span: string) => `il y a ${span}` },
    you: 'toi', ledge: 'Ledge',
    advice: (text: string) => `Mon avis : ${text}`, talk: 'En parler', seen: 'Vu',
    by: { user: 'par toi', ledge: 'par Ledge' } as Record<'user' | 'ledge', string>,
    already: 'Déjà répondu', closed: 'Réglée ailleurs', grace: 'Ledge s’en occupe…', sending: 'envoi…',
    refused: (code: string, reason?: string) => `Refusé : ${reason ?? code}`,
    decided: { before: 'J’ai tranché pour ', after: (summary: string) => ` : ${summary.replace(/[.\s]+$/, '')}.` },
    rule: (rule: string) => `Règle ${rule}`, revisit: 'Revenir dessus',
    revisitRefused: (reason: string) => `Revenir dessus : ${reason === 'not supported yet' ? 'pas encore possible, le cerveau de Ledge arrive' : reason}`,
    exchanges: (n: number) => (n === 1 ? '1 échange' : `${n} échanges entre agents`),
    unfold: '↵ déplier', fold: 'z replier', missing: (n: number) => `${n} ${plural(n, 'échange plus ancien', 'échanges plus anciens')} pas encore chargé${n > 1 ? 's' : ''}`,
    choose: 'j k pour la choisir, puis 1 2…',
    about: (summary: string) => `Question · à propos de ${summary}`
  },
  /** The field to write to Ledge, its suggestions and its `@` list. */
  compose: {
    title: 'Écrire à Ledge', placeholder: 'Écrire à Ledge… (@build pour un agent d’une équipe)',
    foot: 'tranche dans son mandat · design, architecture et critique te reviennent', footShort: 'design, architecture, critique te reviennent',
    launchRig: 'Lance une équipe…', whereIs: (rig: string) => `Où en est ${rig} ?`, decided: 'Qu’as-tu tranché ?', needsMe: 'Qui a besoin de moi ?',
    alt: (n: number) => `alt+1…${n}`, mentionTitle: '@ un agent d’une équipe'
  },
  /** A team seat's state (« Attend Ledge »: an escalation of this seat is open). */
  /** A rig's room and the OpenRig kernel's (the mockup's « La pièce d’une équipe » and « Le noyau »). */
  room: {
    rig: 'équipe', mark: 'sa pièce', seats: (n: number) => `${n} ${plural(n, 'siège', 'sièges')}`, since: (at: string) => `depuis ${at}`,
    lead: (seat: string) => `lead ${seat}`, unreachable: 'injoignable',
    head: { seat: 'SIÈGE', name: 'NOM', state: 'ÉTAT', agent: 'AGENT', context: 'CONTEXTE', on: 'SUR', role: 'RÔLE' },
    exchanges: (rig: string) => `Échanges · ${rig}`, rigSend: 'rig send', loading: 'Chargement des échanges…',
    queue: (scope: string) => `File OpenRig · ${scope}`, teamQueue: (scope: string) => `File · ${scope}`, all: 'tout', emptyQueue: 'File vide.',
    queueState: { 'en cours': 'en cours', 'à toi': 'à toi', fait: 'fait' } as Record<'en cours' | 'à toi' | 'fait', string>,
    terminal: (seat: string, where: string) => `Terminal · ${seat} · ${where}`, noTerminal: 'Pas encore de terminal suivi.',
    kernel: 'Noyau OpenRig · la mécanique', kernelMark: 'toujours allumé', kernelWhere: 'noyau', orders: 'Ordres de Ledge à l’operator',
    daemon: { running: 'daemon en marche', stopped: 'daemon arrêté', starting: 'daemon qui démarre', error: 'daemon en erreur', unreachable: 'injoignable', absent: 'OpenRig absent', unsupported: 'version non prise en charge' } as Record<'running' | 'stopped' | 'starting' | 'error' | 'unreachable' | 'absent' | 'unsupported', string>,
    version: (v: string) => `OpenRig ${v}`, human: (address: string) => `humain : ${address}`, noHuman: 'humain non enregistré',
    tucked: (n: number) => `+${n} ${plural(n, 'rangé', 'rangés')}`, advisor: '(doublon de Ledge)', humanSeat: '(remplacé par Ledge)',
    roles: { operator: 'fait tourner OpenRig, reçoit les ordres de Ledge', queue: 'range le flux entrant en tâches' } as Record<string, string>,
    you: 'toi', noTerminalCommand: (seat: string) => `Pas de terminal à attacher pour ${seat}.`
  },
  /** A rig's actions through OpenRig (rig.act, rig.adopt): « Arrêter… », « Relancer un siège… », « Reprendre », « Ranger dans un projet… ». */
  rigAct: {
    keys: { restart: 'relancer', stop: 'arrêter…', adopt: 'ranger dans un projet…', resume: 'reprendre', leave: 'quitter l’équipe', choose: 'choisir', confirm: 'confirmer', cancel: 'annuler' },
    restartSeat: 'Relancer un siège…', stopRig: 'Arrêter l’équipe…', adoptRig: 'Ranger dans un projet…', resumeRig: 'Reprendre',
    viaOpenRig: 'Relancer et arrêter passent par OpenRig : un kill côté Ledge serait vu comme un crash.',
    restartAsk: (seat: string) => `Relancer ${seat} par OpenRig ?`, yes: '↵ oui', no: 'esc non',
    stopTitle: (rig: string) => `Arrêter ${rig} ?`, stopAll: 'Arrêter l’équipe', stopSeat: (seat: string) => `Seulement ce siège · ${seat}`,
    stopBodyLedge: (n: number) => `${n > 1 ? `Ses ${n} sièges s’arrêtent` : 'Son siège s’arrête'}. L’équipe se met au repos : ses conversations sont gardées, R ou u la reprend.`,
    restartAskLedge: (seat: string) => `Relancer ${seat} ?`,
    leaveAsk: (seat: string, team: string) => `${seat} quitte l’équipe ${team} ?`,
    viaLedge: 'Arrêter met l’équipe au repos : ses conversations sont gardées.',
    stopBody: (n: number) => `${n > 1 ? `Ses ${n} sièges s’arrêtent` : 'Son siège s’arrête'}. OpenRig garde un instantané pour le reprendre. Les fichiers restent.`,
    adoptTitle: (rig: string) => `Ranger ${rig} dans un projet ?`, holds: (repos: string) => `contient déjà ${repos}`, leaveOut: 'Laisser hors projet',
    adoptNote: (rig: string, project: string) => `${rig} garde sa pièce ; sa plaque dira « dans ${project} ». Elle ne devient pas une seconde table de ${project}.`,
    stayNote: (rig: string) => `${rig} garde sa pièce, hors projet.`, adopt: 'Ranger', cancel: 'Annuler',
    repos: 'Dépôts trouvés en route', how: { cloned: 'cloné par', opened: 'ouvert par', created: 'créé par' } as Record<'cloned' | 'opened' | 'created', string>,
    found: 'Repérés par les dossiers git de l’espace, puis rattachés au siège qui les a clonés ou ouverts (hooks).',
    already: (repo: string, project: string) => `${repo} est déjà un dépôt du projet ${project}.`, noRepo: 'Aucun dépôt trouvé pour l’instant.',
    done: {
      down: (rig: string) => `${rig} s’arrête`, stop: (seat: string) => `${seat} s’arrête`, restart: (seat: string) => `${seat} redémarre`,
      up: (rig: string) => `${rig} reprend`, adopted: (rig: string, project: string) => `${rig} rangé dans ${project}`,
      left: (seat: string, team: string) => `${seat} quitte ${team}.`
    },
    refused: {
      rig_managed: 'Ce siège appartient à son équipe : arrête-le ou relance-le dans sa pièce.', openrig_down: 'OpenRig ne répond pas.',
      unreachable: 'Machine injoignable.', failed: 'L’action a échoué.', timeout: 'OpenRig n’a pas répondu (5 s).'
    } as Record<string, string>
  },
  seat: { waitsLedge: 'Attend Ledge', working: 'Au travail', idle: 'Disponible', attention: 'Intervention requise', starting: 'Démarrage', stopped: 'Arrêté', crashed: 'Planté', unreachable: 'Injoignable' },
  omp: { title: 'fil · OMP', foot: 'piloté par RPC · rien n’est tapé dans un terminal', you: 'toi', writing: 'écrit…', empty: 'Le fil arrive…' },
  overview: {
    yours: (n: number) => `À toi · ${n}`, projects: 'Projets', exchanges: 'Échanges', terminal: (name: string) => `Terminal · ${name}`, inColor: '· en couleurs',
    nobodyWaits: 'Personne ne t’attend.', noSession: 'Aucune session. + pour en lancer une.', noPreview: 'Pas d’aperçu.', noExchange: 'Aucun échange.',
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'Hors projet', offline: 'hors ligne', readOnly: 'lecture seule',
    wantsToRun: 'Veut exécuter :', asks: 'Demande :', plan: 'Propose un plan :', diff: 'Veut modifier :',
    allow: 'Autoriser', deny: 'Refuser', always: 'Toujours', denyWithNote: 'Refuser en expliquant',
    askLine: (name: string, question: string) => `? ${name} : ${question}`, askHint: (id: string) => `ledge decide ${id} "<réponse>"`,
    tasks: (team: string) => `Tâches · ${team}`, noTask: 'Aucune tâche.', ledge: 'Ledge',
    near: (name: string, pct: number) => `${name} · ctx ${pct} % · H relève`,
    reliefFailed: (name: string, why: string) => `La relève de ${name} a échoué : ${why}`,
    context: (pct: number) => `ctx ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`,
    ledgeTask: (owner: string, title: string, state: 'done' | 'refused' | 'dropped') => `${owner} a ${state === 'done' ? 'fini' : state === 'refused' ? 'refusé' : 'abandonné'} « ${title} » · tâche de Ledge`,
    decision: (giver: string, title: string) => `${giver} te demande : ${title}`,
    decisionTitle: (giver: string, title: string) => `Répondre à ${giver} · ${title}`, decisionHint: 'Ta réponse, telle que la session la lira…',
    confirmAnswer: (giver: string) => `Envoyer à ${giver} ? Une réponse ne se reprend pas`,
    joinWhich: (name: string) => `${name} rejoint quelle équipe ? (↑↓ ↵, esc)`, noTeamHere: 'Aucune équipe dans ce projet.', notInTeam: 'Cette session n’est dans aucune équipe.'
  },
  session: {
    you: 'Vous', unfold: 'déplier', fold: 'replier', actions: (n: number) => `${n} ${plural(n, 'action', 'actions')}`,
    files: (n: number) => `${n} ${plural(n, 'fichier modifié', 'fichiers modifiés')}`,
    since: (label: string, t: string) => `${label} · depuis ${t}`,
    wants: (name: string) => `${name} veut exécuter`, colon: ' :', sentTo: 'envoyé à', receivedFrom: 'reçu de',
    decision: { accept: 'autorisé', deny: 'refusé', always: 'toujours autorisé', unknown: 'répondu au terminal' } as Record<'accept' | 'deny' | 'always' | 'unknown', string>,
    above: (n: number) => `↑ ${n} plus haut`, scrolled: (above: number, below: number) => `${above ? `↑ ${above} plus haut · ` : ''}↓ ${below} · G fin`,
    sent: { sending: 'envoi…', delivered: 'remis', read: 'lu', failed: 'échec' } as Record<'sending' | 'delivered' | 'read' | 'failed', string>,
    helperWorking: (n: number) => `au travail · ${n} ${plural(n, 'action', 'actions')}`, helperDone: 'terminé',
    replyTo: (name: string) => `Répondre à ${name}…`, noteFor: (name: string) => `Expliquer le refus à ${name}…`,
    replyTitle: (name: string) => `Répondre à ${name}`, noteTitle: (name: string) => `Refuser en expliquant à ${name}`, writeDraft: 'Écrire · brouillon',
    draftLines: (n: number) => `${n} ${plural(n, 'ligne', 'lignes')} · r pour reprendre`,
    loading: 'Chargement du fil…', empty: 'Rien encore dans ce fil.', noSession: 'Choisissez une session dans l’accueil.',
    model: (m: string) => `modèle : ${m}`, defaultModel: 'par défaut', notice: 'Ledge',
    seatTitle: (name: string, address: string, rig: string) => `Écrire à ${name} · ${address} · ${rig}`, seatPlaceholder: (name: string) => `Écrire à ${name}…`,
    seatRemote: 'Ce siège est sur une autre machine : écris-lui depuis là-bas.',
    seatFoot: 'rig send signé Ledge · l’échange s’affiche aussi dans le fil de Ledge'
  },
  ask: {
    title: (s: number, m: number) => `Ledge · voit ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    read: 'lu', reading: 'Ledge lit…', you: 'vous', empty: 'Posez une question : qui a besoin de moi, où en est une session, que lancer…',
    launchCard: 'Nouvelle session', relayCard: (name: string) => `Relayer à ${name}`, closeCard: 'Fermer des sessions', launch: 'Lancer la session',
    relay: 'Envoyer', cancelRelay: 'Retirer de la file', close: 'Fermer', ignore: 'Ignorer', nothingWithoutYou: 'Ledge ne lance rien sans toi.',
    folder: 'Dossier', agent: 'Agent', instruction: 'Instruction', launched: 'lancée', queued: 'en file', sentAt: 'envoyée', closed: 'fermée',
    offline: 'Le daemon local est hors ligne : la question attendra.',
    steps: { sessions: 'les sessions', pane: (n: string) => `le terminal de ${n}`, reply: (n: string) => `la réponse de ${n}`, git: (n: string) => `l’état git de ${n}`, repo: (p: string) => p },
    operator: (s: number, m: number) => `Ledge · Opérateur · voit ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    teamCard: (name: string) => `Équipe · ${name}`, taskCard: 'Tâches à confier', launchTeam: 'Lancer l’équipe', save: 'Enregistrer', saved: 'enregistrée',
    seats: 'Sièges', table: 'Pièce', newTable: (project: string) => `sa propre pièce dans ${project}`,
    autonomy: { ask: 'demande', edits: 'modifie sans demander', auto: 'autonome' } as Record<'ask' | 'edits' | 'auto', string>,
    autoWarning: (roles: string) => `${roles} travaillera sans demander.`, teamLaunched: (at: string) => `✓ Équipe lancée à ${at}`,
    give: 'Confier', waitTeam: 'active une fois l’équipe lancée',
    given: (owner: string, id: string, state: string) => `✓ Confiée à ${owner} · ${id} · ${state}`,
    taskState: { open: 'à prendre', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' } as Record<'open' | 'taken' | 'done' | 'refused' | 'dropped', string>,
    resetTitle: 'Nouvelle conversation ?',
    resetBody: (n: number, since: string) => `La conversation du jour (${n} ${plural(n, 'question', 'questions')}, depuis ${since}) sera effacée.`,
    draftStays: 'Ton brouillon reste.', keep: 'Garder', wipe: 'Effacer et repartir',
    above: (n: number) => `↑ ${n} ${plural(n, 'ligne', 'lignes')} plus haut · PgUp`, answering: '↓ Ledge répond · G pour suivre',
    /** The generic card (#94): the words every PC front shares (`copy`), and the terminal's own. */
    action: {
      copy: actionCopy.fr,
      plan: (n: number) => `Plan · ${n} actions`, request: (kind: string, name: string) => `${kind} · ${name}`,
      confirmOne: (line: string) => `Confirmer · ${line}`, confirmMany: (n: number, d: number) => `Confirmer · ${n} actions, ${d} ${plural(d, 'irréversible', 'irréversibles')}`,
      state: { done: (at: string) => `appliquée${at ? ` ${at}` : ''}`, running: 'en cours', held: 'pas appliquée', refused: 'refusée', cut: 'coupée', denied: (at: string) => `refus envoyé${at ? ` ${at}` : ''}` },
      cutMark: '… (tronqué, voir la session : o)',
      stale: (name: string) => `La demande de ${name} a changé depuis ma réponse : rien n’a été envoyé.`,
      hint: { one: 'Ledge ne fait rien sans toi.', choose: '↑↓ choisir', cut: '↵ n’accepte pas : lis-la d’abord', stale: 'redemande à Ledge pour la nouvelle demande', confirm: '↵ ne confirme pas : tape y', inOrder: 'Dans l’ordre ; si une étape échoue, les suivantes ne sont pas appliquées.' },
      /** `sent`: the rows applied, the denials sent and the rows failed (they went too) before the rest was set aside. */
      ignored: (n: number, at: string, sent: { done: number; denied: number; failed: number } = { done: 0, denied: 0, failed: 0 }) => sent.done + sent.denied + sent.failed
        ? n > 1 ? `· plan de ${n} actions : ${[...(sent.done ? [`${sent.done} ${plural(sent.done, 'appliquée', 'appliquées')}`] : []), ...(sent.denied ? [`${sent.denied} ${plural(sent.denied, 'refus envoyé', 'refus envoyés')}`] : []), ...(sent.failed ? [`${sent.failed} ${plural(sent.failed, 'échouée', 'échouées')}`] : [])].join(', ')}, le reste ignoré à ${at} · revoir : ctrl+r`
          : `· carte ignorée à ${at}, l’action est partie, mais n’a pas abouti · revoir : ctrl+r`
        : `· ${n > 1 ? `plan de ${n} actions ignoré` : 'carte ignorée'} à ${at}, rien n’a été envoyé · revoir : ctrl+r`,
      denied: (name: string, at: string) => `Refus envoyé à ${name}${at ? ` · ${at}` : ''} : la commande n’a pas été lancée`,
      done: (line: string, at: string) => `${line}${at ? ` · ${at}` : ''}`
    }
  },
  launch: {
    title: 'Nouvelle session', preview: 'Aperçu', instruction: 'Instruction', agent: 'Agent', model: 'Modèle', effort: 'Effort', project: 'Projet', machine: 'Machine',
    repos: 'Dépôts', folder: 'Dossier', name: 'Nom', none: 'aucun', defaultModel: 'par défaut', loading: 'chargement…', drawn: '(tiré au sort · ctrl+r pour un autre)',
    folderHint: 'chemin sur la machine (~ accepté)', joins: (name: string, table: string) => `${name} rejoindra ${table}`,
    launch: 'Lancer', cancel: 'Annuler', thenAttach: 'puis a pour s’attacher à son terminal',
    missing: { prompt: 'Écrivez une instruction.', machine: 'Aucune machine en ligne.', repos: 'Choisissez un dépôt ou un dossier.' } as Record<'prompt' | 'machine' | 'repos', string>,
    launching: 'Lancement…', launched: (name: string) => `✓ ${name} est lancée`,
    teamTitle: 'Nouvelle équipe', mode: 'Mode', session: 'session', team: 'équipe', template: 'Modèle', custom: 'sièges choisis un par un', seats: 'Sièges',
    teamName: 'Nom', goal: 'Objectif', goalHint: 'facultatif · le chef de l’équipe le reçoit au lancement', noRole: 'aucun rôle : écris ~/.ledge/roles/<id>.md', loadingRoles: 'lecture des rôles…',
    teamPreview: (team: string, project: string) => `L’équipe ${team} aura sa propre pièce dans ${project}.`,
    teamLaunched: (name: string) => `✓ Équipe ${name} lancée`, teamFailed: (why: string) => `Équipe non lancée : ${why}`, noSeat: 'Choisissez au moins un siège.'
  },
  catalog: {
    roles: 'rôles', templates: 'modèles', homeOnly: 'Perso seulement',
    repoRoles: 'dépôt · .ledge/roles', homeRoles: 'perso · ~/.ledge/roles', repoTeams: 'dépôt · .ledge/teams', homeTeams: 'perso · ~/.ledge/teams',
    repo: 'dépôt', home: 'perso', tool: 'outil', model: 'modèle', effort: 'effort', autonomy: 'autonomie', file: 'fichier', usedIn: 'dans', heldBy: 'tenu par',
    teams: 'équipes', replaces: (path: string) => `remplace ${path}`, toolDefault: 'défaut de l’outil', noTemplate: 'aucun modèle', nobody: 'personne', noTeam: 'aucune',
    active: 'active', resting: 'au repos', instruction: (n: number, max: number) => `Consigne · ${n}/${max}`, noInstruction: 'Pas de consigne.',
    seats: (n: number) => `${n} ${plural(n, 'poste', 'postes')}`,
    autonomyShort: { ask: 'demande', edits: 'éditions', auto: 'auto' } as Record<'ask' | 'edits' | 'auto', string>,
    ignored: (n: number) => `⚠ ${n} ${plural(n, 'fichier ignoré', 'fichiers ignorés')}`, see: 'voir', problems: 'Fichiers ignorés', noProblem: 'Aucun fichier ignoré.',
    loading: 'lecture des rôles…', noAnswer: 'Le daemon n’a pas répondu.',
    offline: (m: string) => `${m} est hors ligne.`, outdated: (m: string) => `Le daemon de ${m} est trop ancien pour le catalogue.`, onMachine: (m: string) => `sur ${m}`,
    roleChecking: (id: string) => `@${id} : lecture du rôle dans ce dossier…`, roleReadIn: (cwd: string) => `celui de ${cwd}`,
    roleElsewhere: (id: string, cwd: string) => `@${id} n’est lu que dans ${cwd} : lancé sans rôle`, noRole: 'Aucun rôle ici : écris .ledge/roles/<id>.md', noTemplateHere: 'Aucun modèle ici : écris .ledge/teams/<id>.yaml',
    role: 'Rôle'
  },
  /** « Nouvelle équipe » in three steps: the form, Ledge's plan, the start. */
  rigLaunch: {
    title: 'Nouvelle équipe · le but, la spec, où', planTitle: 'Nouvelle équipe · le plan de Ledge', startTitle: 'Nouvelle équipe · le démarrage',
    crumb: 'Lancer › le but · (le plan) · le démarrage', mode: 'Mode', rig: 'équipe', session: 'session',
    goal: 'But', goalHint: 'Ledge s’en sert pour proposer le plan, puis pour trancher en route.',
    spec: 'Spec', specsLoading: 'lecture des specs…', specsFailed: 'Les specs n’ont pas pu être lues.', noSpec: 'aucune spec', recommended: 'recommandée par Ledge',
    seatsOf: (n: number, names: string, runtimes: string) => `${n} ${plural(n, 'siège', 'sièges')} : ${names} · ${runtimes}`,
    where: 'Où', inProject: 'dans un projet', offProject: 'hors projet (nouvel espace)',
    whereHint: (project: string) => `L’équipe aura sa propre pièce, « dans ${project} » sur la plaque.`, offHint: 'Ledge crée un espace vide, nommé d’après le but.',
    repo: 'Dépôt', noRepo: (project: string, machine: string) => `${project} n’a pas de dépôt sur ${machine}`,
    branch: 'Branche', newBranch: '(nouvelle)', copyRow: 'Copie', copy: 'Travailler dans une copie', machine: 'Machine',
    name: 'Nom', nameHint: '(tiré du but · ctrl+r pour un autre)', preview: 'Aperçu',
    previewLine: (spec: string, where: string, n: number, machine: string) => ` · équipe ${spec} · ${where} · ${n} ${plural(n, 'siège', 'sièges')} · ${machine}`,
    inProjectOf: (project: string) => `dans ${project}`, offPlace: 'hors projet',
    launch: 'Lancer', seePlan: 'Voir le plan', cancel: 'Annuler', launchRig: 'Lancer l’équipe', back: 'Retour',
    planOptional: 'Plan facultatif : l’équipe écrit dans une copie .worktrees/.', planImposed: 'Le plan est demandé une fois : l’équipe écrirait dans ton dépôt.',
    why: {
      absent: (m: string) => `OpenRig n’est pas installé sur ${m}`, unsupported: (m: string) => `La version d’OpenRig sur ${m} n’est pas prise en charge`,
      offline: (m: string) => `${m} est hors ligne`, unreachable: (m: string) => `OpenRig est injoignable sur ${m}`
    },
    install: 'Pour l’installer :',
    missing: { goal: 'Donne un but au lead.', spec: 'Choisis une spec.', repo: 'Choisis un dépôt.', branch: 'Nomme la nouvelle branche.', name: 'Nom invalide : minuscules, chiffres et tirets.' } as Record<'goal' | 'spec' | 'repo' | 'branch' | 'name', string>,
    preparing: 'Ledge prépare le plan…', launching: 'Lancement…', refused: (why: string) => `Refusé : ${why}`, timeout: (s: number) => `pas de réponse après ${s} s`,
    plan: {
      intro: 'Voici comment je monterais l’équipe. Rien n’est lancé.', head: { seat: 'SIÈGE', agent: 'AGENT', autonomy: 'AUTONOMIE' },
      folder: 'Dossier', writes: 'Ajoute dans le dossier :', command: 'Commande'
    },
    starting: {
      openrig: 'OpenRig', preparing: 'prépare le lancement…', running: 'en marche', copy: 'Copie', folder: 'Dossier', space: 'Espace',
      human: 'Ledge, humain de l’équipe', humanCommand: 'rig gateway human add ledge', up: (name: string) => `rig up ${name}`,
      upDetail: (spec: string, n: number) => `spec ${spec} · ${n} ${plural(n, 'siège', 'sièges')}`,
      seats: 'Sièges', ready: (k: number, n: number) => `${k}/${n} ${plural(k, 'prêt', 'prêts')}`,
      coming: (names: readonly string[]) => `${names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0]} ${plural(names.length, 'démarre', 'démarrent')}…`,
      attention: (names: readonly string[]) => `${names.join(', ')} : intervention requise`,
      tasks: 'Premières tâches', tasksWait: 'dans la file dès que les sièges sont prêts', tasksSent: (lead: string) => `but donné à ${lead}`
    },
    trust: (seat: string) => `${seat} attend ta confiance dans le dossier · ↵ ouvrir l’invite`,
    openRoom: 'Ouvrir sa pièce', cancelLaunch: 'Annuler le lancement', backToLedge: 'Revenir à Ledge',
    leave: 'Tu peux partir : Ledge te dira si le démarrage coince.', notNamed: 'L’équipe n’est pas encore nommée : rien à annuler pour l’instant.',
    cancelled: (name: string) => `${name} : lancement annulé`,
    keys: { mode: 'équipe ou session', seePlan: 'voir le plan', openRoom: 'ouvrir sa pièce', trust: 'ouvrir l’invite', cancelLaunch: 'annuler le lancement', ledge: 'Ledge' }
  },
  settings: { title: 'Réglages', language: 'Langue', theme: 'Thème', themes: { auto: 'Auto', dark: 'Sombre', light: 'Clair' }, themeAuto: (tone: 'dark' | 'light') => `Auto (fond ${tone === 'light' ? 'clair' : 'sombre'})`, context: 'Contexte max', contextHint: 'au-delà : passer le relais', contextUnknown: 'mettez à jour le daemon', contextSaved: (pct: number) => `Contexte max : ${pct} %`, saved: 'Réglage enregistré.', saveFailed: (m: string) => `Réglage appliqué, mais non enregistré : ${m}` },
  help: {
    title: 'Aide', global: 'Partout', overview: 'Accueil', ledge: 'Écran Ledge', rig: 'Pièce d’une équipe', session: 'Session', launch: 'Lancer', settings: 'Réglages',
    screens: 'changer d’écran', teams: 'Modèles', teamKeys: 'Équipes et décisions (accueil)', resumeTeam: 'reprendre l’équipe (sa ligne choisie)', writeToSeat: 'écrire (équipe locale)', suggestions: 'suggestions', foldExchanges: 'replier échanges', backNarrow: 'retour (étroit)', launchRig: 'nouvelle équipe/session', resumeSent: 'reprendre', answerFocus: 'trancher', tabsKeys: 'onglets', rail: 'le point · 100-139', fileIn: 'ranger (hors projet)', leave: 'quitter l’équipe', field: 'Saisie', wordBefore: 'effacer le mot avant',
    more: (above: number, below: number) => [above ? `↑ ${above} plus haut` : '', below ? `↓ ${below} plus bas` : ''].filter(Boolean).join(' · ')
  },
  field: {
    above: (n: number) => `↑ ${n} ${plural(n, 'ligne', 'lignes')}`, below: (n: number) => `↓ ${n}`,
    pasted: (n: number) => `${n} lignes collées`, line: (k: number, n: number) => `ligne ${k}/${n} · alt+↵ nouvelle ligne`,
    history: (k: number, n: number) => `historique ${k}/${n} · ↓ ton brouillon`
  },
  images: {
    capture: 'capture', size: (n: number) => formatBytes(n, 'fr'), open: (key: string) => `${key} ouvrir dans la visionneuse`,
    tooLarge: 'Image trop lourde, même réduite', notImage: "Ce fichier n'est pas une image", failed: 'Image non envoyée',
    max: '5 images au plus par message', dialog: "Répondez d'abord à la question, l'image partira après", none: "Pas d'image dans le presse-papiers",
    openFailed: (why: string) => `Image non ouverte : ${why}`
  },
  toast: {
    answerFailed: (why: string) => `Réponse non envoyée : ${why}`,
    handover: (n: string) => `${n} écrit son bilan : une nouvelle session prendra sa place`, handoverRefused: (why: string) => `Relève refusée : ${why}`,
    accept: (n: string) => `✓ ${n} : autorisé`, deny: (n: string) => `✓ ${n} : refusé`, always: (n: string) => `✓ ${n} : toujours autorisé`,
    option: (n: string, k: number) => `✓ ${n} : option ${k} envoyée`, reply: (n: string) => `✓ Réponse envoyée à ${n}`,
    interrupted: (n: string) => `${n} : interruption demandée`, model: (n: string, m: string) => `${n} : modèle ${m}`,
    notNow: (n: string) => `Rien à répondre pour ${n}.`, offline: (n: string) => `${n} est hors ligne.`, readOnly: (n: string) => `${n} est en lecture seule : répondez dans son terminal.`,
    busy: (n: string) => `Un envoi pour ${n} est déjà en cours.`, noAlways: (n: string) => `${n} ne propose pas « toujours » ici.`,
    noteTooLong: (max: number) => `Note trop longue : ${max} caractères au plus. Elle reste dans le champ.`,
    noNote: (n: string) => `${n} ne prend pas de note ici.`,
    noTerminalOmp: (n: string) => `${n} est piloté par Ledge via le protocole d’OMP : pas de terminal à attacher.`,
    noTerminal: (n: string) => `Pas de terminal pour ${n}.`, attachFailed: (code: number) => `tmux s’est arrêté avec le code ${code}.`,
    modelSwitch: 'Ce daemon ne change pas le modèle d’une session en cours.',
    joined: (n: string, team: string) => `${n} rejoint ${team}.`, notResting: (team: string) => `${team} n’est pas au repos.`, resumed: (team: string) => `Reprise de l’équipe ${team} demandée.`, saved: (path: string) => `Équipe enregistrée : ${path}`,
    draftKept: 'Brouillon gardé : r pour reprendre.', draftQuit: 'Brouillon en cours : ctrl+c encore pour quitter quand même (il sera perdu).',
    exited: (cmd: string, code: number) => `${cmd} s’est arrêté avec le code ${code}.`
  },
  decisions: {
    failed: (name: string, message: string) => `Décision non transmise à ${name} : ${message}`,
    unconfirmed: (name: string) => `Ledge n’a pas vu la décision pour ${name} aboutir. Ouvrez la session pour vérifier.`,
    replyFailed: (name: string, message: string) => `Réponse non transmise à ${name} : ${message}`,
    replyUnconfirmed: (name: string) => `Ledge n’a pas vu la réponse à ${name} aboutir. Vérifiez le fil.`,
    noteNotTyped: 'Refusé, mais la note n’a pas pu être tapée.'
  },
  notify: {
    approval: (n: string, text: string) => `${n} attend ton accord : ${text}`,
    question: (n: string, text: string) => `${n} a une question : ${text}`,
    title: (n: number) => (n > 0 ? `ledge · ${n} t’${plural(n, 'attend', 'attendent')}` : 'ledge')
  },
  small: {
    tooSmall: (w: number, h: number) => `Fenêtre trop petite : ${w}×${h}`, atLeast: (w: number, h: number) => `il faut au moins ${w}×${h}`,
    waits: (name: string, question: boolean) => (question ? `${name} a une question` : `${name} attend ton accord`), kept: 'brouillon gardé'
  },
  cli: { notTty: 'ledge tui: needs a terminal (stdin and stdout must be a TTY)', movedToTab: 'ledge tui s’ouvre dans l’onglet Ledge.', loadingProfile: 'Windows Terminal charge le profil Ledge…' }
};
