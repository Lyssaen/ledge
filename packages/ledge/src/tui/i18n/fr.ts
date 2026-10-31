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
    image: 'image', openImage: "ouvrir l'image",
    navigate: 'naviguer', open: 'ouvrir', answer: 'répondre', attach: 'attacher (tmux)', ask: 'demander à Ledge', launch: 'nouvelle session',
    settings: 'réglages', help: 'aide', quit: 'quitter', back: 'retour', write: 'écrire', diffs: 'diffs', terminal: 'terminal', model: 'modèle',
    interrupt: 'interrompre', next: 'suivante en attente', unfold: 'déplier', send: 'envoyer / lancer', nextCard: 'carte suivante',
    newChat: 'nouvelle conversation', stopAnswer: 'arrêter la réponse', nextField: 'champ suivant', choose: 'choisir', tick: 'cocher',
    start: 'lancer', cancel: 'annuler', change: 'changer', scroll: 'défiler', space: 'espace', redraw: 'autre nom',
    handover: 'passer le relais',
    sendOnly: 'envoyer', newLine: 'nouvelle ligne', keepAndLeave: 'garder et sortir', lineHistory: 'ligne · historique', history: 'historique',
    word: 'mot', clear: 'effacer', resend: 'renvoyer', backToDraft: 'revenir au brouillon', keep: 'garder', wipe: 'effacer',
    line: 'ligne', page: 'page', end: 'fin', question: 'question', conversation: 'conversation', cycle: 'cartes · conversation',
    applyRow: 'appliquer la ligne', apply: 'appliquer', applyAll: 'tout appliquer', deny: 'refuser', ignore: 'ignorer', review: 'revoir',
    openSession: (name: string) => `ouvrir ${name}`
  },
  overview: {
    yours: (n: number) => `À toi · ${n}`, projects: 'Projets', exchanges: 'Échanges', terminal: (name: string) => `Terminal · ${name}`, inColor: '· en couleurs',
    nobodyWaits: 'Personne ne t’attend.', noSession: 'Aucune session. + pour en lancer une.', noPreview: 'Pas d’aperçu.', noExchange: 'Aucun échange.',
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'Hors projet', offline: 'hors ligne', readOnly: 'lecture seule',
    wantsToRun: 'Veut exécuter :', asks: 'Demande :', plan: 'Propose un plan :', diff: 'Veut modifier :',
    allow: 'Autoriser', deny: 'Refuser', always: 'Toujours', denyWithNote: 'Refuser en expliquant',
    askLine: (name: string, question: string) => `? ${name} : ${question}`, askHint: (id: string) => `ledge decide ${id} "<réponse>"`,
    near: (name: string, pct: number) => `${name} · ctx ${pct} % · H relève`,
    reliefFailed: (name: string, why: string) => `La relève de ${name} a échoué : ${why}`,
    context: (pct: number) => `ctx ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`,
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
    placeholder: 'Une question pour Ledge…',
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
  },
  settings: { title: 'Réglages', language: 'Langue', theme: 'Thème', themes: { auto: 'Auto', dark: 'Sombre', light: 'Clair' }, themeAuto: (tone: 'dark' | 'light') => `Auto (fond ${tone === 'light' ? 'clair' : 'sombre'})`, context: 'Contexte max', contextHint: 'au-delà : passer le relais', contextUnknown: 'mettez à jour le daemon', contextSaved: (pct: number) => `Contexte max : ${pct} %`, saved: 'Réglage enregistré.', saveFailed: (m: string) => `Réglage appliqué, mais non enregistré : ${m}` },
  help: {
    title: 'Aide', global: 'Partout', overview: 'Vue d’ensemble', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages',
    screens: 'changer d’écran', field: 'Saisie', wordBefore: 'effacer le mot avant',
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
