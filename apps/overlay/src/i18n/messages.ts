import type { SoundCategory } from '../sounds/preferences';
import type { BotState } from '../bots/poseFor';

/**
 * Every user-visible string of the overlay, aria-labels and tooltips included, in French (the default) and English.
 * `en` is typed as `Messages` (the shape of `fr`): a key missing or extra on either side is a type error. Plurals are
 * explicit (`plural`), never guessed by appending an "s".
 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const fr = {
  lang: { label: 'Langue', hint: 'La langue de Ledge.', fr: 'Français', en: 'English' },
  /** The Windows tray icon's menu (its first line, the product and version, is not translated). */
  tray: { open: 'Ouvrir Ledge', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', quit: 'Quitter Ledge' },
  time: { seconds: (n: number) => `${n} s`, minutes: (n: number) => `${n} min`, hours: (n: number) => `${n} h`, locale: 'fr-FR' },
  state: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  /** The bot's accessible state, read after the tool name. */
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue', tip: (n: number) => n === 0 ? 'Aucune session · cliquer pour ouvrir' : `${n} session${n > 1 ? 's' : ''} · cliquer pour ouvrir` },
  botNotLive: 'Figé',
  /** The handle's bot buttons: "<Name> <label>, open". */
  handleLabel: { starting: 'démarre', idle: 'disponible', approval: 'attend votre accord', question: 'a une question', working: 'au travail', done: 'terminée', error: 'en erreur', readonly: 'en lecture seule' } as Record<BotState, string>,
  open: 'ouvrir',
  clickToOpen: 'cliquer pour ouvrir',
  hint: { startedWithoutLedge: 'lancée sans Ledge', exited: (code: string) => `terminée (code ${code})`, error: 'erreur', available: 'disponible', running: 'au travail', helpersRunning: (n: number) => `disponible · ${n} sous-agent${n > 1 ? 's' : ''} au travail` },
  offline: 'Hors connexion : reconnexion au daemon',
  readOnlyBlocked: 'Lecture seule : lancée sans Ledge, répondez dans son terminal',
  unreachable: 'daemon injoignable, nouvelle tentative',
  lost: 'La connexion a été perdue avant la réponse du terminal',
  notTaken: 'Le terminal ne l’a pas pris en compte',
  list: {
    summary: (n: number, waiting: number) => n === 0 ? 'Aucune session' : `${n} ${plural(n, 'session', 'sessions')} · ${waiting ? `${waiting} ${plural(waiting, 'demande', 'demandes')} pour vous` : 'tout est à jour'}`,
    dnd: 'Ne pas déranger', settings: 'Réglages', collapse: 'Replier', help: 'Raccourcis clavier', newSession: 'Nouvelle session',
    row: (project: string, name: string) => `${project}, ${name}, ouvrir`,
    noTopic: 'Sans sujet encore', groupCount: (n: number) => `${n} ${plural(n, 'bot', 'bots')}`, rowTitle: (tool: string, cwd: string) => `${tool} · ${cwd}`,
    approve: 'Autoriser', deny: 'Refuser', openRow: 'Ouvrir',
    dismiss: 'Retirer de la liste', dismissRow: (project: string, name: string) => `Retirer de la liste : ${project}, ${name}`,
    emptyTitle: 'Personne au travail.',
    emptyHint: 'Démarrez un compagnon d’ici, ou avec', emptyHintAfter: 'dans un terminal : il apparaîtra dans cette liste.',
    launched: (name: string, project: string) => `${name} démarre dans ${project}.`, openTerminal: 'Ouvrir le terminal'
  },
  launch: {
    title: 'Nouvelle session',
    folder: 'Dossier', folderHint: 'Le projet dans lequel le compagnon travaille.', folderPlaceholder: '~/Workspace/mon-projet',
    recents: 'Récents', busy: (name: string) => `${name} y travaille`, noRecents: 'Les dossiers de vos sessions apparaîtront ici.',
    pick: (project: string, cwd: string) => `Choisir ${project} (${cwd})`,
    tool: 'Outil', toolHint: 'Chacun est suivi par ses hooks ; ses demandes se règlent depuis Ledge.',
    bot: 'Compagnon', botHint: (title: string) => `Son nom donne le titre de l’onglet : ${title}.`, anotherName: 'Un autre nom', botPlaceholder: 'Au choix de Ledge',
    prompt: 'Première instruction', optional: 'facultatif',
    promptHint: (name: string) => `Envoyée dès que ${name} est prêt. Sinon il attend votre tour dans son terminal.`,
    promptPlaceholder: (name: string) => `Que doit faire ${name} en premier ?`,
    resume: 'Reprendre la dernière conversation', resumeHint: 'Démarre avec --continue dans ce dossier.',
    openTab: 'Ouvrir l’onglet du terminal', openTabHint: 'Sinon le compagnon tourne en arrière-plan, l’onglet reste à un clic depuis sa fiche.',
    cancel: 'Annuler', start: 'Démarrer', starting: 'Démarrage…',
    failed: (why: string) => `Impossible de démarrer : ${why}`,
    needFolder: 'Indiquez un dossier pour démarrer.',
    browse: 'Parcourir les dossiers'
  },
  browse: {
    title: 'Choisir un dossier', back: 'Retour au formulaire', path: 'Chemin du dossier', up: 'Dossier parent', open: (name: string) => `Ouvrir ${name}`,
    empty: 'Aucun sous-dossier.', loading: 'Chargement…',
    newFolder: 'Nouveau dossier', newFolderName: 'Nom du nouveau dossier', create: 'Créer', choose: 'Choisir ce dossier',
    failed: (why: string) => `Impossible : ${why}`
  },
  detail: { back: 'Retour aux sessions', close: 'Fermer' },
  session: {
    rename: 'Renommer la session', topicPlaceholder: 'Le sujet de cette session',
    reading: 'Mode lecture', focusTerminal: 'Voir l’onglet du terminal', close: 'Fermer',
    eyebrow: { ask: 'À vous de jouer', working: 'En cours', error: 'À examiner', session: 'Session' },
    title: {
      permission: (name: string) => `${name} souhaite lancer une commande.`,
      diff: (name: string) => `${name} propose des modifications.`,
      plan: (name: string) => `${name} propose un plan.`,
      readonly: 'Visible, en lecture seule.',
      starting: 'La session se prépare.', working: 'Concentré sur sa tâche.', idle: 'En attente de vos instructions.',
      error: 'La session a rencontré un problème.', exited: 'Cette session est terminée.'
    },
    helpers: 'Sous-agents',
    readonlyLead: (name: string) => `${name} a été lancé sans le lanceur Ledge.`,
    readonlyNote: 'Son état reste visible. Pour répondre à cette session, retrouvez son terminal d’origine.',
    readonlyNext: 'Pour une prochaine session interactive :',
    runIn: (project: string) => `Exécution dans ${project}`,
    reviewIn: (project: string) => `À relire dans ${project}`,
    reviewHint: 'Relisez-le dans l’aperçu du terminal ci-dessous.',
    always: 'Toujours pour cette session',
    alwaysWhy: 'Aucun outil ne confirme encore une autorisation durable : chaque demande se décide une à une.',
    scope: 'La décision concerne cette commande uniquement : « Toujours » n’est pas encore pris en charge.',
    allow: 'Autoriser', deny: 'Refuser',
    options: 'Options',
    other: 'Autre', otherAnswer: 'Autre réponse', otherPlaceholder: 'Ou proposez autre chose…',
    otherWhy: 'Réponse libre pas encore prise en charge : répondez dans le terminal',
    send: 'Envoyer la réponse →',
    failed: (why: string) => `${why}. Réessayez ou ouvrez l’onglet.`,
    terminal: 'Aperçu du terminal', terminalNote: '30 dernières lignes · lecture seule',
    replyLabel: (name: string) => `Répondre à ${name}`,
    replyPlaceholder: (_name: string) => 'Une instruction pour votre compagnon…',
    sendReply: 'Envoyer',
    hintPrompt: (kind: string) => `${kind === 'permission' ? 'Autorisez ou refusez la commande' : kind === 'diff' ? 'Acceptez ou refusez les modifications' : 'Acceptez ou refusez le plan'} avant de répondre`,
    hintQuestion: 'Une question se répond par une option ; le reste, dans son terminal',
    hintFree: 'Entrée envoie le texte au terminal tel quel',
    interrupt: 'Interrompre', kill: 'Arrêter la session'
  },
  /** The agent's last message, read like a plan (the "your turn" view). */
  reply: {
    finished: (name: string, when: string) => `${name} a terminé il y a ${when}`,
    doneCount: (n: number) => `${n} ${plural(n, 'point fait', 'points faits')}`,
    questionCount: (n: number) => `${n} ${plural(n, 'question', 'questions')}`,
    question: 'Question',
    typeAnswer: 'Répondre librement',
    showRaw: 'Réponse complète, telle quelle', showStructured: 'Vue structurée',
    hintChips: 'Une puce remplit le champ, Entrée envoie',
    hintAnswerAll: 'Une ligne par question, Entrée envoie'
  },
  bubble: {
    question: (name: string) => `${name} a une question`,
    review: (name: string, kind: string) => `${name} propose ${kind === 'diff' ? 'des modifications' : 'un plan'} à relire`,
    approval: (name: string) => `${name} attend votre accord`,
    more: (n: number) => `+${n} ${plural(n, 'autre', 'autres')}`,
    failed: (why: string) => `${why}. Réessayez ou ouvrez la session.`,
    lostDefault: 'La décision n’a pas été transmise',
    finished: (name: string) => `${name} a terminé`,
    finishedSub: (duration: string, project: string) => `${duration} de travail · ${project}`,
    finishedSubNoTime: (project: string) => project,
    ok: 'OK',
    openSession: 'Ouvrir',
    pending: 'Envoyé, en attente du terminal', confirmed: 'Reçu',
    later: 'Plus tard', reviewAction: 'Relire', deny: 'Refuser', approve: 'Autoriser',
    answer: (opt: string) => `Répondre : ${opt}`, firstOption: 'première option'
  },
  settings: {
    title: 'Votre Ledge', tabs: 'Sections des réglages', tabDisplay: 'Affichage', tabNotifications: 'Notifications', tabSounds: 'Sons', handleSize: 'Taille de la poignée', handleSizeHint: 'La poignée et ses compagnons au bord de l’écran.', windowSize: 'Taille des fenêtres', windowSizeHint: 'Bulle, liste, session, réglages et aide.', auto: (p: string) => `Auto (${p})`,
    screen: 'Écran', screenHint: (w: number, h: number) => `La poignée se pose au bord gauche de cet écran (${w}\u00a0×\u00a0${h}).`, screenHintNone: 'La poignée se pose au bord gauche de l’écran principal.',
    screenPrimary: 'Principal', screenNth: (n: number) => `Écran ${n}`, screenMissing: 'Débranché',
    autostart: 'Lancer au démarrage', autostartHint: 'Ledge s’ouvre avec votre session Windows.',
    dnd: 'Ne pas déranger', dndHint: 'Les demandes restent dans la poignée.',
    reduced: 'Mouvements réduits', reducedHint: 'Les états restent lisibles sans animation.',
    osReduced: 'Votre système demande des mouvements réduits ; Ledge continue de le respecter.',
    finished: 'Quand un bot a terminé', finishedHint: 'Une bulle de 6 s, un son, les deux, ou seulement la poignée.',
    finishedBoth: 'Bulle et son', finishedBubble: 'Bulle', finishedSound: 'Son', finishedNone: 'Poignée seule',
    sounds: 'Sons', soundsHint: 'Des tons courts et doux pour ce qui vous attend. Jamais en Ne pas déranger.',
    volume: 'Volume', volumeHint: 'Test joue le signal de question.', volumeQuiet: 'Bas', volumeNormal: 'Normal', volumeLoud: 'Fort', test: 'Test',
    playWhen: 'Jouer un son quand',
    category: { requests: 'Un bot a besoin de vous · accord, question', finished: 'Un bot a terminé sa tâche', errors: 'Quelque chose échoue', decisions: 'Vous acceptez ou refusez', team: 'Un bot arrive ou part' } as Record<SoundCategory, string>,
    behind: 'Seulement quand le terminal est derrière', behindHint: 'Si Windows Terminal est la fenêtre au premier plan, vous regardez déjà : pas de son, la bulle s’affiche quand même.',
    soundsNote: 'Un seul son à la fois : une rafale de demandes ne joue qu’une fois, la poignée montre le reste. Ouvrir, fermer et survoler sont silencieux.',
    themeLight: 'Thème clair · Galet', themeDark: 'Thème sombre · Signal', themeHint: 'Changer le thème et la matière des mascottes'
  },
  help: {
    title: 'Au bout des doigts.',
    keys: [['Ouvrir la liste', ['Ctrl Alt L']], ['Choisir une session', ['J', 'K', '1–9']], ['Ouvrir la sélection', ['Entrée']], ['Autoriser / refuser', ['Y', 'N']],
      ['Demande suivante', ['Alt →']], ['Répondre', ['R']], ['Ouvrir l’onglet du terminal', ['O']], ['Ne pas déranger', ['D']], ['Retour, puis replier', ['Échap']]] as Array<[string, string[]]>,
    tab: 'Tab conserve la navigation entre les contrôles.'
  },
  coach: {
    label: 'Clavier', title: 'Naviguer au clavier', ok: 'Compris',
    upDown: 'monter et descendre', nextAsk: 'demande suivante', jump: 'aller à', decide: 'décider', close: 'fermer', esc: 'Échap',
    note: 'Affiché aux trois premières ouvertures au clavier'
  },
  shortcut: 'Ctrl Alt L'
};

export type Messages = typeof fr;

const en: Messages = {
  lang: { label: 'Language', hint: 'The language of Ledge.', fr: 'Français', en: 'English' },
  tray: { open: 'Open Ledge', newSession: 'New session', dnd: 'Do not disturb', quit: 'Quit Ledge' },
  time: { seconds: (n: number) => `${n}s`, minutes: (n: number) => `${n}m`, hours: (n: number) => `${n}h`, locale: 'en-US' },
  state: { approval: 'Approval', question: 'Question', starting: 'Starting', idle: 'Available', working: 'Running', done: 'Done', error: 'Error', readonly: 'Read only' },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost', tip: (n: number) => n === 0 ? 'No sessions · click to open' : `${n} session${n > 1 ? 's' : ''} · click to open` },
  botNotLive: 'Not live',
  handleLabel: { starting: 'starting', idle: 'available', approval: 'needs your approval', question: 'has a question', working: 'working', done: 'done', error: 'error', readonly: 'read only' },
  open: 'open',
  clickToOpen: 'click to open',
  hint: { startedWithoutLedge: 'started without ledge', exited: (code: string) => `exited ${code}`, error: 'error', available: 'available', running: 'running', helpersRunning: (n: number) => `available · ${n} subagent${n > 1 ? 's' : ''} working` },
  offline: 'Offline: reconnecting to the daemon',
  readOnlyBlocked: 'Read only: started without Ledge, answer in its terminal',
  unreachable: 'daemon unreachable, retrying',
  lost: 'The connection dropped before the terminal answered',
  notTaken: 'The terminal did not take it',
  list: {
    summary: (n: number, waiting: number) => n === 0 ? 'No sessions' : `${n} ${plural(n, 'session', 'sessions')} · ${waiting ? `${waiting} waiting for you` : 'nothing waiting'}`,
    dnd: 'Do not disturb', settings: 'Settings', collapse: 'Collapse', help: 'Keyboard shortcuts', newSession: 'New session',
    row: (project: string, name: string) => `${project}, ${name}, open`,
    noTopic: 'No topic yet', groupCount: (n: number) => `${n} ${plural(n, 'bot', 'bots')}`, rowTitle: (tool: string, cwd: string) => `${tool} · ${cwd}`,
    approve: 'Approve', deny: 'Deny', openRow: 'Open',
    dismiss: 'Remove from list', dismissRow: (project: string, name: string) => `Remove from list: ${project}, ${name}`,
    emptyTitle: 'Nobody at work.',
    emptyHint: 'Start a companion from here, or with', emptyHintAfter: 'in a terminal: it will show up in this list.',
    launched: (name: string, project: string) => `${name} is starting in ${project}.`, openTerminal: 'Open the terminal'
  },
  launch: {
    title: 'New session',
    folder: 'Folder', folderHint: 'The project the companion works in.', folderPlaceholder: '~/Workspace/my-project',
    recents: 'Recent', busy: (name: string) => `${name} works there`, noRecents: 'The folders of your sessions will show up here.',
    pick: (project: string, cwd: string) => `Choose ${project} (${cwd})`,
    tool: 'Tool', toolHint: 'Each is tracked through its hooks; its asks are answered from Ledge.',
    bot: 'Companion', botHint: (title: string) => `Its name titles the terminal tab: ${title}.`, anotherName: 'Another name', botPlaceholder: 'Ledge picks one',
    prompt: 'First instruction', optional: 'optional',
    promptHint: (name: string) => `Sent as soon as ${name} is ready. Otherwise it waits for your turn in its terminal.`,
    promptPlaceholder: (name: string) => `What should ${name} do first?`,
    resume: 'Resume the last conversation', resumeHint: 'Starts with --continue in this folder.',
    openTab: 'Open the terminal tab', openTabHint: 'Otherwise the companion runs in the background; the tab is one click away from its card.',
    cancel: 'Cancel', start: 'Start', starting: 'Starting…',
    failed: (why: string) => `Could not start: ${why}`,
    needFolder: 'Give a folder to start in.',
    browse: 'Browse folders'
  },
  browse: {
    title: 'Choose a folder', back: 'Back to the form', path: 'Folder path', up: 'Parent folder', open: (name: string) => `Open ${name}`,
    empty: 'No subfolders.', loading: 'Loading…',
    newFolder: 'New folder', newFolderName: 'New folder name', create: 'Create', choose: 'Choose this folder',
    failed: (why: string) => `Could not: ${why}`
  },
  detail: { back: 'Back to sessions', close: 'Close' },
  session: {
    rename: 'Rename the session', topicPlaceholder: 'What this session is about',
    reading: 'Reading mode', focusTerminal: 'Focus terminal tab', close: 'Close',
    eyebrow: { ask: 'Your turn', working: 'In progress', error: 'To check', session: 'Session' },
    title: {
      permission: (name: string) => `${name} wants to run a command.`,
      diff: (name: string) => `${name} proposes changes.`,
      plan: (name: string) => `${name} proposes a plan.`,
      readonly: 'Visible, read only.',
      starting: 'The session is starting.', working: 'Focused on its task.', idle: 'Waiting for your instructions.',
      error: 'The session ran into a problem.', exited: 'This session has ended.'
    },
    helpers: 'Subagents',
    readonlyLead: (name: string) => `${name} was started without the Ledge launcher.`,
    readonlyNote: 'Its state stays visible. To answer this session, go back to its own terminal.',
    readonlyNext: 'For your next interactive session:',
    runIn: (project: string) => `Run in ${project}`,
    reviewIn: (project: string) => `To review in ${project}`,
    reviewHint: 'Review it in the terminal preview below.',
    always: 'Always for this session',
    alwaysWhy: 'No tool confirms a lasting authorization yet: each request is decided on its own.',
    scope: 'The decision covers this command only: “Always” is not supported yet.',
    allow: 'Approve', deny: 'Deny',
    options: 'Options',
    other: 'Other', otherAnswer: 'Other answer', otherPlaceholder: 'Other…',
    otherWhy: 'answer in the terminal',
    send: 'Answer',
    failed: (why: string) => `${why}, try again or open the tab`,
    terminal: 'Terminal preview', terminalNote: 'last 30 lines · read only',
    replyLabel: (name: string) => `Reply to ${name}`,
    replyPlaceholder: (name: string) => `Reply to ${name}…`,
    sendReply: 'Send',
    hintPrompt: (kind: string) => `Approve or deny the ${kind} first, then reply`,
    hintQuestion: 'A question takes an option number; answer anything else in its terminal',
    hintFree: 'Enter sends to the terminal as typed',
    interrupt: 'Interrupt', kill: 'Kill session'
  },
  reply: {
    finished: (name: string, when: string) => `${name} finished ${when} ago`,
    doneCount: (n: number) => `${n} done`,
    questionCount: (n: number) => `${n} ${plural(n, 'question', 'questions')}`,
    question: 'Question',
    typeAnswer: 'Type an answer',
    showRaw: 'Full reply as written', showStructured: 'Structured view',
    hintChips: 'A chip fills the field, Enter sends',
    hintAnswerAll: 'One line per question, Enter sends'
  },
  bubble: {
    question: (name: string) => `${name} has a question`,
    review: (name: string, kind: string) => `${name} has a ${kind} to review`,
    approval: (name: string) => `${name} needs your approval`,
    more: (n: number) => `+${n} more`,
    failed: (why: string) => `${why}. Try again or open the session.`,
    lostDefault: 'The decision was not delivered',
    finished: (name: string) => `${name} finished`,
    finishedSub: (duration: string, project: string) => `${duration} of work · ${project}`,
    finishedSubNoTime: (project: string) => project,
    ok: 'OK',
    openSession: 'Open',
    pending: 'Sent, waiting for the terminal', confirmed: 'Received',
    later: 'Later', reviewAction: 'Review', deny: 'Deny', approve: 'Approve',
    answer: (opt: string) => `Answer: ${opt}`, firstOption: 'first option'
  },
  settings: {
    title: 'Your Ledge', tabs: 'Settings sections', tabDisplay: 'Display', tabNotifications: 'Notifications', tabSounds: 'Sounds', handleSize: 'Handle size', handleSizeHint: 'The handle and its companions on the screen edge.', windowSize: 'Window size', windowSizeHint: 'Bubble, list, session, settings and help.', auto: (p: string) => `Auto (${p})`,
    screen: 'Screen', screenHint: (w: number, h: number) => `The handle sits on the left edge of this screen (${w}\u00a0×\u00a0${h}).`, screenHintNone: 'The handle sits on the left edge of the primary screen.',
    screenPrimary: 'Primary', screenNth: (n: number) => `Screen ${n}`, screenMissing: 'Unplugged',
    autostart: 'Launch at startup', autostartHint: 'Ledge opens when you sign in to Windows.',
    dnd: 'Do not disturb', dndHint: 'New asks stay in the handle.',
    reduced: 'Reduced motion', reducedHint: 'States stay readable without animation.',
    osReduced: 'Your system asks for reduced motion; Ledge keeps respecting it.',
    finished: 'When a bot finishes', finishedHint: 'A 6 s bubble, a sound, both, or the handle only.',
    finishedBoth: 'Bubble and sound', finishedBubble: 'Bubble', finishedSound: 'Sound', finishedNone: 'Handle only',
    sounds: 'Sounds', soundsHint: 'Short, soft tones for what needs you. Never while Do not disturb is on.',
    volume: 'Volume', volumeHint: 'Test plays the question cue.', volumeQuiet: 'Quiet', volumeNormal: 'Normal', volumeLoud: 'Loud', test: 'Test',
    playWhen: 'Play a sound when',
    category: { requests: 'A bot needs you · approval, question', finished: 'A bot finishes its task', errors: 'Something fails', decisions: 'You approve or deny', team: 'A bot joins or leaves' } as Record<SoundCategory, string>,
    behind: 'Only when the terminal is behind', behindHint: 'When Windows Terminal is the front window you are already looking: no sound, the bubble still shows.',
    soundsNote: 'One sound at a time: a burst of asks plays once, the handle shows the rest. Opening, closing and hovering are silent.',
    themeLight: 'Light theme · Pebble', themeDark: 'Dark theme · Signal', themeHint: 'Switch the theme and the mascot material'
  },
  help: {
    title: 'Keyboard',
    keys: [['Open the list', ['Ctrl Alt L']], ['Choose a session', ['J', 'K', '1–9']], ['Open the selection', ['Enter']], ['Approve or deny', ['Y', 'N']],
      ['Next ask', ['Alt →']], ['Reply', ['R']], ['Open the terminal tab', ['O']], ['Do not disturb', ['D']], ['Back, then collapse', ['Esc']]],
    tab: 'Tab keeps moving between the controls.'
  },
  coach: {
    label: 'Keyboard', title: 'Move with the keyboard', ok: 'Got it',
    upDown: 'up and down', nextAsk: 'next ask', jump: 'jump', decide: 'decide', close: 'close', esc: 'Esc',
    note: 'Shown on the first three keyboard opens'
  },
  shortcut: 'Ctrl Alt L'
};

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
