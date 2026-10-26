import type { BotState } from '@ledge/ui/bots/poseFor';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** `ledge tui`'s copy in French, the source of truth: `en.ts` is typed against it. */
export const fr = {
  lang: { fr: 'Français', en: 'English' },
  state: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  time: {
    now: 'à l’instant', s: (n: number) => `${n} s`, min: (n: number) => `${n} min`, h: (n: number) => `${n} h`, d: (n: number) => `${n} j`
  },
  tabs: { overview: 'Vue d’ensemble', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages' },
  bar: {
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
    machines: (n: number) => `${n} ${plural(n, 'machine', 'machines')}`,
    waiting: (n: number) => `${n} t’${plural(n, 'attend', 'attendent')}`,
    connecting: 'connexion au daemon…',
    unreachable: 'daemon injoignable, nouvel essai…',
    tokenMissing: 'pas de jeton : lancez une session avec `ledge claude` ou `ledge daemon`'
  },
  keys: {
    navigate: 'naviguer', open: 'ouvrir', answer: 'répondre', attach: 'attacher (tmux)', ask: 'demander à Ledge', launch: 'nouvelle session',
    settings: 'réglages', help: 'aide', quit: 'quitter', back: 'retour', write: 'écrire', diffs: 'diffs', terminal: 'terminal', model: 'modèle',
    interrupt: 'interrompre', next: 'suivante en attente', unfold: 'déplier', send: 'envoyer / lancer', nextCard: 'carte suivante',
    newChat: 'nouvelle conversation', stopAnswer: 'arrêter la réponse', nextField: 'champ suivant', choose: 'choisir', tick: 'cocher',
    start: 'lancer', cancel: 'annuler', change: 'changer', scroll: 'défiler', space: 'espace', redraw: 'autre nom',
    save: 'enregistrer l’équipe', tasks: 'tâches de l’équipe', join: 'rejoindre une équipe', resume: 'reprendre l’équipe', teamMode: 'session ou équipe', handover: 'passer le relais'
  },
  overview: {
    yours: (n: number) => `À toi · ${n}`, projects: 'Projets', exchanges: 'Échanges', terminal: (name: string) => `Terminal · ${name}`,
    nobodyWaits: 'Personne ne t’attend.', noSession: 'Aucune session. + pour en lancer une.', noPreview: 'Pas d’aperçu.', noExchange: 'Aucun échange.',
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'Hors projet', offline: 'hors ligne', readOnly: 'lecture seule',
    wantsToRun: 'Veut exécuter :', asks: 'Demande :', plan: 'Propose un plan :', diff: 'Veut modifier :',
    allow: 'Autoriser', deny: 'Refuser', always: 'Toujours', denyWithNote: 'Refuser en expliquant',
    common: 'table commune', teamLine: (done: number, given: number) => `équipe · ${done}/${given}`, resting: 'au repos · R pour reprendre',
    tasks: (team: string) => `Tâches · ${team}`, noTask: 'Aucune tâche.', ledge: 'Ledge',
    near: (name: string, pct: number) => `${name} · ctx ${pct} % · H relève`,
    reliefFailed: (name: string, why: string) => `La relève de ${name} a échoué : ${why}`,
    context: (pct: number) => `ctx ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`,
    ledgeTask: (owner: string, title: string, state: 'done' | 'refused' | 'dropped') => `${owner} a ${state === 'done' ? 'fini' : state === 'refused' ? 'refusé' : 'abandonné'} « ${title} » · tâche de Ledge`,
    joinWhich: (name: string) => `${name} rejoint quelle équipe ? (↑↓ ↵, esc)`, noTeamHere: 'Aucune équipe dans ce projet.', notInTeam: 'Cette session n’est dans aucune équipe.'
  },
  session: {
    you: 'Vous', unfold: 'déplier', fold: 'replier', actions: (n: number) => `${n} ${plural(n, 'action', 'actions')}`,
    files: (n: number) => `${n} ${plural(n, 'fichier modifié', 'fichiers modifiés')}`,
    since: (label: string, t: string) => `${label} · depuis ${t}`,
    wantsTo: (name: string) => `${name} veut exécuter :`, sentTo: 'envoyé à', receivedFrom: 'reçu de',
    sent: { sending: 'envoi…', delivered: 'remis', read: 'lu', failed: 'échec' } as Record<'sending' | 'delivered' | 'read' | 'failed', string>,
    helperWorking: (n: number) => `au travail · ${n} ${plural(n, 'action', 'actions')}`, helperDone: 'terminé',
    replyTo: (name: string) => `Répondre à ${name}…`, noteFor: (name: string) => `Expliquer le refus à ${name}…`,
    loading: 'Chargement du fil…', empty: 'Rien encore dans ce fil.', noSession: 'Choisissez une session dans la vue d’ensemble.',
    model: (m: string) => `modèle : ${m}`, defaultModel: 'par défaut', notice: 'Ledge'
  },
  ask: {
    title: (s: number, m: number) => `Ledge · voit ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    question: 'Question', read: 'lu', reading: 'Ledge lit…', you: 'vous', empty: 'Posez une question : qui a besoin de moi, où en est une session, que lancer…',
    launchCard: 'Nouvelle session', relayCard: (name: string) => `Relayer à ${name}`, closeCard: 'Fermer des sessions', launch: 'Lancer la session',
    relay: 'Envoyer', cancelRelay: 'Retirer de la file', close: 'Fermer', ignore: 'Ignorer', nothingWithoutYou: 'Ledge ne lance rien sans toi.',
    folder: 'Dossier', agent: 'Agent', instruction: 'Instruction', launched: 'lancée', queued: 'en file', sentAt: 'envoyée', closed: 'fermée',
    offline: 'Le daemon local est hors ligne : la question attendra.',
    steps: { sessions: 'les sessions', pane: (n: string) => `le terminal de ${n}`, reply: (n: string) => `la réponse de ${n}`, git: (n: string) => `l’état git de ${n}`, repo: (p: string) => p },
    operator: (s: number, m: number) => `Ledge · Opérateur · voit ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    teamCard: (name: string) => `Équipe · ${name}`, taskCard: 'Tâches à confier', launchTeam: 'Lancer l’équipe', save: 'Enregistrer', saved: 'enregistrée',
    seats: 'Sièges', table: 'Table', newTable: (project: string) => `nouvelle table dans la pièce ${project}`,
    autonomy: { ask: 'demande', edits: 'modifie sans demander', auto: 'autonome' } as Record<'ask' | 'edits' | 'auto', string>,
    autoWarning: (roles: string) => `${roles} travaillera sans demander.`, teamLaunched: (at: string) => `✓ Équipe lancée à ${at}`,
    give: 'Confier', waitTeam: 'active une fois l’équipe lancée',
    given: (owner: string, id: string, state: string) => `✓ Confiée à ${owner} · ${id} · ${state}`,
    taskState: { open: 'à prendre', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' } as Record<'open' | 'taken' | 'done' | 'refused' | 'dropped', string>
  },
  launch: {
    title: 'Nouvelle session', preview: 'Aperçu', instruction: 'Instruction', agent: 'Agent', model: 'Modèle', effort: 'Effort', project: 'Projet', machine: 'Machine',
    repos: 'Dépôts', folder: 'Dossier', name: 'Nom', none: 'aucun', defaultModel: 'par défaut', loading: 'chargement…', drawn: '(tiré au sort · ctrl+r pour un autre)',
    folderHint: 'chemin sur la machine (~ accepté)', joins: (name: string, table: string) => `${name} rejoindra ${table}`,
    launch: 'Lancer', cancel: 'Annuler', thenAttach: 'puis a pour s’attacher à son terminal',
    missing: { prompt: 'Écrivez une instruction.', machine: 'Aucune machine en ligne.', repos: 'Choisissez un dépôt ou un dossier.' } as Record<'prompt' | 'machine' | 'repos', string>,
    launching: 'Lancement…', launched: (name: string) => `✓ ${name} est lancée`,
    teamTitle: 'Nouvelle équipe', mode: 'Mode', session: 'session', team: 'équipe', template: 'Modèle', custom: 'sièges choisis un par un', seats: 'Sièges',
    teamName: 'Nom', noRole: 'aucun rôle : écris ~/.ledge/roles/<id>.md', loadingRoles: 'lecture des rôles…',
    teamPreview: (team: string, project: string) => `L’équipe ${team} s’installera à une nouvelle table de la pièce ${project}.`,
    teamLaunched: (name: string) => `✓ Équipe ${name} lancée`, teamFailed: (why: string) => `Équipe non lancée : ${why}`, noSeat: 'Choisissez au moins un siège.'
  },
  settings: { title: 'Réglages', language: 'Langue', context: 'Contexte max', contextHint: 'au-delà : passer le relais', contextUnknown: 'mettez à jour le daemon', contextSaved: (pct: number) => `Contexte max : ${pct} %`, saved: 'Réglage enregistré.', saveFailed: (m: string) => `Réglage appliqué, mais non enregistré : ${m}` },
  help: {
    title: 'Aide', global: 'Partout', overview: 'Vue d’ensemble', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages',
    screens: 'changer d’écran'
  },
  toast: {
    handover: (n: string) => `${n} écrit son bilan : une nouvelle session prendra sa place`, handoverRefused: (why: string) => `Relève refusée : ${why}`,
    accept: (n: string) => `✓ ${n} : autorisé`, deny: (n: string) => `✓ ${n} : refusé`, always: (n: string) => `✓ ${n} : toujours autorisé`,
    option: (n: string, k: number) => `✓ ${n} : option ${k} envoyée`, reply: (n: string) => `✓ Réponse envoyée à ${n}`,
    interrupted: (n: string) => `${n} : interruption demandée`, model: (n: string, m: string) => `${n} : modèle ${m}`,
    notNow: (n: string) => `Rien à répondre pour ${n}.`, offline: (n: string) => `${n} est hors ligne.`, readOnly: (n: string) => `${n} est en lecture seule : répondez dans son terminal.`,
    busy: (n: string) => `Un envoi pour ${n} est déjà en cours.`, noAlways: (n: string) => `${n} ne propose pas « toujours » ici.`,
    noNote: (n: string) => `${n} ne prend pas de note ici.`,
    noTerminalOmp: (n: string) => `${n} est piloté par Ledge via le protocole d’OMP : pas de terminal à attacher.`,
    noTerminal: (n: string) => `Pas de terminal pour ${n}.`, attachFailed: (code: number) => `tmux s’est arrêté avec le code ${code}.`,
    modelSwitch: 'Ce daemon ne change pas le modèle d’une session en cours.',
    joined: (n: string, team: string) => `${n} rejoint ${team}.`, resumed: (team: string) => `Reprise de l’équipe ${team} demandée.`, saved: (path: string) => `Équipe enregistrée : ${path}`
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
  cli: { notTty: 'ledge tui: needs a terminal (stdin and stdout must be a TTY)', movedToTab: 'ledge tui s’ouvre dans l’onglet Ledge.', loadingProfile: 'Windows Terminal charge le profil Ledge…' }
};
