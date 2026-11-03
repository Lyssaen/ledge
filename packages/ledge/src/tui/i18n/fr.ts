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
  tabs: { overview: 'Vue d’ensemble', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages', openrig: 'OpenRig' },
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
    handover: 'passer le relais', writeProject: 'écrire à tout le projet', decide: 'répondre à la décision', sendAnswer: 'envoyer la réponse', edit: 'modifier',
    sendOnly: 'envoyer', newLine: 'nouvelle ligne', keepAndLeave: 'garder et sortir', lineHistory: 'ligne · historique', history: 'historique',
    word: 'mot', clear: 'effacer', resend: 'renvoyer', backToDraft: 'revenir au brouillon', keep: 'garder', wipe: 'effacer',
    line: 'ligne', page: 'page', end: 'fin', question: 'question', conversation: 'conversation', cycle: 'cartes · conversation',
    applyRow: 'appliquer la ligne', apply: 'appliquer', applyAll: 'tout appliquer', deny: 'refuser', ignore: 'ignorer', review: 'revoir',
    openSession: (name: string) => `ouvrir ${name}`,
    /** An OpenRig element of the thread (docs/mockups/openrig-messages): its raw, and the reply to its sender. */
    raw: 'brut', replyTo: (name: string) => `répondre à ${name}`
  },
  overview: { rigsGroup: 'RIGS', kernelGroup: 'KERNEL', 
    rigSeat: (rig: string, role: string) => `rig ${rig} · ${role}`,
    yours: (n: number) => `À toi · ${n}`, projects: 'Projets', exchanges: 'Échanges', terminal: (name: string) => `Terminal · ${name}`,
    nobodyWaits: 'Personne ne t’attend.', noSession: 'Aucune session. + pour en lancer une.', noPreview: 'Pas d’aperçu.', noExchange: 'Aucun échange.',
    sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'Hors projet', offline: 'hors ligne', readOnly: 'lecture seule',
    wantsToRun: 'Veut exécuter :', asks: 'Demande :', plan: 'Propose un plan :', diff: 'Veut modifier :',
    allow: 'Autoriser', deny: 'Refuser', always: 'Toujours', denyWithNote: 'Refuser en expliquant',
    ledge: 'Ledge',
    near: (name: string, pct: number) => `${name} · ctx ${pct} % · H relève`,
    reliefFailed: (name: string, why: string) => `La relève de ${name} a échoué : ${why}`,
    context: (pct: number) => `ctx ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`,
    ledgeTask: (owner: string, title: string, state: 'done' | 'refused' | 'dropped') => `${owner} a ${state === 'done' ? 'fini' : state === 'refused' ? 'refusé' : 'abandonné'} « ${title} » · tâche de Ledge`,
    decision: (giver: string, title: string) => `${giver} te demande : ${title}`,
    writeProjectTitle: (project: string) => `Écrire à tout le projet ${project}`, writeProjectHint: 'Ton message, tel que chaque session le lira…',
    decisionTitle: (giver: string, title: string) => `Répondre à ${giver} · ${title}`, decisionHint: 'Ta réponse, telle que la session la lira…',
    confirmAnswer: (giver: string) => `Envoyer à ${giver} ? Une réponse ne se reprend pas`
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
    model: (m: string) => `modèle : ${m}`, defaultModel: 'par défaut', notice: 'Ledge',
    /** OpenRig's messages in a seat's thread (docs/mockups/openrig-messages, validated 2026-11-02). */
    rowIn: 'ligne confiée par', rowOut: 'ligne passée à', handedAt: (time: string) => `confiée ${time}`, passedAt: (time: string) => `passée ${time}`,
    notHanded: 'non transmise', notHandedBy: 'non transmise par OpenRig', openrigSaid: (line: string) => `OpenRig : ${line}`,
    /** A queue row's state, read live (`openrig.rowState`), and its short log. */
    rowState: { pending: 'en attente', taken: 'prise', passed: (n: string) => `passée à ${n}`, blocked: 'bloquée', done: 'terminée' },
    takenAt: (time: string) => `prise ${time}`, doneAt: (time: string) => `terminée ${time}`, notTaken: 'pas encore prise', waitingOn: (id: string) => `attend la ligne ${id}`,
    untracked: 'état non suivi', reply: 'répondre', raw: 'brut', close: 'fermer', times: (k: number) => `reçu ${k} fois`,
    unreadable: 'message OpenRig illisible, affiché tel quel', openrig: 'OpenRig',
    unblocked: (id: string) => `blocage levé : la ligne ${id} est de nouveau à faire`,
    stalled: (id: string, d: string) => `ligne ${id} prise il y a ${d}, sans suite`,
    folded: (k: number) => `${k} avis OpenRig repliés`, rawMany: (k: number) => `${k} messages collés ensemble · brut`,
    about: (line: string) => `À propos de : « ${line} »`
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
    taskCard: 'Tâches à confier',
    give: 'Confier',
    given: (owner: string, id: string, state: string) => `✓ Confiée à ${owner} · ${id} · ${state}`,
    taskState: { open: 'à prendre', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' } as Record<'open' | 'taken' | 'done' | 'refused' | 'dropped', string>,
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
    launching: 'Lancement…', launched: (name: string) => `✓ ${name} est lancée`
  },
  settings: { title: 'Réglages', language: 'Langue', theme: 'Thème', themes: { auto: 'Auto', dark: 'Sombre', light: 'Clair' }, themeAuto: (tone: 'dark' | 'light') => `Auto (fond ${tone === 'light' ? 'clair' : 'sombre'})`, context: 'Contexte max', contextHint: 'au-delà : passer le relais', contextUnknown: 'mettez à jour le daemon', contextSaved: (pct: number) => `Contexte max : ${pct} %`, saved: 'Réglage enregistré.', saveFailed: (m: string) => `Réglage appliqué, mais non enregistré : ${m}` },
  help: {
    title: 'Aide', global: 'Partout', overview: 'Vue d’ensemble', session: 'Session', ask: 'Demander à Ledge', launch: 'Nouvelle session', settings: 'Réglages', openrig: 'OpenRig', rigLaunch: 'Lancer un rig',
    screens: 'changer d’écran', field: 'Saisie', wordBefore: 'effacer le mot avant',
    writeHere: 'écrire à cette session', replySender: "répondre à l'expéditeur du message sélectionné", rigRaw: "afficher ou masquer le texte brut d'un message OpenRig",
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
    noProject: "cette session n'est dans aucun projet",
    broadcastSent: (names: string, refused: string) => `✓ Envoyé à ${names}${refused ? ` · ${refused}` : ''}`,
    broadcastNobody: (why: string) => `Non envoyé : ${why}`,
    broadcastSilent: "aucune machine n'a répondu : il est peut-être parti, vérifie avant de renvoyer",
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
  /** OpenRig › Rôles (docs/mockups/ledge-openrig-roles-tui.html), read-only. */
  roles: {
    title: 'Rôles', crumb: 'Rôles', rigs: 'Rigs', search: '/ rôle, skill, fichier…', mine: 'Mes specs', builtin: 'Livrés avec OpenRig',
    seats: (n: number) => plural(n, `${n} siège`, `${n} sièges`), imported: 'importée',
    same: '= dépôt · identique', differs: '≠ dépôt · différent', seen: 'vu', spec: 'selon la spec', from: 'depuis',
    tabs: ['Rôle', 'Paramètres', 'Contexte', 'YAML'] as readonly string[],
    here: 'ici', abs: 'non déclaré', unk: 'inconnu', legend: ['ici', 'hérité', 'non déclaré', 'inconnu'] as readonly string[],
    why: { resolved_at_launch: 'résolu au lancement', not_exposed: 'non exposé', unreadable: 'illisible', ambiguous: 'ambigu', not_found: 'introuvable', missing_from_guidance: 'absent de CLAUDE.md' } as Record<string, string>,
    from_: { import: 'import', defaults: 'defaults', profile: 'profil', rig: 'rig', pod: 'pod', member: 'membre', launch: 'lancement', openrig: 'OpenRig', plugin: 'plugin', seat: 'siège' } as Record<string, string>,
    delivered: (send: boolean, required: boolean | undefined) => [send ? 'tapé au démarrage' : 'bloc de CLAUDE.md', required === undefined ? '' : required ? 'requis' : 'facultatif'].filter(Boolean).join(' · '),
    more: (n: number) => `↓ ${n} ${plural(n, 'ligne', 'lignes')} plus bas`,
    sec: { exec: 'Exécution', uses: 'Ce que le profil utilise', start: 'Fichiers de démarrage', imports: 'Imports', seats: 'Sièges' },
    p: { runtime: 'Runtime', model: 'Modèle', effort: 'Effort', profile: 'Profil', cwd: 'Dossier', culture: 'Culture', imports: 'Import', skills: 'Skills', guidance: 'Guidance', subagents: 'Sous-agents', plugins: 'Plugins', rr: 'Ressources runtime', merged: 'Réglages fusionnés', files: 'Démarrage', actions: 'Actions', rr80: 'Fragments', merged80: 'Fusion réglages' },
    req: 'requis', empty: 'vide', runtimeDefault: 'défaut du runtime', noModel: 'non fixé par le rôle',
    skillsProjected: (n: number) => `${n} skills projetées`, pluginCarries: (s: number, h: number) => `${s} skills · ${h} hooks`, na: (rt: string) => `non installé (runtime ${rt})`,
    ctxIntro: 'Pas de prompt système unique : ce que le siège reçoit, dans l’ordre d’OpenRig.',
    ctxSpec: 'Selon la spec, seule la part du rôle est connue : f choisit un siège pour l’ensemble.',
    notShown: 'Pas montré : ce que le harnais charge seul (~/.claude, mémoire, hooks), les réglages fusionnés, les messages reçus ensuite.',
    harness: 'Prompt de base du harnais', harnessCh: 'harnais', opaque: 'Intégré au harnais : ni OpenRig ni Ledge ne le voient.',
    missing: (file: string, into: string) => `Prévue mais absente : ${file} n’est pas dans ${into}. Le plan n’est pas une preuve de livraison.`,
    pieces: { role: 'Rôle', cultureDefault: 'Culture OpenRig par défaut', culture: 'Culture du rig', scope: 'Périmètre', start: 'Démarrage OpenRig', onb1: 'Accueil OpenRig 1/2', onb2: 'Accueil OpenRig 2/2', skills: 'Skills du siège', identity: 'Identité du siège' } as Record<string, string>,
    channel: { send: 'terminal', merge: 'CLAUDE.md', action: 'terminal', other: '—' } as Record<string, string>,
    firstStart: '1er démarrage', importOnly: 'Spec importée, pas un rôle : pas de profil, aucun siège.', importedBy: 'Importée par',
    member: (seat: string) => `Membre ${seat}`, importedYaml: 'Importé',
    loading: 'Lecture des rôles…', loadingRole: 'Lecture du rôle…', reading: 'Lecture…',
    daemonStopped: (m: string) => `Le daemon OpenRig est arrêté sur ${m}.`, daemonStopped2: 'Les rôles viennent du daemon : D le démarre (vue Rigs).',
    outdated: 'Le Ledge de cette machine est trop ancien pour lire les rôles.', failed: (e: string) => `Rôles illisibles : ${e}`,
    fileMissing: 'fichier introuvable', noRole: 'Ce rôle ne déclare pas de consignes (aucun role.md).', noRole2: 'Ce que ses sièges reçoivent quand même : ← → Contexte.',
    multi: (n: number) => `${n} fichiers, dans l’ordre de livraison :`, invalid: (msg: string, line?: number) => (line ? `agent.yaml ne se lit pas (ligne ${line}) : ${msg}` : `agent.yaml ne se lit pas : ${msg}`),
    noResults: (q: string) => `Aucun rôle ne contient « ${q} »`, none: 'Aucun rôle sur cette machine.',
    seeRole: 'voir son rôle',
    k: { view: 'rigs/rôles', nav: 'naviguer', scroll: 'défiler', open: 'ouvrir', tab: 'onglet', from: 'vu depuis', raw: 'brut', search: 'chercher', list: 'liste', read: 'lire', unfold: 'déplier', role: 'rôle du siège', done: 'valider', clear: 'effacer' }
  },
  openrig: {
    operatorKey: 'opérateur', operatorHint: 'O : lui parler', operatorNotYet: 'Ledge ne suit pas encore la session de l’opérateur : réessayez dans quelques secondes.',
    activity: (a: string) => ({ running: 'au travail', idle: 'disponible', unknown: '—' } as Record<string, string>)[a] ?? a,
    title: 'OpenRig', daemon: 'Daemon', kernel: 'Kernel', rigs: 'Rigs',
    machine: 'machine', toggle: 'démarrer/arrêter', restart: 'redémarrer', unfold: 'déplier', daemonKey: 'daemon', kernelKey: 'kernel',
    daemonState: { running: 'actif', stopped: 'arrêté', stale: 'arrêté sans arrêt propre', unknown: 'inconnu' } as Record<string, string>,
    kernelState: { ready: 'prêt', starting: 'démarrage', stopped: 'arrêté', skipped: 'sans kernel', absent: 'absent', unknown: 'inconnu' } as Record<string, string>,
    look: { running: 'en marche', starting: 'démarrage', attention: 'à surveiller', stopped: 'arrêté' },
    daemonMeta: (port: number | undefined, pid: number | undefined) => [port ? `127.0.0.1:${port}` : '', pid ? `pid ${pid}` : ''].filter(Boolean).join(' · '),
    restoreHint: '↻ au démarrage : rigs relancés',
    kernelHint: 'l’opérateur qui aide à lancer un rig',
    seats: (running: number, total: number) => `${running}/${total}`,
    attention: (n: number) => `${n} ${plural(n, 'siège demande', 'sièges demandent')} attention`,
    since: (uptime: string) => `depuis ${uptime}`, snapshot: (s: string) => `snapshot ${s}`,
    work: (n: number) => (n ? `${n} ${plural(n, 'tâche', 'tâches')}` : ''),
    stoppedOnPurpose: 'arrêté volontairement',
    noRigs: 'Aucun rig sur cette machine.',
    notInstalled: 'OpenRig n’est pas installé sur cette machine (la commande rig est introuvable).',
    stoppedDaemon: 'Le daemon OpenRig est arrêté : D le démarre.',
    offline: 'Machine hors ligne.', outdated: 'Le daemon Ledge de cette machine ne connaît pas OpenRig : mettez-le à jour.',
    loading: 'Lecture d’OpenRig…', version: (v: string) => `OpenRig ${v}`,
    confirmTitle: 'Confirmer',
    confirm: (what: string) => `${what} ?`,
    what: {
      'daemon.stop': 'Arrêter le daemon OpenRig', 'daemon.restart': 'Redémarrer le daemon OpenRig', 'kernel.stop': 'Arrêter le kernel', 'kernel.restart': 'Redémarrer le kernel',
      'rig.stop': (rig: string) => `Arrêter le rig « ${rig} »`, 'rig.restart': (rig: string) => `Redémarrer le rig « ${rig} »`
    },
    busy: (names: string, n: number) => (n ? `${n} ${plural(n, 'agent au travail s’arrête', 'agents au travail s’arrêtent')} : ${names}.` : 'Aucun agent au travail.'),
    yes: 'confirmer', no: 'annuler',
    running: (cmd: string) => `en cours : ${cmd}`,
    done: (cmd: string) => `fait : ${cmd}`,
    failed: (why: string) => `échec : ${why}`,
    why: { busy: 'une autre action OpenRig est en cours sur cette machine', not_installed: 'OpenRig n’est pas installé', offline: 'machine hors ligne', outdated: 'daemon Ledge trop ancien' } as Record<string, string>
  },
  rigLaunch: {
    title: 'Lancer un rig', launchKey: 'lancer un rig', count: 'nombre de sièges',
    permissions: '4 · Permissions', policyKey: 'permissions',
    policyOf: { auto: 'Auto', standard: 'Standard', open: 'Ouvert', yolo: 'YOLO', locked: 'Verrouillé' } as Record<string, string>,
    specPolicy: (p: string) => `celle de la spec (${p})`, noSpecPolicy: 'aucune',
    asRig: 'comme le rig',
    policyHint: {
      none: 'sans politique : Claude en acceptEdits, Codex en workspace-write',
      auto: 'Claude décide seul (mode auto) ; Codex garde la posture par défaut',
      standard: 'tout passe sauf PR, publication, fusion, force push et destructif (demande une personne) ; règles appliquées une fois traduites dans les réglages du harnais',
      open: 'tout passe sauf le destructif ; règles appliquées une fois traduites dans les réglages du harnais',
      yolo: 'aucune demande : Claude --dangerously-skip-permissions, Codex danger-full-access',
      locked: 'seuls la chaîne d’outils et rig up/down passent ; règles appliquées une fois traduites dans les réglages du harnais'
    } as Record<string, string>,
    nonInterruptive: 'accepter les avertissements de premier lancement (--non-interruptive)',
    spec: '1 · Spec de départ', where: '2 · Où', roles: '3 · Sièges par rôle', delegation: '5 · Qui délègue à qui', preview: 'Aperçu · rig.yaml',
    specHint: 'Le modèle de rig : ses pods, ses rôles, les liens entre eux.',
    source: { user: 'mes specs', builtin: 'OpenRig' } as Record<string, string>,
    seatsOf: (n: number) => `${n} ${plural(n, 'siège', 'sièges')}`,
    folder: 'Dossier', name: 'Nom', folderHint: 'un dossier de cette machine, ~ accepté', projectFolder: (p: string) => `projet ${p}`,
    model: 'modèle', defaultModel: 'par défaut', modelKey: 'modèle',
    rolesHint: 'Un compteur à 3 donne build, build-2, build-3, identiques au premier.',
    pairs: 'par paires', all: 'chaque siège → tous', pairsHint: 'build-2 → review-2', allHint: 'chaque build → tous les review',
    save: 'enregistrer dans mes specs', notScaled: 'un siège par rôle : rien à déléguer de plus',
    loading: 'Lecture des specs…', noSpecs: 'Aucune spec sur cette machine.',
    daemonStopped: 'Démarrez le daemon OpenRig d’abord (D sur l’écran OpenRig).',
    noCheck: 'p vérifie le lancement (rig up --plan), sans rien démarrer.',
    checking: 'Vérification…', launching: 'Lancement…',
    passes: (seats: number) => `✓ le plan passe · ${seats} ${plural(seats, 'siège', 'sièges')}`,
    planStatus: (s: string) => `plan : ${s}`,
    warning: (text: string, seats: string) => (seats ? `${text} (${seats})` : text),
    launched: (name: string, n: number) => `Rig « ${name} » lancé · ${n} ${plural(n, 'siège', 'sièges')}.`,
    check: 'vérifier (--plan)', launch: (n: number) => `lancer ${n} ${plural(n, 'siège', 'sièges')}`,
    missing: { spec: 'Choisissez une spec.', cwd: 'Indiquez le dossier de travail.', name: 'Le nom du rig : lettres, chiffres, . _ - (pas de - au début).', seats: 'Au moins un siège.' },
    why: {
      busy: 'Une autre action OpenRig est en cours sur cette machine.', cwd_missing: 'Ce dossier n’existe pas sur la machine.', spec_not_found: 'Cette spec n’est plus dans la bibliothèque.',
      daemon_stopped: 'Démarrez le daemon OpenRig d’abord (D sur l’écran OpenRig).', not_installed: 'OpenRig n’est pas installé sur cette machine.',
      offline: 'Machine hors ligne.', outdated: 'Le daemon Ledge de cette machine ne sait pas lancer de rig : mettez-le à jour.'
    } as Record<string, string>
  },
  rigSeats: {
    title: (rig: string, machine: string) => `Sièges · ${rig} · ${machine}`, key: 'sièges',
    stays: (now: string) => `Le rig reste en marche. Aujourd’hui : ${now}.`,
    role: 'rôle', count: 'nombre', delegationKey: 'délégation', apply: 'appliquer', cancel: 'annuler',
    pairs: 'délégation par paires', all: 'chaque ajout → tous', linksPairs: 'liens ajoutés par paires', linksAll: 'liens ajoutés à tous',
    nothing: 'Changez un nombre : - +', notRunning: 'Seul un rig en marche change de sièges.',
    busy: (seat: string) => `${seat} travaille : son travail en cours s’arrête.`,
    applying: 'en cours…',
    done: (added: number, removed: number, links: number | undefined) => `+${added} −${removed} sièges${links !== undefined ? `, ${links} ${plural(links, 'lien', 'liens')}` : ''}`,
    linksUnsupported: 'cet OpenRig ne sait pas lier des sièges ajoutés à un rig en marche (avant 0.7)',
    why: {
      rig_not_running: 'Le rig n’est plus en marche.', rig_root_unknown: 'Impossible de copier un siège : les agents du rig sont introuvables.',
      busy: 'Une autre action OpenRig est en cours sur cette machine.', not_installed: 'OpenRig n’est pas installé sur cette machine.',
      offline: 'Machine hors ligne.', outdated: 'Le daemon Ledge de cette machine ne sait pas changer les sièges d’un rig : mettez-le à jour.'
    } as Record<string, string>
  },
  small: {
    tooSmall: (w: number, h: number) => `Fenêtre trop petite : ${w}×${h}`, atLeast: (w: number, h: number) => `il faut au moins ${w}×${h}`,
    waits: (name: string, question: boolean) => (question ? `${name} a une question` : `${name} attend ton accord`), kept: 'brouillon gardé'
  },
  cli: { notTty: 'ledge tui: needs a terminal (stdin and stdout must be a TTY)', movedToTab: 'ledge tui s’ouvre dans l’onglet Ledge.', loadingProfile: 'Windows Terminal charge le profil Ledge…' }
};
