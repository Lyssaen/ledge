import { MESSAGE_MAX, type ActionErrorCode } from '@ledge/protocol';
import { actionWords, type ActionVars } from '@ledge/ui/chat/actionWords';

import { useSyncExternalStore } from 'react';
import { createI18n } from '@ledge/ui/i18n/lang';
import { en } from './copy.en';

/** Every visible string of the phone app lives here (decision D13): French below, English in copy.en.ts. */
const fr = {
  appName: 'Ledge',
  /** A percentage as the language writes it (« 84 % », "84%"). */
  percent: (n: number) => `${n} %`,
  /** The name beside the mark, in the header of the five tabs. */
  brand: 'Ledge',
  inbox: {
    title: 'À toi',
    subtitle: (n: number) => n === 0 ? 'Tout est calme' : n === 1 ? '1 demande. Choisis par où commencer.' : `${n} demandes. Choisis par où commencer.`,
    filtersLabel: 'Filtrer les demandes',
    filters: { all: 'Tout', permission: 'Autorisations', question: 'Questions', tasks: 'Tâches' },
    /** With the closed tasks of Ledge (ledge home spec §2.4). */
    subtitleTasks: (requests: number, tasks: number) => {
      const r = requests === 0 ? '' : requests === 1 ? '1 demande' : `${requests} demandes`;
      const t = tasks === 1 ? '1 tâche finie' : `${tasks} tâches finies`;
      return `${r ? `${r} et ` : ''}${t}. Choisis par où commencer.`;
    },
    taskDone: 'Tâche finie', taskClosed: 'Tâche close',
    finishedTitle: (title: string) => `A fini « ${title} »`, refusedTitle: (title: string) => `A refusé « ${title} »`, droppedTitle: (title: string) => `A abandonné « ${title} »`,
    ledgeTask: 'Tâche de Ledge', seeResult: 'Voir le résultat', putAway: 'Ranger',
    oldestFirst: 'LES PLUS ANCIENNES D’ABORD',
    examine: 'Examiner',
    lastKnown: 'Dernier état connu',
    upToDate: 'Tu es à jour',
    upToDateHint: 'Aucune demande n’attend de décision.',
    seeAgents: 'Voir les sessions',
    emptyFilter: 'Aucune demande dans ce filtre',
    emptyFilterHint: 'Les autres demandes restent dans « Tout ».',
    offlineNote: 'Tu peux consulter les demandes. Aucune décision ne sera envoyée hors connexion.'
  },
  nav: {
    label: 'Navigation principale',
    /** The five tabs, the rail's Atelier and Réglages (docs/mockups/ledge-mobile-refonte/m0-socle.html, §1 and §2). */
    atoi: 'À toi', sessions: 'Sessions', prs: 'MR/PR', rigs: 'Rigs', chat: 'Ledge', atelier: 'Atelier', settings: 'Réglages',
    /** « Retour », named after the screen it leads to; plain when that screen is not known (after a reload). */
    back: 'Retour',
    backTo: { atoi: 'Retour à À toi', sessions: 'Retour aux sessions', prs: 'Retour aux MR et PR', rigs: 'Retour aux rigs', chat: 'Retour à Ledge', atelier: 'Retour à l’Atelier', thread: 'Retour au fil', terminal: 'Retour au terminal', request: 'Retour à la demande', connection: 'Retour aux réglages' } as Partial<Record<string, string>>
  },
  images: {
    attach: 'Joindre une image', remove: 'Retirer l\'image', tooLarge: 'Image trop lourde, même réduite', notImage: 'Ce fichier n\'est pas une image', max: '5 images au plus par message',
    dialog: 'Réponds d\'abord à la question, l\'image partira après', failed: 'Image non envoyée',
    noPreview: 'Image trop lourde pour cet appareil · ouvrir sur le PC', unavailable: 'Image indisponible',
    view: 'Image', share: 'Partager', save: 'Enregistrer', close: 'Fermer', prev: 'Image précédente', next: 'Image suivante'
  },
  chat: {
    title: 'Ledge',
    /** The Ledge tab of a PC that does not offer the chat (design-ux, M0 point 2). */
    unavailable: {
      title: (pc: string) => `${pc} ne propose pas encore le chat à cet appareil`,
      body: 'Le chat avec Ledge arrive avec une prochaine version de Ledge sur le PC.',
      seeAtoi: 'Voir « À toi »'
    },
    subtitle: (agents: number, repos: number) => `Fil de cet appareil · ${agents} ${agents > 1 ? 'agents' : 'agent'}, ${repos} ${repos > 1 ? 'repos' : 'repo'}`,
    point: {
      title: 'Le point', label: 'Le point', ago: (s: string) => `il y a ${s}`,
      yours: 'À TOI', yoursLabel: 'À toi', given: 'CONFIÉES PAR LEDGE', givenLabel: 'Confiées par Ledge',
      yes: 'Oui', no: 'Non', see: 'Voir', finished: 'a fini sa tâche', refused: 'a refusé sa tâche', dropped: 'a abandonné sa tâche',
      progress: (done: number, given: number) => `${done}/${given}`,
      state: { open: 'ouverte', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' },
      calm: 'Rien ne t’attend. Demande à Ledge ce que tu veux savoir ou faire.',
      near: (pct: number) => `contexte ${pct} %`, nearHint: 'La relève se lance depuis le PC.',
      /** The harnesses' limits (docs/mockups/ledge-harness-usage.html, « LIMITES »): percent and reset only. */
      limits: 'LIMITES', limitsLabel: 'Limites', harness: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' } as Record<string, string>,
      harnessShort: { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' } as Record<string, string>,
      five: '5 h', week: 'Semaine', month: 'Mois', poolCursor: 'Cursor', poolOther: 'Autres', model: (m: string) => m,
      resumes: (at: string) => `reprend à ${at}`, resumesOn: (at: string) => `reprend le ${at}`, loading: 'Lecture en cours…',
      notOnPc: (harness: string) => `Lecture impossible : reconnecte ${harness} sur le PC.`,
      unread: 'Limite non lue : Cursor ne la donne pas pour cette offre.', unreach: (age: string) => `Pas de lecture depuis ${age}.`, unreachNever: 'Lecture impossible pour l’instant.', stale: (age: string) => `Lu il y a ${age}.`,
      reachedLabel: (h: string, w: string) => `${h} · ${w} atteinte`, overLabel: (h: string, w: string, p: number) => `${h} · ${w} à ${p} %`,
      /** A decision a session put to the user: answered in the chat, through the card Ledge proposes. */
      decision: 'Décision', asks: 'te demande', answer: 'Répondre', answerLabel: (title: string) => `Répondre à « ${title} »`,
      someone: 'Une session',
      answerDraft: (title: string, id: string, name: string) => `Réponse à la décision « ${title} » (${id}) de ${name} : `,
      /** A proposal about the notes (docs/mockups/ledge-brain-notes.html, part 2): answered here, a « yes » with the device's check. */
      note: {
        tag: 'Note', add: (note: string) => `propose d’ajouter à la note ${note}`, create: (note: string) => `propose une nouvelle note ${note}`,
        flag: (note: string) => `signale la note ${note} comme fausse ou périmée`, source: (s: string) => `Source : ${s}`,
        yes: 'Ajouter', edit: 'Modifier', no: 'Refuser', mark: 'Marquer à revoir', ignore: 'Ignorer', createYes: 'Créer la note', editYes: 'Ajouter ce texte', cancel: 'Annuler',
        field: 'Le texte ajouté sous « Ajouts »', titleField: 'Titre', whenField: 'Quand la lire',
        failed: 'Pas envoyé : réessaie.', confirmRequired: 'Protège d’abord tes accords depuis Réglages : ajouter demande la passkey de cet appareil.', cancelled: 'Vérification annulée. Rien n’a été écrit.', expired: 'La vérification a expiré. Recommence.', stale: 'Déjà traitée ailleurs.'
      }
    },
    task: {
      label: 'Tâche à confier', give: 'Confier',
      given: (name: string, id: string, state: string) => `Confiée à ${name} · ${id} · ${state}`, notGiven: 'Pas confiée.'
    },
    reset: 'Nouvelle conversation',
    suggestions: {
      waiting: 'Qui attend quelque chose de moi ?',
      session: (name: string) => `Où en est ${name} sur le badge d'attente ?`,
      repo: (repo: string) => `Qu'est-ce qui a changé dans ${repo} aujourd'hui ?`
    },
    stop: 'Arrêter',
    stepsLabel: 'Étapes',
    sources: 'Sources : ',
    field: 'Question pour Ledge',
    placeholder: 'Demander à Ledge…',
    send: 'Envoyer la question',
    busy: 'Ledge répond déjà à d\'autres questions. Réessaie dans un instant.',
    timeout: 'Ledge n\'a pas répondu à temps.',
    failed: 'Ledge n\'a pas pu répondre.',
    cancelled: 'Question arrêtée.',
    offline: 'Hors ligne : pose la question quand le PC sera joignable.',
    cut: 'Réponse coupée : la suite est sur le PC.',
    relayLabel: 'Consigne proposée', launchLabel: 'Session proposée',
    relayHead: (name: string) => `Envoyer à ${name}`,
    launchHead: (tool: string, project: string) => `Lancer ${tool} dans ${project}`,
    ignore: 'Ignorer', relayGo: 'Envoyer',
    queued: (name: string) => `En attente : ${name} est occupé.`,
    sentTo: (name: string) => `Envoyé à ${name} · `, launchedTo: 'Lancée · ', seeThread: 'voir son fil',
    notSent: 'Pas envoyé.', notLaunched: 'Pas lancée.',
    relayCancel: 'Annuler', relayRetry: 'Réessayer',
    /** The target's state on the relay card, as the PC's pill (in « tu », as the desktop says it). */
    relayPill: { yours: 'à toi', working: 'travaille', waiting: 'attend ta réponse', stopped: 'arrêtée' },
    /** Why a relay failed, from the PC's code (never its text). */
    relayFailed: (code?: string): string => ({
      read_only: 'Pas envoyé : cette session n’a pas été lancée par Ledge.',
      ended: 'Pas envoyé : la session s’est arrêtée avant de le recevoir.',
      unknown_session: 'Pas envoyé : la session n’existe plus.',
      busy: 'Pas envoyé : la session est en cours de fermeture ou de décision.',
      not_taken: 'Pas envoyé : le terminal ne l’a pas pris.',
      no_prompt: 'Pas envoyé : la session attend une réponse, réponds-lui d’abord.',
      not_offered: 'Pas envoyé : la session attend une réponse, réponds-lui d’abord.',
      free_text: 'Pas envoyé : la session attend une réponse, réponds-lui d’abord.',
      stale: 'Pas envoyé : la carte a été ignorée entre-temps.'
    } as Record<string, string>)[code ?? ''] ?? 'Pas envoyé.',
    review: 'Revoir', ignoredRest: (at: string) => `Le reste ignoré à ${at}`,
    launchSetup: 'Protège d\'abord tes accords depuis Réglages.',
    closeLabel: 'Sessions à fermer', closeRow: 'Fermer', closeAll: (n: number) => `Fermer tout (${n})`,
    closing: 'Fermeture…', closed: 'Fermée', killed: 'Fermée de force', ended: 'Terminée',
    closeFailed: 'Échec de la fermeture', closeSetup: 'Protège d\'abord tes accords depuis Réglages.',
    /** The generic card (#94, docs/mockups/ledge-action-card.html, « Téléphone »): the rows' lines are the PC's (actionWords),
     *  the sentences that speak to the user say « tu » (ledge-action-card-codes.md). */
    action: {
      label: (n: number) => n > 1 ? `Plan de ${n} actions` : 'Action proposée',
      risk: { read: 'Lecture', reversible: 'Réversible', destructive: 'Irréversible' },
      step: (k: number) => `Étape ${k}`,
      stepState: { done: (k: number) => `Étape ${k}, appliquée`, failed: (k: number) => `Étape ${k}, échouée`, refused: (k: number) => `Étape ${k}, refusée`, running: (k: number) => `Étape ${k}, en cours` },
      verbs: {
        'session.model': 'Changer', 'session.interrupt': 'Interrompre', 'session.archive': 'Archiver', 'session.restore': 'Restaurer', 'session.resume': 'Reprendre',
        'session.decide': 'Accepter',
        'task.cancel': 'Abandonner', 'task.pass': 'Passer le relais', 'task.answer': 'Répondre', 'note.add': 'Ajouter'
      } as Record<string, string>,
      apply: 'Appliquer', deny: 'Refuser', ignore: 'Ignorer', review: 'Revoir', retry: 'Réessayer', running: 'En cours…',
      done: (at: string) => `Appliquée${at ? ` · ${at}` : ''}`, refusedState: 'Refusée', denied: (at: string) => `Refus envoyé${at ? ` · ${at}` : ''}`,
      open: (name: string) => `Ouvrir ${name}`,
      failed: (why: string) => `Échec : ${why}`, refused: (why: string) => `Refusée : ${why} Rien n’a été envoyé.`,
      held: (k: number) => `Pas appliquée : le plan s’est arrêté à l’étape ${k}.`,
      stale: 'La demande a changé depuis : rien n’a été envoyé.',
      deniedNote: (name: string) => `${name} a reçu ton refus : la commande n’a pas été lancée.`,
      cutMark: 'Demande coupée : la suite est sur le PC.',
      cutNote: 'Demande trop longue pour cet appareil : elle s’accepte sur le PC. Tu peux la refuser d’ici.',
      all: (n: number) => `Tout appliquer (${n})`, resume: (k: number, n: number) => `Reprendre à l’étape ${k} (${n})`, skip: (k: number, n: number) => `Continuer sans l’étape ${k} (${n})`,
      inOrder: 'Dans l’ordre ; s’arrête au premier échec.', notReplayed: 'Les étapes faites ne sont pas rejouées.',
      progress: (k: number, n: number) => `Étape ${k} sur ${n}…`, planDone: (at: string) => `Plan appliqué${at ? ` à ${at}` : ''}`,
      notSent: 'Pas envoyé. Réessaie.',
      sheet: { many: (n: number) => `Appliquer ces ${n} actions, dans l’ordre ?`, one: (line: string) => `${line} ?`, stops: 'Si une étape échoue, les suivantes ne sont pas appliquées.', cancel: 'Annuler' },
      ignored: (n: number, at: string, sent: { done: number; denied: number; failed: number }) => {
        const went = [
          ...(sent.done ? [`${sent.done} ${sent.done > 1 ? 'appliquées' : 'appliquée'}`] : []),
          ...(sent.denied ? [`${sent.denied} ${sent.denied > 1 ? 'refus envoyés' : 'refus envoyé'}`] : []),
          ...(sent.failed ? [`${sent.failed} ${sent.failed > 1 ? 'échouées' : 'échouée'}`] : [])
        ];
        if (!went.length) return `${n > 1 ? `Plan de ${n} actions ignoré` : 'Carte ignorée'} à ${at} · rien n’a été envoyé`;
        return n > 1 ? `Plan de ${n} actions : ${went.join(', ')}, le reste ignoré à ${at}` : `Carte ignorée à ${at} · l’action est partie, mais n’a pas abouti`;
      },
      /** A row's line, from its words; undefined when one is missing (the daemon's summary then). */
      line: (action: string, v: ActionVars): string | undefined => actionWords.fr.line[action]?.(v),
      kind: actionWords.fr.kind,
      /** Why a row was refused or failed: the PC’s words, with the phone’s own sentences where it asks something of the user. */
      why: (code: ActionErrorCode | undefined, action: string | undefined, v: ActionVars): string => {
        if (code === 'changed') return 'la situation a changé depuis : redemande à Ledge.';
        if (code === 'not_decision') return v.task ? `la tâche « ${v.task} » n’est pas une décision qui t’est posée.` : 'cette tâche n’est pas une décision qui t’est posée.';
        return actionWords.fr.why(code, action, v);
      }
    },
    steps: {
      sessions: (n: number) => `Lit les ${n} sessions…`,
      pane: (name: string) => `Regarde le terminal de ${name}…`,
      reply: (name: string) => `Lit la dernière réponse de ${name}…`,
      look: (name: string) => `Regarde ${name}…`
    }
  },
  agents: {
    title: 'Sessions',
    subtitle: (sessions: number, projects: number) => `${sessions} ${sessions > 1 ? 'sessions' : 'session'} · ${projects} ${projects > 1 ? 'projets' : 'projet'} sur ce PC`,
    offline: 'Dernier état connu · connexion perdue',
    unread: '● Non lu',
    working: 'Travaille sur les dernières modifications.',
    state: { working: 'Au travail', idle: 'Disponible', exited: 'Terminée', error: 'Erreur' },
    empty: 'Aucune session sur ce PC', emptyHint: 'Les agents lancés depuis Ledge apparaissent ici.',
    open: (name: string, task: string) => `${name} · ${task}`,
    /** « Écrire au groupe »: one message to every session of a group. */
    writeGroup: 'Écrire au groupe', writeGroupLabel: (group: string) => `Message à tout le groupe ${group}`, writeGroupPlaceholder: 'Un message pour tout le groupe',
    send: 'Envoyer', cancel: 'Annuler', sending: 'Envoi…',
    sentTo: (names: string[]) => `Envoyé à ${names.join(', ')}`,
    refusedLine: (name: string, reason: string) => `${name} : ${reason}`,
    tooMany: (n: number, max: number) => `${n} sessions dans ce groupe, ${max} au plus : écris-leur depuis le PC`,
    nobody: 'Personne à qui écrire', notSent: 'Message non envoyé', uncertain: 'Message envoyé ; vérifie sur le PC',
    /** A session's context and relief (context handover spec §3.2): shown here, started from the PC. */
    context: (pct: number) => `contexte ${pct} %`,
    relief: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`
  },
  link: {
    online: 'connecté', offline: 'déconnecté',
    /** The header's way to the connection screen, for screen readers. */
    openConnection: 'Réglages de cet appareil',
    lostTitle: 'Connexion au PC perdue',
    lostBody: 'Le PC, le réseau ou Tailscale est indisponible. Les demandes ci-dessous peuvent avoir changé.',
    lostDetail: 'Dernier état connu. Reconnecte-toi pour vérifier si cette demande attend toujours une décision.',
    lastKnownAt: (t: string) => `Dernier état connu · ${t}`,
    /** A tab before the PC's first state (m0-socle.html, §4). */
    connecting: (pc: string) => `Connexion à ${pc}…`,
    reconnect: 'Reconnecter et actualiser',
    reconnecting: 'Reconnexion…'
  },
  /** A request's badge: the desktop's words for what waits on the user. */
  kind: { permission: 'Ton accord', question: 'Une question', plan: 'Plan', diff: 'Modification' },
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
    uncertain: 'Changement de modèle envoyé ; vérifie sur le PC',
    failed: {
      not_launched: 'pas lancé par Ledge', ended: 'session terminée', no_conversation: 'aucune conversation à reprendre',
      not_running: "l'agent ne tourne pas", effort_in_model: "cet outil prend l'effort dans le modèle",
      restart_failed: 'le redémarrage a échoué', refused: "refusé par l'outil"
    },
    failedLine: (reason: string) => `Changement de modèle non appliqué : ${reason}`,
    chip: (what: string) => `Modèle et effort : ${what}`,
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
    onPcHint: 'Une demande à impact élevé s’accepte sur le PC. Tu peux la refuser d’ici.',
    hint: 'La décision sera transmise immédiatement au PC.',
    offlineHint: 'Aucune décision ne sera envoyée hors connexion.',
    readOnly: 'Session démarrée hors de Ledge : réponds dans le terminal.',
    answerOnPc: 'Cet agent ne peut pas recevoir de réponse libre depuis un appareil lié. Réponds sur le PC.',
    answerHint: 'La réponse sera transmise immédiatement au PC.',
    send: 'Envoyer ma réponse',
    otherInvalid: `Le PC n’a pas accepté cette réponse. Corrige-la, elle tient sur une ligne de ${MESSAGE_MAX} caractères au plus.`,
    otherUnsupported: 'Cet agent ne peut pas recevoir de réponse libre depuis un appareil lié. Choisis une option ou réponds sur le PC.',
    sending: 'Transmission au PC…', sendingBody: 'En attente de confirmation du terminal.',
    uncertain: 'Réception non confirmée',
    uncertainBody: 'La connexion a été perdue pendant l’envoi. La décision a peut-être été reçue. Vérifie son état avant de recommencer.',
    check: 'Reconnecter et vérifier', checking: 'Vérification…',
    changed: 'La demande a été mise à jour. Relis-la avant de décider.',
    reread: 'J’ai relu la demande',
    busy: 'Une autre décision est en cours sur le PC.',
    notTaken: 'Le terminal n’a pas confirmé. La demande est toujours en attente.',
    noPrompt: 'Le terminal n’affiche plus la demande. Ouvre-le sur le PC.',
    failed: 'La décision n’a pas pu être transmise.'
  },
  result: {
    header: 'Demande traitée',
    allowed: 'Autorisation prise en compte', denied: 'Refus pris en compte', answered: 'Réponse prise en compte',
    body: 'Le terminal a reçu ta décision. Elle apparaît maintenant dans le fil de cette session.',
    thread: (bot: string) => `Voir le fil de ${bot}`,
    final: 'Une décision transmise ne peut pas être annulée.',
    back: 'Retour aux demandes'
  },
  /** Closing a session from its page, and resuming it once ended (mockup mobile-session-close). */
  sessionEnd: {
    close: (bot: string) => `Fermer ${bot}`, closingNamed: (bot: string) => `Fermeture de ${bot} en cours`,
    closeTitle: (bot: string) => `Fermer ${bot} ?`,
    closeBody: 'Ledge quitte l’agent proprement, comme /exit dans son terminal. Sa conversation est gardée : tu pourras la reprendre d’ici ou depuis le PC.',
    cutsTitle: 'Ce que la fermeture coupe',
    working: (bot: string) => `${bot} travaille : son tour en cours sera interrompu. Ce qui est déjà fait reste fait.`,
    turn: (bot: string) => `Le tour en cours de ${bot} sera interrompu. Ce qui est déjà fait reste fait.`,
    request: 'La demande en attente sera refusée.', question: 'La question en attente restera sans réponse.',
    helpers: (n: number) => n > 1 ? `${n} sous-agents s’arrêtent avec la session.` : '1 sous-agent s’arrête avec la session.',
    force: 'Si l’agent ne répond pas, Ledge ferme son terminal de force.',
    check: 'Une vérification sur ton appareil sera demandée.',
    goClose: 'Fermer avec mon appareil', goCloseApple: 'Fermer avec Face ID',
    resumeTitle: (bot: string) => `Reprendre ${bot} ?`,
    resumeBody: 'L’agent repart sur sa conversation, dans le même dossier et sur la même branche.',
    goResume: 'Reprendre avec mon appareil', goResumeApple: 'Reprendre avec Face ID',
    cancel: 'Annuler',
    offlineTitle: 'PC injoignable',
    offlineClose: (bot: string) => `Reconnecte-toi pour fermer ${bot}. Rien n’a été envoyé.`,
    offlineResume: (bot: string) => `Reconnecte-toi pour reprendre ${bot}. Rien n’a été envoyé.`,
    reconnect: 'Reconnecter',
    unprotectedTitle: 'Vérification impossible',
    unprotectedClose: (bot: string) => `Protège d’abord tes accords depuis Réglages. Tu peux aussi fermer ${bot} sur le PC.`,
    unprotectedResume: (bot: string) => `Protège d’abord tes accords depuis Réglages. Tu peux aussi reprendre ${bot} sur le PC.`,
    openConnection: 'Ouvrir Réglages',
    closing: (bot: string) => `Fermeture de ${bot}…`,
    closingHint: 'L’agent termine ce qu’il tape, puis quitte. Cela peut prendre jusqu’à 30 s.',
    ended: 'Session terminée',
    endedBody: 'Sa conversation est gardée. Reprendre relance l’agent sur cette conversation, dans le même dossier.',
    endedOnPc: 'Sa conversation est gardée : reprends-la depuis le PC.',
    killed: 'Fermée de force : l’agent ne répondait pas. Son dernier tour peut manquer.',
    resume: (bot: string) => `Reprendre ${bot}`,
    resuming: (bot: string) => `Reprise de ${bot}…`,
    closedHere: (time: string) => `Session fermée depuis cet appareil · ${time}`,
    notClosed: (bot: string) => `${bot} n’a pas été fermée`,
    closeFailed: 'Le PC n’a pas pu arrêter l’agent. Vérifie sur le PC, ou réessaie.',
    readOnly: 'Elle a été démarrée hors de Ledge : ferme-la dans son terminal sur le PC.',
    uncertainTitle: 'Fermeture non confirmée',
    uncertain: (bot: string) => `La connexion a été perdue. ${bot} est peut-être déjà fermée : son état se mettra à jour à la reconnexion.`,
    notResumed: (bot: string) => `${bot} n’a pas repris`,
    resumeUncertainTitle: 'Reprise non confirmée',
    resumeUncertain: (bot: string) => `La connexion a été perdue. ${bot} a peut-être déjà repris : son état se mettra à jour à la reconnexion.`,
    noConversation: 'Aucune conversation à reprendre pour cette session.',
    resumeFailed: 'Le PC n’a pas pu relancer l’agent. Vérifie sur le PC, ou réessaie.',
    retry: 'Réessayer',
    /** Next to « Terminée » in the list: today's time, yesterday, or the day. */
    at: (time: string) => `à ${time}`, yesterday: 'hier', on: (day: string) => `le ${day}`
  },
  thread: {
    back: 'Retour aux sessions', title: 'Conversation avec un agent',
    terminal: (bot: string) => `Ouvrir le terminal de ${bot}`,
    log: (bot: string) => `Échanges avec ${bot}`,
    cut: 'Message raccourci', more: 'Messages plus anciens sur le PC',
    loading: 'Chargement du fil…', unavailable: 'Fil indisponible hors connexion', empty: 'Aucun échange pour le moment.',
    unknown: 'Cette session n’existe plus sur le PC.', unknownBack: 'Retour aux sessions',
    suggestion: 'Suggestion pour la suite',
    capture: 'Capture',
    agentLabel: 'Réponse de l’agent',
    awaiting: 'Décision attendue · dans « À toi »', examine: 'Examiner la demande',
    event: {
      accept: (from: string) => `Accord pris en compte · depuis ${from}`,
      deny: (from: string) => `Refus pris en compte · depuis ${from}`,
      answer: (option: string) => `Réponse prise en compte · ${option}`,
      resolved: 'Traitée dans le terminal', interrupt: 'Interruption transmise',
      fromPc: 'le PC', fromHere: 'cet appareil',
      /** Another linked device, by the name it had when it decided. */
      fromDevice: (name: string) => name
    },
    /** Claude Code's `<task-notification>`, as the desktop's task card says it. */
    task: {
      kicker: 'Tâche', statuses: { killed: 'Arrêtée', completed: 'Terminée', failed: 'En échec', other: 'Notifiée' },
      agent: 'L’agent', command: 'La commande',
      agentDid: { killed: 'a été arrêté. Il peut reprendre si tu lui écris.', completed: 'a terminé en arrière-plan.', failed: 'a échoué en arrière-plan.', other: 's’est arrêté.' },
      commandDid: { killed: 'a été arrêtée.', completed: 's’est terminée en arrière-plan.', failed: 'a échoué en arrière-plan.', other: 's’est arrêtée.' },
      code: (c: string) => `code ${c}`, raw: 'Notification brute', label: (status: string) => `Tâche · ${status}`
    },
    delivery: { sending: 'Envoi au PC…', taken: 'Pris par le terminal', takenNow: 'Pris par le terminal · à l’instant', uncertain: 'Réception non confirmée' },
    /** OpenRig's messages in a seat's thread (docs/mockups/openrig-messages, section « Téléphone » and its copy table). */
    rig: {
      from: 'De', to: 'À', reply: 'Répondre', replyTo: (n: string) => `Répondre à ${n}`,
      raw: 'Brut', command: 'Commande', rawMany: (k: number) => `${k} messages collés ensemble · brut`,
      twice: (k: number) => `reçu ${k} fois`,
      unreadable: 'Message OpenRig illisible · affiché tel quel',
      /** Put in the composer of the sender's session: ordinary text the person edits. */
      about: (line: string) => `À propos de : « ${line} »`,
      sent: { sending: 'envoi…', delivered: '✓ remis', read: '✓ lu', failed: 'non remis' },
      rowIn: (n: string) => `Confiée par ${n}`, rowOut: (n: string) => `Passée à ${n}`,
      rowState: { unknown: 'état non suivi', refused: 'non transmise', pending: 'en attente', taken: 'prise', passed: (n: string) => `passée à ${n}`, blocked: 'bloquée', done: 'terminée' },
      /** A row's short log, read live. */
      log: { handed: (t: string) => `confiée ${t}`, passed: (t: string) => `passée ${t}`, taken: (t: string) => `prise ${t}`, done: (t: string) => `terminée ${t}`, notTaken: 'pas encore prise' },
      /** The short log of a handoff OpenRig refused: when it was passed, and what OpenRig said. */
      refusedSaid: (time: string, said: string) => `passée ${time} · OpenRig : ${said}`,
      refusedSilent: (time: string) => `passée ${time} · non transmise par OpenRig`,
      openrig: 'OpenRig',
      unblocked: (id: string) => `Blocage levé : la ligne ${id} est de nouveau à faire`,
      stalled: (id: string, min: number) => `Ligne ${id} sans suite depuis ${min} min`,
      folded: (k: number) => `${k} avis OpenRig`
    },
    slash: {
      label: (tool: string) => `Commandes de ${tool}`, count: (tool: string, n: number) => `${tool} · ${n} commande${n > 1 ? 's' : ''}`,
      loading: (tool: string) => `${tool} · lecture des commandes…`,
      unavailable: (bot: string) => `Liste des commandes indisponible. Tu peux quand même taper la commande : Ledge l’enverra telle quelle à ${bot}.`,
      none: (q: string, bot: string) => `Aucune commande « ${q} ». Elle partira comme un message à ${bot}.`,
      source: { builtin: '', project: 'Projet', user: 'Perso', plugin: 'Plugin', extension: 'Extension' } as Record<string, string>,
      blocked: { panel: 'Ouvre un panneau du terminal', close: 'Terminerait la session : ferme-la depuis Ledge' } as Record<string, string>,
      bare: (c: string) => `Sans argument, /${c} ouvre un panneau du terminal : donne-lui un argument.`
    },
    composer: {
      label: (bot: string) => `Message pour ${bot}`, send: (bot: string) => `Envoyer à ${bot}`,
      quickLabel: 'Consignes rapides',
      placeholder: { idle: (bot: string) => `Écrire à ${bot}…`, working: 'L’agent travaille…', awaiting: 'Traite la demande ci-dessus', offline: 'Reconnecte-toi pour écrire', connecting: 'Connexion en cours…', ended: 'Session terminée', readOnly: 'Réponds dans le terminal' },
      status: { idle: 'Disponible pour ta consigne', working: 'Au travail · consulte le terminal', awaiting: 'En attente d’une décision', offline: 'Connexion perdue · dernier état connu', connecting: 'Connexion en cours…', sending: 'Envoi au PC…', taken: 'Consigne reçue · l’agent reprend', ended: 'Session terminée', readOnly: 'Session démarrée hors de Ledge' },
      reconnect: 'Reconnecter', tooLong: (max: number) => `Le message est trop long : ${max} caractères au plus.`,
      untypable: 'Le message doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.',
      failTitle: 'Message non envoyé', uncertainTitle: 'Réception non confirmée',
      lost: 'Le PC est injoignable. Ton brouillon est conservé.',
      imageGone: 'Une image n’est plus disponible : retire-la et recolle-la. Ton brouillon est conservé.',
      busy: 'L’agent n’est plus disponible pour une consigne. Ton brouillon est conservé.',
      invalid: (max: number) => `Le message n’a pas été accepté par le PC (${max} caractères au plus). Ton brouillon est conservé.`,
      readOnly: 'Cette session a été démarrée hors de Ledge : écris dans le terminal.',
      forbidden: 'Cet appareil n’est plus autorisé. Ton brouillon est conservé.',
      uncertain: 'La connexion a été perdue ou le terminal n’a pas confirmé. Le message a peut-être été reçu : vérifie le terminal avant de le renvoyer. Ton brouillon est conservé.'
    }
  },
  terminal: {
    title: (bot: string) => `Terminal de ${bot}`, back: 'Retour au fil',
    live: 'Lecture seule · en direct', waiting: 'Lecture seule · en attente', offline: 'Lecture seule · dernier état connu',
    smaller: 'Réduire le texte', larger: 'Agrandir le texte',
    output: 'Sortie du terminal, défilement horizontal', empty: 'Aucune sortie pour le moment.', unknown: 'Cette session n’existe plus sur le PC.',
    scrollHint: 'Fais défiler horizontalement pour lire les lignes longues.',
    interrupt: (bot: string) => `Interrompre ${bot}`, sending: 'Interruption en cours…', sent: 'Interruption transmise',
    note: 'Interrompre n’annule pas les actions déjà effectuées.',
    why: { waiting: 'Une décision est attendue : traite-la d’abord.', offline: 'Reconnecte-toi pour interrompre.', idle: 'L’agent ne travaille pas.' },
    fail: 'L’interruption n’a pas été transmise. Vérifie le terminal sur le PC.',
    readOnly: 'Session démarrée hors de Ledge : interromps-la dans le terminal du PC.',
    uncertain: 'Réception non confirmée : vérifie le terminal avant de recommencer.',
    /** The live terminal (spec 2026-11-02 mobile terminal, mockup docs/mockups/mobile-terminal.html). */
    live2: {
      meta: (project: string, cols: number, rows: number) => `${project} · ${cols} × ${rows}, taille du PC`,
      ended: (project: string) => `${project} · terminée`,
      status: { connecting: 'Connexion au terminal…', live: 'En direct · lecture seule', held: 'Au clavier', offline: 'Connexion perdue · dernier écran connu', ended: 'Session terminée', refused: 'Terminal indisponible' },
      view: 'Affichage', readable: 'Lisible', fit: 'Ajusté',
      screen: (bot: string) => `Terminal de ${bot}`,
      position: 'Partie visible des colonnes',
      hold: 'Prendre la main', holdAgain: 'Reprendre la main', release: 'Rendre la main',
      inputOff: 'Pour taper ici, active « Taper dans les terminaux depuis un appareil lié » sur le PC, dans Accès mobile.',
      offlineHint: 'L’écran reprend dès que le PC répond.',
      back: 'Retour au fil',
      heldTitle: (bot: string) => `Tu tapes dans ${bot}`,
      heldLeft: (left: string) => `Main rendue dans ${left} sans frappe`,
      heldTag: 'Au clavier',
      released: { idle: 'Main rendue : 5 minutes sans frappe.', expired: 'Main rendue : 30 minutes écoulées.', background: 'Main rendue : l’appli est passée en arrière-plan.', pc: 'Le PC a repris la main.', link: 'Main rendue : connexion perdue.' },
      exit: { ended: null, gone: (bot: string) => `Le terminal de ${bot} n’existe plus sur le PC.`, closed: null, superseded: 'Le terminal a été ouvert ailleurs sur cet appareil.', failed: 'Le PC n’a pas pu suivre ce terminal.' },
      refused: { read_only: 'Session démarrée hors de Ledge : ouvre son terminal sur le PC.', unknown_session: 'Cette session n’existe plus sur le PC.', unavailable: 'Le PC ne peut pas montrer ce terminal.' } as Partial<Record<string, string>>,
      holdRefused: { conflict: 'Un autre appareil tape déjà dans ce terminal.', read_only: 'Session démarrée hors de Ledge : tape dans son terminal sur le PC.', unavailable: 'Le PC ne permet plus de taper depuis un appareil lié.' } as Partial<Record<string, string>>,
      sheetTitle: (bot: string) => `Taper dans le terminal de ${bot} ?`,
      sheetBody: 'Ce que tu tapes part tel quel dans son terminal sur le PC, comme au clavier du PC. Cela vaut aussi pour une demande d’autorisation : elle ne passe alors pas par la vérification de l’appareil.',
      sheetNote: 'La main t’est retirée après 5 minutes sans frappe, au bout de 30 minutes, ou dès que l’appli passe en arrière-plan. Le PC affiche le nom de cet appareil « au clavier » et peut la reprendre.',
      go: 'Vérifier et prendre la main', cancel: 'Annuler',
      unprotectedTitle: 'Protège d’abord tes accords depuis Réglages.', unprotectedBody: 'Prendre la main demande la passkey de cet appareil, comme fermer une session.', openConnection: 'Ouvrir Réglages',
      keys: 'Touches spéciales',
      key: { esc: 'Échap', tab: 'Tab', ctrl: 'Ctrl', alt: 'Alt', left: '←', up: '↑', down: '↓', right: '→', enter: '↵', interrupt: '^C', paste: 'Coller', line: 'Ligne' },
      keyLabel: { esc: 'Échap', tab: 'Tabulation', ctrl: 'Contrôle', alt: 'Alt', left: 'Flèche gauche', up: 'Flèche haut', down: 'Flèche bas', right: 'Flèche droite', enter: 'Entrée', interrupt: 'Contrôle C', paste: 'Coller', line: 'Mode ligne' },
      armed: 'armé', locked: 'verrouillé',
      lineField: 'Ligne à taper dans le terminal', lineSend: 'Taper la ligne', withEnter: 'Avec ↵',
      pasteFailed: 'Rien à coller, ou l’appareil a refusé l’accès au presse-papiers.'
    }
  },
  question: {
    legend: 'Choisir une réponse',
    other: 'Autre réponse',
    fieldLabel: (bot: string) => `Ta réponse à ${bot}`,
    placeholder: 'Précise ton choix…',
    long: (max: number) => `La réponse est trop longue (${max} caractères au plus).`,
    untypable: 'La réponse doit tenir sur une ligne, sans saut de ligne ni caractère de contrôle.',
    digit: 'Un chiffre seul serait lu comme le numéro d’une option. Choisis l’option ci-dessus, ou écris la réponse en toutes lettres.'
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
    plan: ['Valide un plan : l’agent passera à l’exécution', 'Après ton accord, l’agent exécute le plan sans redemander chaque étape.'],
    unknown: ['Commande que Ledge ne sait pas analyser', 'Ledge ne peut pas dire ce que cette commande fera. Lis-la attentivement avant de confirmer.']
  },
  risk: {
    badge: 'Impact élevé'
  },
  /** A wide screen's right pane before anything is chosen in the list (docs/mockups/mobile-multi-device.html, part 5). */
  split: {
    request: { title: 'Choisis une demande', body: 'Ses détails et la décision s’ouvrent ici.' },
    agent: { title: 'Choisis un agent', body: 'Son fil et son terminal s’ouvrent ici.' }
  },
  gone: {
    header: 'Demande', title: 'Déjà traitée sur le PC', body: 'Cette demande a été résolue ailleurs. Aucune nouvelle décision n’a été envoyée.', back: 'Retour aux demandes',
    /** Who answered, when the thread says it (docs/mockups/mobile-multi-device.html, part 1). */
    titleOn: (where: string) => `Déjà traitée sur ${where}`, titleElsewhere: 'Déjà traitée ailleurs',
    decided: (what: 'accept' | 'deny' | 'always', time: string) => `${what === 'deny' ? 'Refusée' : 'Acceptée'} à ${time}. Aucune nouvelle décision n’a été envoyée.`,
    answered: (time: string) => `Répondue à ${time}. Aucune nouvelle réponse n’a été envoyée.`,
    staleTitle: 'Cette demande ne figure plus dans le dernier état connu.', staleBody: 'Reconnecte-toi pour vérifier si elle attend toujours une décision.'
  },
  loading: 'Chargement de la demande…',
  connection: {
    /** « Cet appareil » (docs/mockups/mobile-multi-device.html, part 3). */
    device: {
      title: 'Cet appareil', linkedOn: (date: string) => `Lié le ${date}`, rename: 'Renommer', renameLabel: (name: string) => `Renommer ${name}`,
      sheetTitle: 'Nom de cet appareil', sheetBody: 'Il s’affiche sur le PC et dans les fils de tes autres appareils.', field: 'Nom',
      save: 'Enregistrer', cancel: 'Annuler', failed: 'Le PC n’a pas pris le nom. Réessaie.',
      others: 'Les autres appareils liés se gèrent sur le PC, dans Ledge › Réglages › Accès mobile.'
    },
    title: 'Réglages', section: 'Connexion', back: 'Retour à À toi', pc: 'PC', status: 'État', unknown: 'Inconnu',
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
      keepGoing: 'Tes sessions continuent. Le lien se coupe quelques secondes pendant le redémarrage.',
      manual: 'Le PC ne peut pas se mettre à jour seul',
      clone: 'Son daemon tourne depuis un clone git. Mets-le à jour sur le PC, puis redémarre le daemon ici.',
      byHand: 'Mets Ledge à jour sur le PC.',
      restart: 'Redémarrer le daemon', restartHint: 'Sans rien installer. Les sessions continuent.', restartGo: 'Redémarrer',
      updating: (v: string) => `Mise à jour vers ${v}`, restarting: 'Redémarrage du daemon', running: 'En cours',
      steps: { asked: 'Confirmée avec l’appareil', installing: 'Installation par npm', restarting: 'Redémarrage du daemon', back: 'Retour du lien' },
      leave: 'Tu peux quitter l’app : la mise à jour continue sur le PC.',
      done: (v: string) => `Le PC est en ${v}`, restarted: 'Le daemon a redémarré', upToDate: 'À jour', close: 'Fermer',
      failed: 'Le PC n’a pas été mis à jour', notRestarted: 'Le daemon n’a pas redémarré', unchanged: (v: string) => `Rien n’a changé : il reste en ${v}.`, refused: 'Refusé',
      reasons: {
        'sessions-at-risk': 'Redémarrer le daemon arrêterait des sessions qu’il fait tourner lui-même (OMP). Termine-les sur le PC, puis réessaie.',
        'npm-failed': 'npm a échoué sur le PC. Le détail est dans le journal du daemon.',
        busy: 'Une mise à jour est déjà en cours sur le PC.',
        'git-install': 'Son daemon tourne depuis un clone git : mets-le à jour sur le PC.',
        'no-systemd': 'Le PC n’a pas pu redémarrer le daemon : fais-le sur le PC.',
        timeout: 'Le PC ne répond plus. Vérifie-le sur place.'
      } as Record<string, string>,
      retry: 'Réessayer',
      confirmUpdate: 'Mettre à jour le PC ?',
      confirmUpdateBody: (pc: string, from: string, to: string) => `${pc} passe de ${from} à ${to}. npm installe la version, puis le daemon redémarre. Tes sessions continuent.`,
      confirmRestart: 'Redémarrer le daemon ?',
      confirmRestartBody: (pc: string) => `Le daemon de ${pc} redémarre sans rien installer. Tes sessions continuent, et le lien revient en quelques secondes.`,
      passkey: 'La passkey de cet appareil confirme l’action. Sans elle, le PC refuse.',
      noPasskey: 'Protège d’abord les accords avec l’appareil, plus haut.',
      confirm: 'Confirmer', cancel: 'Annuler', notDone: 'Pas fait.'
    }
  },
  /** Réglages: what this device chooses for itself, the PC's shared threshold, and what stays on the PC. */
  settings: {
    appearance: 'Apparence',
    /** The two rows of Apparence, and the languages written in their own language (m0-langue.html, its handoff sheet). */
    theme: 'Thème', lang: 'Langue', langs: { fr: 'Français', en: 'English' },
    motion: 'Réduire les animations', motionHint: 'Désactivé, le réglage de l’appareil s’applique.',
    notifications: 'Notifications sur cet appareil',
    notify: {
      finished: 'Agent terminé', finishedHint: 'Quand un agent a fini son tour.',
      chat: 'Réponse de Ledge', chatHint: 'Quand Ledge a répondu à une question posée d’ici.',
      decision: 'Décision à prendre', decisionHint: 'Quand une session te demande de trancher.',
      always: 'Les demandes d’accord et les questions des agents préviennent toujours, sauf pendant une pause.'
    },
    pause: 'Pause', pauseHint: 'Aucune notification sur cet appareil pendant ce temps.',
    pauseFor: { hour: '1 h', four: '4 h', morning: 'Jusqu’à demain 8 h' },
    pauseLabel: { hour: 'Pause d’une heure', four: 'Pause de quatre heures', morning: 'Pause jusqu’à demain 8 h' },
    pausedUntil: (when: string) => `En pause jusqu’à ${when}`,
    tomorrow: (time: string) => `demain ${time}`,
    resume: 'Reprendre',
    ledge: 'Ledge',
    context: 'Contexte max', contextHint: 'Au-delà, une session est signalée près de sa limite. Partagé avec le PC.',
    chatTool: 'Agent du chat', chatToolHint: 'Celui qui répond à tes questions posées depuis cet appareil.',
    tools: { pc: 'PC', claude: 'Claude', codex: 'Codex', cursor: 'Cursor', omp: 'OMP' } as Record<'pc' | 'claude' | 'codex' | 'cursor' | 'omp', string>,
    toolPcHint: 'PC : le même agent que le chat de Ledge sur le PC.',
    failed: 'Le PC n’a pas pris ce réglage. Réessaie.',
    offline: 'Reconnecte-toi au PC pour changer ces réglages.',
    projects: {
      title: 'Projets',
      agents: (n: number) => (n === 0 ? 'Aucun agent' : n === 1 ? '1 agent' : `${n} agents`),
      folders_note: 'Les règles de rangement et les dossiers des serveurs se règlent sur le PC.',
      folders_note_old: 'Les dossiers d’un projet et les règles de rangement se règlent sur le PC.',
      none: 'Aucun projet pour l’instant.',
      add: 'Nouveau projet', edit: 'Modifier', editLabel: (name: string) => `Modifier ${name}`,
      up: (name: string) => `Monter ${name}`, down: (name: string) => `Descendre ${name}`,
      newTitle: 'Nouveau projet', editTitle: 'Modifier le projet', name: 'Nom', color: 'Couleur',
      colors: { blue: 'Bleu', green: 'Vert', amber: 'Ambre', violet: 'Violet', teal: 'Sarcelle', pink: 'Rose', red: 'Rouge', slate: 'Ardoise' } as Record<'blue' | 'green' | 'amber' | 'violet' | 'teal' | 'pink' | 'red' | 'slate', string>,
      newBody: 'Un projet vide : ses dossiers s’ajoutent sur le PC.',
      save: 'Enregistrer', create: 'Créer', cancel: 'Annuler',
      remove: 'Supprimer le projet…',
      deleteTitle: (name: string) => `Supprimer ${name} ?`,
      deleteAgents: (n: number) => (n === 0 ? 'Aucun agent n’y travaille.' : n === 1 ? '1 agent y travaille.' : `${n} agents y travaillent.`),
      deleteWhere: 'Ses agents, ses dossiers et ses règles :', noProject: 'Sans projet', moveTo: 'Vers un autre projet', target: 'Projet de destination',
      passkey: 'La passkey de cet appareil confirme la suppression.', noPasskey: 'Protège d’abord tes accords, dans la section Connexion.',
      confirmDelete: 'Supprimer',
      folders: 'Dossiers…', foldersTitle: (name: string) => `Dossiers de ${name}`,
      foldersNone: 'Aucun dossier : les agents de ce projet y sont rangés à la main.', foldersLoading: 'Lecture des dossiers…',
      thisPc: 'ce PC', removeFolder: 'Retirer', removeFolderLabel: (path: string) => `Retirer ${path}`,
      addFolder: 'Ajouter un dossier', addShort: 'Ajouter', close: 'Fermer',
      pickTitle: 'Ajouter un dossier', recents: 'Récents', browse: 'Parcourir', parent: 'Dossier parent', open: (name: string) => `Ouvrir ${name}`,
      empty: 'Aucun sous-dossier.', cut: 'Seuls les 500 premiers sous-dossiers sont affichés.', loadingFolder: 'Lecture du dossier…',
      folderErrors: { not_found: 'Ce dossier n’existe pas sur le PC.', not_folder: 'Ce n’est pas un dossier.', unreadable: 'Le PC ne peut pas lire ce dossier.' } as Record<string, string>,
      addThis: 'Ajouter ce dossier', addThisLabel: (path: string) => `Ajouter ${path}`, back: 'Retour',
      folderPasskey: 'La passkey de cet appareil confirme l’ajout.', onlyThisPc: 'Seuls les dossiers de ce PC se parcourent d’ici ; ceux d’un serveur s’ajoutent sur le desktop.',
      errors: {
        name_taken: 'Un autre projet porte déjà ce nom.', stale: 'Les projets ont changé sur le PC. Réessaie.',
        folder_taken: 'Un autre projet a déjà ce dossier.', not_found: 'Ce dossier n’existe plus sur le PC.',
        confirm_required: 'Protège d’abord tes accords, dans la section Connexion.', cancelled: 'Vérification annulée. Rien n’a changé.',
        expired: 'La vérification a expiré. Recommence.', failed: 'Le PC n’a pas pris ce changement. Réessaie.'
      } as Record<string, string>
    },
    managed: 'Réglés sur le PC',
    terminal: 'Taper dans les terminaux', allowed: 'Autorisé', notAllowed: 'Non autorisé',
    managedBody: 'L’accès mobile, les appareils liés, les machines et les règles de rangement se règlent sur le PC, dans Ledge › Réglages. Un appareil ne peut pas élargir ses propres droits.'
  },
  /** The user left while the PC could not confirm that it removed this phone: shown on the screen they land on. */
  forget: {
    pending: 'Le PC n’a pas confirmé. Retire cet appareil dans Ledge sur le PC, section Accès mobile.'
  },
  /** The GitHub login, as the boards write it. */
  account: (login: string) => `@${login}`,
  /** The PC before its first snapshot named it. */
  yourPc: 'ton PC',
  replaced: {
    title: 'Ledge est ouvert ailleurs',
    body: 'Un autre onglet de cet appareil a pris la connexion. Ferme-le, ou reprends la connexion ici.',
    here: 'Utiliser ici'
  },
  insecure: {
    title: 'Connexion non sécurisée',
    body: 'Ledge sur mobile ne s’ouvre que sur une adresse HTTPS. Ouvre l’adresse https:// du serveur.'
  },
  /** The app or its start failed to load (a lost connection mid-update, a blocked storage): no board shows it. */
  bootFailed: {
    title: 'Ledge n’a pas pu démarrer',
    body: 'Le chargement de l’app a échoué. Vérifie la connexion de l’appareil, puis recharge la page.',
    reload: 'Recharger'
  },
  login: {
    title: 'Tes agents, dans la poche',
    subtitle: 'Connecte-toi avec le même compte GitHub que dans Ledge sur ton PC.',
    notes: [
      'Cet appareil crée sa propre clé. Elle ne le quitte jamais.',
      'Rien n’est accessible avant que tu aies confirmé un code sur ton PC.',
      'Le serveur relaie des messages chiffrés : il ne peut ni les lire, ni répondre à ta place.'
    ],
    github: 'Continuer avec GitHub',
    /** What the relay's `?signin=` said went wrong; the boards show none, these are the desktop's words. */
    errors: { denied: 'La connexion a été refusée sur GitHub.', failed: 'La connexion à GitHub a échoué. Réessaie.' }
  },
  /** Confirming a high-impact accept with the device's own check (Face ID, fingerprint, PIN). */
  confirm: {
    heading: 'Confirmer l’autorisation',
    note: 'Une vérification sur ton appareil sera demandée. Elle confirme ton identité, pas la sûreté de la commande.',
    go: 'Confirmer avec mon appareil', goApple: 'Autoriser avec Face ID',
    preparing: 'Préparation de la vérification…',
    asking: 'Vérification en cours sur cet appareil…',
    cancelled: 'Vérification annulée. Rien n’a été envoyé.',
    expired: 'La vérification a expiré. Recommence.',
    failed: 'La vérification de l’appareil n’a pas abouti. Rien n’a été envoyé. Réessaie.',
    prepareFailed: 'La vérification n’a pas pu être préparée. Rien n’a été envoyé.',
    retry: 'Réessayer',
    /** Why the PC or the phone refused a confirmed operation, for the reasons a screen has words for; any other says only that nothing was done. */
    refused: {
      confirm_required: 'La confirmation avec l’appareil est requise.',
      assertion_invalid: 'La vérification de l’appareil a été refusée. Réessaie.',
      conflict: 'Une autre opération est en cours sur le PC. Réessaie.'
    } as Partial<Record<string, string>>
  },
  /** Protecting the high-impact accepts with this device, at pairing and in Connection. */
  enroll: {
    title: 'Protéger les accords',
    body: 'Face ID ou le code de cet appareil sera demandé pour autoriser une commande à impact élevé.',
    go: 'Protéger les accords', later: 'Plus tard',
    done: 'Protégés par cet appareil', row: 'Accords à impact élevé',
    unsupported: 'Cet appareil ne peut pas protéger les accords.'
  },
  notifications: {
    title: 'Être prévenu quand un agent attend', body: 'Active les notifications pour ouvrir une demande directement depuis ton écran verrouillé.',
    enable: 'Activer les notifications', later: 'Plus tard', working: 'Activation…', waiting: 'Connexion au PC…',
    row: 'Notifications', on: 'Activées', off: 'Désactivées',
    denied: 'Notifications refusées. Tu pourras les autoriser dans les réglages de l’appareil.',
    unsupported: 'Ce navigateur ne propose pas les notifications. Sur iPhone, ouvre Ledge depuis son icône de l’écran d’accueil.',
    failed: 'L’activation n’a pas abouti : le PC n’a pas reçu l’abonnement. Vérifie la connexion, puis réessaie.',
    noPush: 'Les notifications ne sont pas disponibles sur ce PC.',
    stale: 'Le PC a changé de clés : réactive les notifications pour que cet appareil les reçoive à nouveau.'
  },
  compare: {
    /** The name this phone gives itself in its `pair_commit`, when its user agent names no known device. */
    deviceLabel: 'Appareil',
    title: 'Compare ce code',
    waitCode: 'En attente du code du PC…',
    codeLabel: (code: string) => `Code de liaison ${code}`,
    intro: (pc: string) => `Ledge vient d’afficher un code sur ${pc}. Il doit être identique à celui-ci.`,
    basis: 'Calculé à partir des clés du PC et de cet appareil',
    same: 'Les codes sont identiques',
    different: 'Ils sont différents',
    waitTitle: 'Confirme sur le PC',
    waitBody: (pc: string, code: string) => `Dans Ledge sur ${pc}, clique sur Approuver sous le même code ${code}.`,
    cancel: 'Annuler',
    /** `model`: the device's kind as the pairing label names it (iPad, iPhone, Android); else « Appareil ». */
    doneTitle: (pc: string, model: string) => `${model} lié à ${pc}`,
    doneBody: 'Tu peux lire, approuver et écrire. Retire cet appareil à tout moment depuis Ledge sur le PC.',
    seePending: 'Voir ce qui attend',
    cancelledTitle: 'Liaison annulée',
    cancelledBody: 'Des codes différents signifient que cet appareil et le PC ne voient pas les mêmes clés. Quelqu’un tente peut-être de s’interposer. Refuse aussi sur le PC.',
    expiredTitle: 'Code expiré',
    expiredBody: 'Le code n’a pas été confirmé à temps sur les deux appareils.',
    refusedTitle: 'Liaison refusée sur le PC',
    refusedBody: 'Ledge sur le PC a refusé cet appareil.',
    lostTitle: 'Cet appareil n’est plus lié',
    lostBody: 'Ses clés ont disparu (données du site effacées ou navigation privée) et le dernier état connu a été effacé avec. Compare un nouveau code pour le lier.',
    /** A pairing was asked and none could start (no key could be made, the link closed): no board shows it. */
    stalledTitle: 'La liaison n’a pas pu démarrer',
    stalledBody: 'Cet appareil n’a pas pu préparer sa clé. Recommence ; si cela persiste, recharge la page.',
    retry: 'Recommencer',
    /** Waiting for the PC's code while it is not on the relay: the pairing starts by itself once it is. */
    offlineTitle: 'PC hors ligne',
    offlineBody: (pc: string) => `Active l’accès mobile dans Ledge sur ${pc} : la liaison démarre dès qu’il est en ligne.`,
    relayTitle: 'Relais injoignable',
    relayBody: 'Cet appareil n’arrive pas à joindre le relais Ledge. Vérifie sa connexion à internet, puis réessaie.',
    retryNow: 'Réessayer'
  },
  denied: {
    title: 'Ce compte n’a pas accès',
    /** The relay's redirect names no account: the board's sentence without the login. */
    bodyNoLogin: 'Ce compte GitHub n’est pas dans la liste de ce serveur. Demande à son administrateur de t’ajouter.',
    other: 'Utiliser un autre compte'
  },
  keyChanged: {
    title: (pc: string) => `La clé de ${pc} a changé`,
    body: 'Cet appareil a coupé la connexion. Il n’envoie plus rien et n’affiche plus rien de ce PC tant que tu n’as pas refait la liaison.',
    known: 'Connue', received: 'Reçue',
    knownDetail: (fp: string, date: string) => `${fp} · liée le ${date}`,
    receivedDetail: (fp: string) => `${fp} · inconnue`,
    reinstalledTitle: 'Tu as réinstallé Ledge ou changé de PC ?',
    reinstalledBody: 'C’est normal : refais la liaison et compare le nouveau code.',
    otherwise: 'Sinon,',
    warning: 'ne va pas plus loin et préviens l’administrateur du serveur.',
    relink: 'Refaire la liaison',
    signOut: 'Se déconnecter'
  },
  /** The PC answered a hello with `denied` (this phone was removed in Ledge on the PC): no board shows it, KeyChanged is the model. */
  unrecognized: {
    title: (pc: string | null) => `${pc ?? 'Ton PC'} ne reconnaît plus cet appareil`,
    body: 'Cet appareil a sans doute été retiré dans Ledge sur le PC. Il n’envoie plus rien à ce PC.',
    kept: 'Le dernier état connu et tes brouillons restent sur cet appareil. Refaire la liaison les efface et fait comparer un nouveau code.',
    relink: 'Refaire la liaison',
    signOut: 'Se déconnecter'
  },
  /** The key store could not be read (a lost IndexedDB connection): no board shows it. Nothing was erased. */
  storage: {
    title: 'Stockage de l’appareil illisible',
    body: 'Le navigateur n’a pas pu lire les clés de cet appareil. Rien n’a été effacé : réessaie, ou recharge la page.',
    retry: 'Réessayer',
    reload: 'Recharger'
  },
  update: {
    title: 'Nouvelle version',
    version: (v: string) => `Nouvelle version · ${v}`,
    body: 'Le serveur propose une mise à jour de l’app. Rien ne change tant que tu ne l’acceptes pas.',
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
    title: (pc: string | null) => pc ? `${pc} ne répond plus` : 'Ton PC ne répond plus',
    body: (t: string) => `Le PC est sans doute en veille depuis ${t}. Ledge n’envoie aucune décision plus tard à ta place : une demande peut avoir changé entre-temps.`,
    /** The board's sentence when no state was ever received, so no time to give. */
    bodyUnknown: 'Le PC est sans doute en veille. Ledge n’envoie aucune décision plus tard à ta place : une demande peut avoir changé entre-temps.',
    retry: 'Réessayer',
    seen: (when: string) => `vu à ${when}`,
    badge: 'Hors ligne',
    pcOffline: 'PC hors ligne'
  },
  /** The shared mascots' words (@ledge/ui UiCopy): its French defaults say « vous », the phone says « tu » (question Q1). */
  ui: {
    stateLabel: { approval: 'Ton accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' },
    botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend ton accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' },
    botReadOnly: 'Lecture seule', botNotLive: 'Figé', residentName: 'Ledge', residentOffline: 'Ledge · connexion perdue'
  },
  /** The host pill of the header (m0-socle.html, §1): the PC's name, « hors ligne » when it does not answer. */
  host: {
    unknown: 'PC',
    offline: (pc: string) => `${pc} · hors ligne`,
    label: (pc: string, look: 'online' | 'reconnecting' | 'offline' | 'loading') =>
      `${pc} : ${look === 'online' ? 'connecté' : look === 'offline' ? 'hors ligne' : 'connexion…'}. Ouvrir Réglages › Connexion`
  },
  /** MR/PR before the PC sends them (m0-socle.html, §3, answer A of question Q3). */
  prs: {
    title: 'MR et PR', subtitle: 'GitHub · GitLab',
    notSent: (pc: string) => `${pc} ne transmet pas encore ses MR et PR à cet appareil`,
    notSentBody: 'Ledge suit les branches des sessions et des sièges. Leurs MR, PR et pipelines s’afficheront ici une fois Ledge mis à jour sur le PC.',
    tracked: 'Suivies : les branches des sessions et des sièges, via gh et glab.',
    pane: { title: 'Rien à afficher', body: 'Une MR ou une PR et son pipeline s’ouvrent ici.' }
  },
  /** Rigs before the PC sends them (m0-socle.html, §2 and §3). */
  rigs: {
    title: 'Rigs', subtitle: 'OpenRig',
    notSent: (pc: string) => `${pc} ne transmet pas encore ses rigs à cet appareil`,
    notSentBody: 'Les rigs, leurs sièges et leur file arrivent avec une prochaine version de Ledge sur le PC. Leurs demandes arrivent déjà dans « À toi ».',
    seeAtoi: 'Voir « À toi »',
    pane: { title: 'Rien à afficher', body: 'Les sièges et la topologie d’un rig s’ouvrent ici.' }
  },
  /** The Atelier on iPad (docs/mockups/ledge-ipad-atelier.html): the PC's rooms, tables and agents, as Ledge Desktop draws them. */
  atelier: {
    title: 'Atelier',
    subtitle: (agents: number, rooms: number, waiting: number) =>
      `${agents} ${agents > 1 ? 'agents' : 'agent'} · ${rooms} ${rooms > 1 ? 'pièces' : 'pièce'}${waiting ? ` · ${waiting} ${waiting > 1 ? 'attendent' : 'attend'}` : ''}`,
    region: 'Atelier',
    fullScreen: 'Plein écran', closePanel: 'Fermer le panneau', closeTitle: 'Fermer',
    session: (name: string) => `Session de ${name}`,
    room: (name: string) => `Pièce ${name}`,
    roomAgents: (n: number) => `${n} ${n > 1 ? 'agents' : 'agent'}`,
    ompNoThread: 'Pas de fil pour ce siège.',
    ompBody: 'Ledge ne lit pas la conversation d’un siège OMP lancé par OpenRig. Son terminal montre son écran.',
    ompTerminal: 'Ouvrir son terminal',
    /** The thread's card in the panel: the request opens there, not in « À traiter » (design-ux 12:17Z). */
    awaiting: 'Décision attendue',
    /** Ledge Desktop's words for the same drawing (apps/desktop/src/i18n/fr.ts: atelier, rooms, zoom). */
    table: (name: string) => `Table ${name}`,
    conversations: (name: string) => `Agents de la pièce ${name}`,
    seat: (name: string, task: string) => `${name}, ${task}`,
    helperSeat: (kind: string, parent: string, task: string) => `${kind}, sous-agent de ${parent} : ${task}`,
    desk: 'Parler à Ledge',
    watching: (n: number) => `Je veille sur ${n} ${n > 1 ? 'agents' : 'agent'}.`,
    assistant: 'Ton assistant',
    unassigned: 'Sans projet',
    unassignedHint: 'Ledge ne relie ces sessions à aucun projet. On les range depuis le PC.',
    legend: { working: 'En cours', approval: 'Ton accord', question: 'Une question', done: 'Terminé ou hors ligne', helper: 'Un petit bot est un sous-agent.' },
    plaqueCounts: (n: number) => `${n} ${n > 1 ? 'sessions' : 'session'}`,
    waiting: (n: number) => `${n} ${n > 1 ? 'attendent' : 'attend'}`,
    working: (n: number) => `${n} au travail`,
    roomMenu: (name: string) => `Agents de la pièce ${name}`,
    rigRoom: (kind: 'rig' | 'kernel', name: string) => (kind === 'kernel' ? 'Salle du kernel OpenRig' : `Salle du rig ${name}`),
    kernel: 'Kernel', kernelWhere: 'OpenRig · opérateur, advisor, file',
    /** docs/mockups/ledge-ipad-atelier.html (cd66c403): the folder's name, the phone has no path. */
    rigWhere: (folder: string, project: string | null) => ['rig', folder, project ? `projet ${project}` : ''].filter(Boolean).join(' · '),
    entrance: 'ENTRÉE',
    more: (n: number) => `+${n} à cette table`,
    zoom: { bar: 'Zoom de l’atelier', out: 'Dézoomer', in: 'Zoomer', reset: 'Revenir à 100 %', fit: 'Ajuster', fitTitle: 'Revenir à la vue lisible' }
  }
} as const;

/** A table's shape with its words widened: what every language's table has, string for string. */
type Widen<T> = T extends string ? string
  : T extends (...args: infer A) => infer R ? (...args: A) => Widen<R>
  : T extends readonly unknown[] ? { readonly [K in keyof T]: Widen<T[K]> }
  : T extends object ? { readonly [K in keyof T]: Widen<T[K]> }
  : T;
export type Copy = Widen<typeof fr>;

export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
const tables: Record<Lang, Copy> = { fr, en };
export const copyFor = (l: Lang): Copy => tables[l];

/** Desktop's language mechanism (m0-langue.html): kept on this device under `mobile.lang`, French when nothing is chosen. */
const i18n = createI18n<Lang, Copy>({ langs: LANGS, messages: tables, fallback: 'fr', prefix: 'mobile', uiCopy: m => m.ui });
export const loadLang = i18n.loadLang;

/** The language shown, and its dates (fr-FR, en-GB, as Desktop): live bindings, changed by setLang. */
export let lang: Lang = loadLang();
export let locale = localeOf(lang);
function localeOf(l: Lang): string { return l === 'fr' ? 'fr-FR' : 'en-GB'; }

/**
 * Every string of the language shown. A view of the current table, not a copy: `copy.x.y` read at render, or kept in a
 * module's `const C = copy.x`, gives the words of the language chosen since, without a reload (m0-langue.html, §2).
 */
function view(path: readonly string[]): object {
  const at = (): Record<string, unknown> => path.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, tables[lang] as unknown as Record<string, unknown>);
  return new Proxy({}, {
    get: (_, k) => {
      const v = at()[k as string];
      return v && typeof v === 'object' && !Array.isArray(v) && typeof k === 'string' ? view([...path, k]) : v;
    },
    has: (_, k) => k in at(),
    ownKeys: () => Reflect.ownKeys(at()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(at(), k);
      return d && { ...d, configurable: true, value: (view(path) as Record<string | symbol, unknown>)[k] };
    }
  });
}
export const copy = view([]) as Copy;

const listeners = new Set<() => void>();
/** Shows the app in `l` at once and keeps the choice on this device. */
export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l; locale = localeOf(l);
  i18n.saveLang(l);
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach(f => f());
}
/** For useSyncExternalStore: the app renders again in the new language. */
export function onLang(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
/** The language shown; a component that calls it renders again, with its whole tree, when it changes. */
export function useLang(): Lang { return useSyncExternalStore(onLang, () => lang); }
