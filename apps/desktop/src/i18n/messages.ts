import type { BotState } from '@ledge/ui/bots/poseFor';
import type { SectionId } from '../nav/state';
import type { Bucket, GroupBy } from '../list/model';
import type { ToolStatus } from '@ledge/protocol';
import type { PlanDoc, ToolKind, Verb } from '../session/thread';
import type { Change } from '../session/changes';
import type { TodoStatus } from '../session/todos';

type PlanStatus = PlanDoc['status'];

/** French counts 0 and 1 as singular, English only 1. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const pluralEn = (n: number, one: string, many: string) => (n === 1 ? one : many);

const fr = {
  side: {
    label: 'Barre latérale', newSession: 'Nouvelle session', search: 'Rechercher', searchLabel: 'Rechercher une session',
    views: 'Vues', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projets', newProject: 'Nouveau projet', unassigned: 'Sans projet',
    machines: 'Machines', manageMachines: 'Gérer les machines', agents: (n: number) => plural(n, `${n} agent`, `${n} agents`), offline: 'hors ligne', settings: 'Réglages'
  },
  crumb: { atelier: 'Atelier', list: 'Liste', settings: 'Réglages', clearFilter: 'Retirer le filtre : voir tous les projets', clearFilterTitle: 'Tous les projets (Échap)', escape: 'Échap', openParent: (n: string) => `Ouvrir la conversation de ${n}` },
  top: {
    viewTabs: 'Vue des agents', helpersHide: 'Masquer les sous-agents', helpersShow: 'Afficher les sous-agents', pause: 'Figer les animations', play: 'Animer',
    search: 'Rechercher une session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Raccourcis clavier (?)', fullscreen: 'Plein écran', fullscreenExit: 'Quitter le plein écran',
    terminalShow: 'Afficher le terminal', terminalHide: 'Masquer le terminal', terminalShowTitle: 'Afficher le terminal (O)', terminalHideTitle: 'Masquer le terminal (O)'
  },
  foot: { sessions: 'Sessions locales et SSH', search: 'Une session', chat: 'Chat Ledge', shortcuts: 'Raccourcis' },
  sections: { general: 'Général', appearance: 'Apparence', notifications: 'Notifications', sounds: 'Sons', machines: 'Machines', projects: 'Projets', shortcuts: 'Raccourcis', about: 'À propos' } as Record<SectionId, string>,
  pending: 'Cet écran arrive bientôt.',
  close: 'Fermer',
  modalTitles: { launch: 'Nouvelle session', project: 'Nouveau projet', editProject: 'Modifier le projet' },
  search: {
    title: 'Aller à une session', placeholder: 'Agent, tâche, projet ou machine…', empty: 'Aucune session ne correspond à cette recherche.', results: 'Sessions',
    browse: 'Parcourir', open: 'Ouvrir', closeKey: 'Fermer', enter: 'Entrée', escape: 'Échap'
  },
  shortcuts: {
    title: 'Raccourcis clavier',
    intro: 'Actifs lorsque la fenêtre a le focus. Les touches de navigation restent disponibles pour la saisie et le terminal lorsqu’ils ont le focus.',
    outro: 'Ctrl / ⌘ K ouvre la recherche depuis n’importe quelle vue. Y et N n’agissent que sur la demande épinglée de la session ouverte, jamais pendant la saisie.',
    rows: [['Ctrl / ⌘ K','Rechercher et ouvrir une session'],['Ctrl ,','Ouvrir les réglages'],['Alt 1…9','Accès direct aux sessions principales'],['Alt ← / →','Session précédente / suivante'],['J / K ou ↓ / ↑','Parcourir les sessions (atelier ou liste)'],['F','Filtrer la liste'],['Entrée','Ouvrir la session sélectionnée'],['N','Nouvelle session'],['+ / −','Zoomer / dézoomer l’atelier'],['0','Ajuster l’atelier à l’écran'],['Ctrl + molette','Zoomer sous le pointeur'],['Espace + glisser','Déplacer la vue'],['/','Ouvrir le chat Ledge'],['R','Écrire une réponse à l’agent'],['Y / N','Autoriser / refuser la demande en attente'],['1…9','Choisir une réponse proposée'],['J / K','Fichier suivant / précédent (Modifications)'],['O','Afficher ou masquer le terminal'],['Échap','Fermer le panneau ou revenir à l’atelier'],['?','Afficher ces raccourcis']] as ReadonlyArray<readonly [string, string]>
  },
  tray: { open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', dndOff: 'Réactiver les alertes', quit: 'Quitter Ledge Desktop' },
  notify: {
    approval: (name: string) => `${name} attend votre accord`,
    question: (name: string) => `${name} a une question`,
    finished: (name: string) => `${name} a terminé`,
    failed: (name: string) => `${name} a rencontré une erreur`,
    manyTitle: 'Votre équipe',
    many: (n: number) => `${n} sessions vous attendent ou ont terminé`
  },
  atelier: {
    table: (name: string) => `Table ${name}`,
    conversations: (name: string) => `Conversations du projet ${name}`,
    actions: (name: string) => `Actions du projet ${name}`, actionsTitle: 'Actions du projet',
    edit: 'Modifier le projet',
    newSession: 'Nouvelle session', newSessionAt: (name: string) => `Nouvelle session à la table ${name}`,
    isolate: (name: string) => `Isoler le projet ${name}`, isolateLabel: 'Isoler cette table', showAll: 'Voir tous les projets',
    more: (n: number) => `+${n} à cette table`, moreTitle: 'Voir tous les agents du projet dans la liste',
    seat: (name: string, task: string, machine: string) => `${name}, ${task}, ${machine}`,
    helperSeat: (kind: string, parent: string, task: string) => `${kind}, sous-agent de ${parent} : ${task}`,
    offline: 'Hors ligne',
    desk: 'Parler à Ledge',
    watching: (n: number) => plural(n, `Je veille sur ${n} agent.`, `Je veille sur ${n} agents.`),
    listening: 'Je vous écoute.',
    assistant: 'Votre assistant',
    unassignedHint: 'Ledge ne relie ces sessions à aucun projet. Glissez-les vers une table, ou utilisez « Ranger dans… ».',
    empty: {
      title: (name: string) => `Aucun agent à la table ${name}`,
      body: (where: string) => `La table apparaîtra dès qu'une session démarre dans ${where}.`,
      noRepo: 'ce projet'
    },
    legend: { working: 'En cours', approval: 'Votre accord', question: 'Une question', done: 'Terminé ou hors ligne', helper: 'Un petit bot est un sous-agent.' }
  },
  filing: {
    moveTo: 'Ranger dans…', newProject: 'Nouveau projet…', from: (folder: string) => `À partir de ${folder}`,
    grip: 'Glisser vers une table pour le ranger',
    dropHelp: (name: string) => `Déposez sur un projet pour y ranger ${name}.`,
    dropHere: 'Déposer ici', dropNow: (name: string) => `Lâcher pour asseoir ${name}`,
    joined: (name: string, table: string) => `${name} rejoint la table ${table}. Ledge s'en souviendra pour ce dossier.`,
    offline: (name: string) => `Impossible de ranger ${name} : le daemon Ledge local n'est pas joignable.`,
    outdated: (name: string) => `Impossible de ranger ${name} : mettez à jour le daemon Ledge local, il ne connaît pas encore les projets.`,
    invalid: (name: string) => `Impossible de ranger ${name} : Ledge ne peut pas mémoriser ce dossier.`,
    unconfirmed: (name: string) => `${name} n'a pas été rangé : Ledge n'a pas confirmé. Réessayez.`
  },
  zoom: {
    bar: "Zoom de l'atelier", out: 'Dézoomer', outTitle: 'Dézoomer (−)', in: 'Zoomer', inTitle: 'Zoomer (+)',
    reset: 'Revenir à 100 %', fit: 'Ajuster', fitTitle: 'Tout voir (0)', hint: 'Ctrl + molette · glisser le sol · double-clic sur une table'
  },
  list: {
    buckets: { decide: 'À décider', running: 'En cours', done: 'Terminés', offline: 'Hors ligne' } as Record<Bucket, string>,
    filter: 'Filtrer les sessions', filterPlaceholder: 'Agent, tâche, machine, dépôt…', clearFilter: 'Effacer le filtre',
    chips: 'Filtrer par état', all: 'Tous',
    groupBy: 'Grouper par', groupLabel: 'Grouper', groups: { project: 'Projet', machine: 'Machine', state: 'État' } as Record<GroupBy, string>,
    comfy: 'Lignes confortables', tight: 'Lignes compactes',
    collapse: (name: string) => `Replier ${name}`, expand: (name: string) => `Déplier ${name}`, only: (name: string) => `Voir seulement ${name}`,
    branch: (b: string) => `Branche ${b}`,
    newSessionIn: (name: string) => `Nouvelle session dans ${name}`,
    tally: {
      decide: (n: number) => `${n} à décider`, running: (n: number) => `${n} en cours`,
      done: (n: number) => plural(n, `${n} terminé`, `${n} terminés`), offline: (n: number) => `${n} hors ligne`
    } as Record<Bucket, (n: number) => string>,
    unassignedHelp: 'Glissez vers un projet, ou « Ranger dans… ».',
    grip: 'Glisser vers un projet',
    dropHelp: 'Déposez sur un projet de la barre latérale ou sur son groupe.',
    dropNow: (name: string) => `Lâcher pour ranger ${name}`,
    row: (name: string, task: string, state: string, ctx: string) => `${name}, ${task}, ${state}, ${ctx}`,
    kids: {
      show: (n: number) => plural(n, `Afficher ${n} sous-agent`, `Afficher ${n} sous-agents`),
      hide: (n: number) => plural(n, `Masquer ${n} sous-agent`, `Masquer ${n} sous-agents`),
      count: (n: number) => plural(n, `${n} sous-agent`, `${n} sous-agents`)
    },
    empty: {
      projectTitle: (name: string) => `Aucune session dans ${name}`,
      projectBody: (where: string) => `Le projet se remplira dès qu’une session démarre dans ${where}.`,
      noneTitle: 'Aucune session', noneBody: 'Lancez une session pour la voir ici.',
      noMatch: 'Aucune session ne correspond', clear: 'Effacer les filtres',
      /** `chip`: the chosen chip's label in lower case, null for « Tous ». `none`: « Sans projet » when that project filter is on and nothing else narrows the List. */
      noMatchBody: (q: string, chip: string | null, none: string | null = null) => (!q && !chip && none ? `Rien dans « ${none} ».` : q && chip ? `Rien pour « ${q} » parmi les sessions « ${chip} ».` : q ? `Rien pour « ${q} ».` : `Rien parmi les sessions « ${chip} ».`)
    },
    foot: { walk: 'parcourir', open: 'ouvrir', filter: 'filtrer', note: 'les demandes en attente passent en tête de chaque groupe.' },
    enter: 'Entrée',
    allow: 'Autoriser', deny: 'Refuser', reply: 'Répondre', open: 'Ouvrir', openTitle: 'Ouvrir la session (Entrée)',
    when: {
      now: 'à l’instant', wait: (d: string) => `depuis ${d}`, ago: (d: string) => `il y a ${d}`,
      requestNow: 'Demande reçue à l’instant', waitTitle: (d: string) => `En attente depuis ${d}`,
      activityNow: 'Dernière activité à l’instant', activityAgo: (d: string) => `Dernière activité il y a ${d}`,
      seenAgo: (d: string) => `Vu pour la dernière fois il y a ${d}`,
      units: { min: 'min', h: 'h', d: 'j' }
    }
  },
  decisions: {
    failed: (name: string, message: string) => `Décision non transmise à ${name} : ${message}`,
    unconfirmed: (name: string) => `Ledge n’a pas vu la décision pour ${name} aboutir. Ouvrez la session pour vérifier.`,
    replyFailed: (name: string, message: string) => `Réponse non transmise à ${name} : ${message}`,
    replyUnconfirmed: (name: string) => `Ledge n’a pas vu la réponse à ${name} aboutir. Vérifiez le fil.`,
    noteNotTyped: 'Refusé, mais la note n’a pas pu être tapée.'
  },
  session: {
    meta: 'Machine et dépôts',
    subagent: 'Sous-agent',
    rail: {
      label: (p: string) => `Agents du projet ${p}`, kids: (n: number) => `Sous-agents · ${n}`, kidsOf: (n: string) => `Sous-agents de ${n}`, newHere: 'Nouvelle session ici'
    },
    kidsPill: (n: number) => plural(n, `${n} sous-agent`, `${n} sous-agents`), kidsPillTitle: 'Voir les sous-agents dans la colonne',
    views: { label: 'Vue de la session', thread: 'Fil', changes: 'Modifications' },
    changes: {
      files: 'Fichiers modifiés', count: (n: number) => plural(n, `${n} fichier`, `${n} fichiers`), toggle: (n: number) => `Fichiers · ${n}`,
      labels: { add: 'Ajouté', edit: 'Modifié', write: 'Réécrit', delete: 'Supprimé', rename: 'Renommé' } as Record<Change, string>,
      letters: { add: 'A', edit: 'M', write: 'M', delete: 'D', rename: 'R' } as Record<Change, string>,
      empty: 'Aucun fichier modifié', emptyCursor: 'Cursor Agent ne transmet pas les fichiers qu’il touche.',
      emptyBody: (n: string) => `${n} n’a encore rien modifié dans cette session.`,
      copy: 'Copier le chemin', copied: (p: string) => `Chemin copié : ${p}`,
      prev: 'Fichier précédent', next: 'Fichier suivant',
      createdBy: 'Créé par', changedBy: 'Modifié par', turn: (n: number) => `tour ${n}`, seeInThread: '· voir dans le fil',
      diff: 'Différences',
      gap: (n: number, a: number, b: number) => plural(n, `⋯ ${n} ligne non modifiée (ligne ${a})`, `⋯ ${n} lignes non modifiées (lignes ${a}–${b})`),
      unfold: (n: number) => plural(n, `Afficher ${n} ligne inchangée`, `Afficher ${n} lignes inchangées`),
      cut: 'Diff limité aux 80 premières lignes.', noDiff: 'Ce fichier n’a pas de différence enregistrée.',
      noTouchDiff: 'Pas de différence enregistrée pour cette action.',
      // Said to a screen reader in place of a line's + or −.
      signs: { add: 'ajouté', del: 'supprimé' }
    },
    pane: {
      label: 'Volet de lecture', tabs: 'Documents ouverts', closeTab: (l: string) => `Fermer ${l}`,
      grow: 'Agrandir', shrink: 'Réduire', growTitle: 'Agrandir le volet (65 %)', shrinkTitle: 'Réduire le volet (50 %)',
      close: 'Fermer', closeTitle: 'Fermer le volet (Échap)', closeShort: 'Fermer (Échap)',
      resize: 'Redimensionner le volet', allChanges: 'Toutes les modifications',
      diffTitle: (f: string) => `Modification · ${f}`, diffLabel: (f: string) => `± ${f}`,
      reading: 'Lecture du document…',
      errors: {
        not_found: 'Document introuvable.', too_large: 'Document trop volumineux (1 Mo au plus).',
        offline: 'La machine est hors ligne : le document ne peut pas être lu.', timeout: 'Le document n’est pas arrivé à temps.',
        other: 'Le document n’a pas pu être lu.'
      } as Record<'not_found' | 'too_large' | 'offline' | 'timeout' | 'other', string>
    },
    terminal: {
      title: 'Terminal', empty: 'Aucune sortie reçue pour l’instant.', readOnly: 'Aperçu en lecture seule', offline: 'Hors ligne',
      open: 'Ouvrir dans un terminal', openFailed: (n: string) => `Le terminal de ${n} n’a pas pu s’ouvrir.`
    },
    pending: {
      regions: { approval: 'Autorisation demandée', plan: 'Plan à approuver', question: 'Question de l’agent' } as Record<'approval' | 'plan' | 'question', string>,
      command: (n: string) => `${n} veut exécuter une commande`, edit: (n: string) => `${n} veut modifier un fichier`, approval: (n: string) => `${n} veut votre accord`,
      question: (n: string) => `${n} vous pose une question`, plan: (n: string, title: string) => `${n} propose un plan · ${title}`, planBadge: 'Plan à approuver',
      allow: 'Autoriser', deny: 'Refuser', always: 'Toujours autoriser pour cette session', alwaysProject: 'Toujours autoriser dans ce projet',
      approvePlan: 'Approuver le plan', keepPlanning: 'Continuer à planifier', approveAuto: 'Approuver en mode automatique',
      // What « always » really grants, in the button's title (adapters/claude.ts, codex.ts: the option each one picks).
      alwaysScope: {
        project: 'Claude Code enregistre la règle dans les réglages du projet : elle vaut aussi pour ses prochaines sessions dans ce projet.',
        edits: 'Claude Code passe en acceptation automatique des modifications pour toute la session : chaque modification suivante sera acceptée sans vous être demandée.',
        session: 'L’agent ne redemande plus pour cette commande ou ces fichiers jusqu’à la fin de la session.',
        plan: 'Claude Code passe en mode auto, qui répond seul aux demandes suivantes, commandes comprises. Sur les versions sans mode auto (avant 2.1), il accepte les modifications automatiquement.'
      } as Record<'project' | 'edits' | 'session' | 'plan', string>,
      relay: (p: string) => `C’est ${p} qui transmet cette décision.`, relayAnswer: (p: string) => `${p} relaiera votre réponse.`,
      revise: 'Écrivez ce qu’il faut revoir, puis Entrée.', reviseKey: 'Écrivez ce qu’il faut revoir, puis Entrée : le plan repart en préparation.'
    },
    reply: {
      label: 'Répondre à l’agent', send: 'Envoyer', denyWith: 'Refuser avec ce message',
      placeholder: {
        plan: 'Ce qu’il faut revoir dans le plan… (Entrée : continuer à planifier)', approval: 'Ou refusez en expliquant quoi faire autrement…',
        question: (n: string) => `Ou répondez librement à ${n}…`, done: (n: string) => `Relancer ${n} avec une nouvelle consigne…`, idle: (n: string) => `Répondre à ${n}…`
      },
      denyHint: 'Entrée refuse avec ce message', planHint: 'Entrée renvoie le plan en préparation', write: 'écrire',
      offline: (m: string) => `${m} est hors ligne.`, offlineBody: ' Le fil est figé à la dernière activité connue ; vous pourrez répondre à la reconnexion.', seeMachine: 'Voir la machine',
      viaParent: (n: string, p: string) => `Les réponses à ${n} passent par ${p}, qui l’a lancé.`, openParent: (p: string) => `Ouvrir ${p}`,
      readOnly: 'Session démarrée sans Ledge : lecture seule.', optionsOnly: 'Choisissez une des réponses proposées (1–9).',
      noNote: 'Cet agent ne prend pas de message avec un refus : refusez avec N.', tooLong: (max: number) => `Une note tient en ${max} caractères au plus.`
    },
    thread: {
      label: 'Fil de la session',
      you: 'Vous', fromParent: (n: string) => `Consigne de ${n}`,
      exchange: (at: string) => `Échange de ${at}`, live: 'en cours',
      actions: (n: number) => plural(n, `${n} action`, `${n} actions`),
      kinds: {
        read: (n: number) => plural(n, `${n} lecture`, `${n} lectures`), search: (n: number) => plural(n, `${n} recherche`, `${n} recherches`),
        command: (n: number) => plural(n, `${n} commande`, `${n} commandes`), edit: (n: number) => plural(n, `${n} modification`, `${n} modifications`)
      } as Record<ToolKind, (n: number) => string>,
      files: (n: number) => plural(n, `· ${n} fichier modifié`, `· ${n} fichiers modifiés`),
      failed: (n: number) => plural(n, `· ${n} échec`, `· ${n} échecs`),
      cut: (n: number) => plural(n, `· ${n} interrompue`, `· ${n} interrompues`),
      running: 'en cours · ', interrupted: 'interrompu', liveAction: 'Action en cours',
      marks: { running: 'En cours', success: 'Réussi', failed: 'Échec', unknown: 'Interrompu' } as Record<ToolStatus, string>,
      verbs: { create: 'Création', delete: 'Suppression', read: 'Lecture', search: 'Recherche', command: 'Commande', edit: 'Modification' } as Record<Verb, string>,
      // `unknown` : seul un historique écrit avant le lot 6b le porte (un Decided sans décision ne marque plus de permission).
      decided: { accept: 'Accordé', always: 'Toujours autorisé', deny: 'Refusé', unknown: 'Répondu dans le terminal' } as Record<'accept' | 'always' | 'deny' | 'unknown', string>,
      helperLaunched: 'Sous-agent lancé', openHelper: (n: string, task: string) => `Ouvrir ${n} : ${task}`,
      seeChange: 'Voir la modification', seeChangeShort: 'Voir',
      read: 'Lire',
      unread: 'Nouveau depuis votre dernière visite', latest: 'Aller au dernier message',
      lost: (m: string) => `Connexion perdue avec ${m}`,
      lostBody: 'Le fil est figé : ce qui suit est le dernier état connu, l’activité actuelle n’est pas connue.',
      frozenEnd: (s: string) => `Plus aucune nouvelle depuis la perte de connexion · ${s}`, ended: (s: string) => `Session terminée · ${s}`,
      loading: 'Chargement du fil…', empty: 'Rien dans le fil pour l’instant.', notLoaded: 'Le fil n’a pas été chargé avant la perte de connexion.'
    },
    plan: {
      kicker: 'Plan proposé', fallback: 'Plan',
      statuses: { proposed: 'En attente de votre accord', open: 'Proposé', approved: 'Approuvé', revised: 'Révisé ensuite' } as Record<PlanStatus, string>,
      more: (n: number) => plural(n, `… et ${n} autre étape`, `… et ${n} autres étapes`), steps: (n: number) => plural(n, `${n} étape`, `${n} étapes`),
      readPlan: 'Lire le plan', openBeside: 'Ouvert à côté',
      approved: 'Plan approuvé', approvedAuto: 'Plan approuvé · mode automatique', toRevise: 'Plan à revoir',
      by: (n: string) => `Plan proposé par ${n}`, tab: (t: string) => `Plan · ${t}`,
      // « Répondez sous le fil : [Y] approuver · [N] continuer à planifier », the keys drawn as keys.
      answerHint: { lead: 'Répondez sous le fil :', approve: 'approuver', keep: 'continuer à planifier' },
      summary: (n: number, s: string) => plural(n, `${n} étape : ${s}`, `${n} étapes : ${s}`)
    },
    todos: {
      workPlan: 'Plan de travail', workPlanUpdated: 'Plan de travail mis à jour', updated: 'plan de travail mis à jour',
      allDone: 'Tout est fait', paused: 'En pause',
      doneOf: (d: number, n: number) => `${d}/${n} faites`, inProgress: (t: string) => `en cours : ${t}`,
      boxes: { completed: 'Fait', in_progress: 'En cours', pending: 'À faire' } as Record<TodoStatus, string>
    }
  },
  launch: {
    prompt: 'Consigne', placeholder: 'Que doit faire l’agent ? Décrivez le résultat attendu.',
    suggestions: 'Suggestions', ideas: ['Relire la dernière pull request', 'Corriger les tests qui échouent', 'Mettre à jour la documentation'] as readonly string[],
    agent: 'Agent',
    tools: { claude: ['Claude Code', 'Conception, revue'], codex: ['Codex', 'Code et tests'], cursor: ['Cursor Agent', 'Dans l’éditeur'] } as Record<'claude' | 'codex' | 'cursor', readonly [string, string]>,
    project: 'Projet', machine: 'Machine', offline: 'hors ligne', offlineTitle: 'Hors ligne : reconnectez la machine dans les réglages',
    repos: (m: string) => `Dépôts sur ${m}`, noGit: 'Dossier sans Git', notFound: 'introuvable', oneRepo: (t: string) => `Un seul dépôt pour ${t}`,
    noRepos: (p: string, m: string) => `Aucun dépôt de ${p} sur ${m}.`, editProject: 'Modifier le projet',
    noProjects: 'Aucun projet pour l’instant.', noProjectsBody: 'Créez un projet pour y lancer des agents.', newProject: 'Nouveau projet',
    newAgent: 'Un nouvel agent', joins: (n: string, t: string) => `${n} rejoindra la table ${t}`, seat: (n: number, m: string, r: string) => `Place ${n} · ${m} · ${r}`, noRepo: 'aucun dépôt',
    missing: { tool: 'Choisissez un agent', prompt: 'Écrivez la consigne', machine: 'Aucune machine en ligne', repos: 'Choisissez au moins un dépôt' } as Record<'tool' | 'prompt' | 'machine' | 'repos', string>,
    cancel: 'Annuler', launch: 'Lancer', launching: 'Lancement…',
    started: (n: string, t: string) => `${n} démarre à la table ${t}.`, refused: (m: string) => `Démarrage refusé : ${m}`,
    timeout: 'Le démarrage n’a pas répondu. Vérifiez la machine puis réessayez.'
  },
  projects: {
    picker: {
      machines: 'Machine à parcourir', offline: 'hors ligne',
      offlineBody: (m: string) => `${m} est hors ligne. Reconnectez-la dans Réglages › Machines pour parcourir ses dossiers.`,
      crumbs: 'Dossier courant', root: 'racine', parent: 'Dossier parent', contents: (d: string, m: string) => `Contenu de ${d} sur ${m}`,
      open: (n: string) => `Ouvrir ${n}`,
      noGit: 'sans Git', add: 'Ajouter', added: 'Ajouté', addLabel: (n: string, m: string) => `Ajouter ${n} (${m})`, addedLabel: (n: string) => `${n} déjà ajouté`,
      typed: (m: string) => `Chemin sur ${m}`, typedPlaceholder: (m: string) => `Ou saisissez un chemin sur ${m}`,
      offlinePath: (m: string) => `${m} est hors ligne : impossible de vérifier ce chemin.`, notFound: (m: string) => `Dossier introuvable sur ${m}.`,
      alreadyListed: 'Ce dépôt est déjà dans la liste.', absolute: 'Saisissez un chemin complet, qui commence par /.',
      timeout: 'Le dossier n’a pas répondu.', retry: 'Réessayer'
    }
  },
  stateLabel: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' }
};

const en: typeof fr = {
  side: {
    label: 'Sidebar', newSession: 'New session', search: 'Search', searchLabel: 'Search a session',
    views: 'Views', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projects', newProject: 'New project', unassigned: 'No project',
    machines: 'Machines', manageMachines: 'Manage machines', agents: (n) => pluralEn(n, `${n} agent`, `${n} agents`), offline: 'offline', settings: 'Settings'
  },
  crumb: { atelier: 'Atelier', list: 'List', settings: 'Settings', clearFilter: 'Remove the filter: show every project', clearFilterTitle: 'Every project (Esc)', escape: 'Esc', openParent: (n) => `Open ${n}’s conversation` },
  top: {
    viewTabs: 'Agents view', helpersHide: 'Hide subagents', helpersShow: 'Show subagents', pause: 'Freeze animations', play: 'Animate',
    search: 'Search a session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Keyboard shortcuts (?)', fullscreen: 'Full screen', fullscreenExit: 'Exit full screen',
    terminalShow: 'Show the terminal', terminalHide: 'Hide the terminal', terminalShowTitle: 'Show the terminal (O)', terminalHideTitle: 'Hide the terminal (O)'
  },
  foot: { sessions: 'Local and SSH sessions', search: 'A session', chat: 'Chat Ledge', shortcuts: 'Shortcuts' },
  sections: { general: 'General', appearance: 'Appearance', notifications: 'Notifications', sounds: 'Sounds', machines: 'Machines', projects: 'Projects', shortcuts: 'Shortcuts', about: 'About' },
  pending: 'This screen is coming soon.',
  close: 'Close',
  modalTitles: { launch: 'New session', project: 'New project', editProject: 'Edit project' },
  search: {
    title: 'Go to a session', placeholder: 'Agent, task, project or machine…', empty: 'No session matches this search.', results: 'Sessions',
    browse: 'Browse', open: 'Open', closeKey: 'Close', enter: 'Enter', escape: 'Esc'
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    intro: 'Active while the window has focus. Navigation keys stay available for typing and the terminal when they have focus.',
    outro: 'Ctrl / ⌘ K opens the search from any view. Y and N only act on the pinned request of the open session, never while typing.',
    rows: [['Ctrl / ⌘ K','Search and open a session'],['Ctrl ,','Open the settings'],['Alt 1…9','Jump to the main sessions'],['Alt ← / →','Previous / next session'],['J / K or ↓ / ↑','Walk through the sessions (atelier or list)'],['F','Filter the list'],['Enter','Open the selected session'],['N','New session'],['+ / −','Zoom the atelier in / out'],['0','Fit the atelier to the screen'],['Ctrl + wheel','Zoom under the pointer'],['Space + drag','Pan the view'],['/','Open Ledge chat'],['R','Write a reply to the agent'],['Y / N','Allow / deny the pending request'],['1…9','Pick a suggested answer'],['J / K','Next / previous file (Changes)'],['O','Show or hide the terminal'],['Esc','Close the panel or go back to the atelier'],['?','Show these shortcuts']]
  },
  tray: { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', dndOff: 'Resume alerts', quit: 'Quit Ledge Desktop' },
  notify: {
    approval: (name) => `${name} needs your approval`,
    question: (name) => `${name} has a question`,
    finished: (name) => `${name} has finished`,
    failed: (name) => `${name} ran into an error`,
    manyTitle: 'Your team',
    many: (n) => `${n} sessions need you or have finished`
  },
  atelier: {
    table: (name) => `${name} table`,
    conversations: (name) => `Conversations of project ${name}`,
    actions: (name) => `Actions of project ${name}`, actionsTitle: 'Project actions',
    edit: 'Edit project',
    newSession: 'New session', newSessionAt: (name) => `New session at the ${name} table`,
    isolate: (name) => `Isolate project ${name}`, isolateLabel: 'Isolate this table', showAll: 'Show every project',
    more: (n) => `+${n} at this table`, moreTitle: 'See every agent of the project in the list',
    seat: (name, task, machine) => `${name}, ${task}, ${machine}`,
    helperSeat: (kind, parent, task) => `${kind}, subagent of ${parent}: ${task}`,
    offline: 'Offline',
    desk: 'Talk to Ledge',
    watching: (n) => pluralEn(n, `I'm watching over ${n} agent.`, `I'm watching over ${n} agents.`),
    listening: "I'm listening.",
    assistant: 'Your assistant',
    unassignedHint: 'Ledge links these sessions to no project. Drag them onto a table, or use “Move to…”.',
    empty: {
      title: (name) => `No agent at the ${name} table`,
      body: (where) => `The table will appear as soon as a session starts in ${where}.`,
      noRepo: 'this project'
    },
    legend: { working: 'Running', approval: 'Your approval', question: 'A question', done: 'Done or offline', helper: 'A small bot is a subagent.' }
  },
  filing: {
    moveTo: 'Move to…', newProject: 'New project…', from: (folder) => `From ${folder}`,
    grip: 'Drag onto a table to move it there',
    dropHelp: (name) => `Drop on a project to move ${name} there.`,
    dropHere: 'Drop here', dropNow: (name) => `Release to seat ${name}`,
    joined: (name, table) => `${name} joins the ${table} table. Ledge will remember this folder.`,
    offline: (name) => `${name} could not be moved: the local Ledge daemon is not reachable.`,
    outdated: (name) => `${name} could not be moved: update the local Ledge daemon, it does not know projects yet.`,
    invalid: (name) => `${name} could not be moved: Ledge cannot remember this folder.`,
    unconfirmed: (name) => `${name} was not moved: Ledge did not confirm. Try again.`
  },
  zoom: {
    bar: 'Atelier zoom', out: 'Zoom out', outTitle: 'Zoom out (−)', in: 'Zoom in', inTitle: 'Zoom in (+)',
    reset: 'Back to 100 %', fit: 'Fit', fitTitle: 'See everything (0)', hint: 'Ctrl + wheel · drag the floor · double-click a table'
  },
  list: {
    buckets: { decide: 'To decide', running: 'Running', done: 'Done', offline: 'Offline' },
    filter: 'Filter the sessions', filterPlaceholder: 'Agent, task, machine, repository…', clearFilter: 'Clear the filter',
    chips: 'Filter by state', all: 'All',
    groupBy: 'Group by', groupLabel: 'Group', groups: { project: 'Project', machine: 'Machine', state: 'State' },
    comfy: 'Comfortable rows', tight: 'Compact rows',
    collapse: (name) => `Collapse ${name}`, expand: (name) => `Expand ${name}`, only: (name) => `Show only ${name}`,
    branch: (b) => `Branch ${b}`,
    newSessionIn: (name) => `New session in ${name}`,
    tally: { decide: (n) => `${n} to decide`, running: (n) => `${n} running`, done: (n) => `${n} done`, offline: (n) => `${n} offline` },
    unassignedHelp: 'Drag onto a project, or use “Move to…”.',
    grip: 'Drag onto a project',
    dropHelp: 'Drop on a project in the sidebar or on its group.',
    dropNow: (name) => `Drop to move ${name}`,
    row: (name, task, state, ctx) => `${name}, ${task}, ${state}, ${ctx}`,
    kids: {
      show: (n) => pluralEn(n, `Show ${n} subagent`, `Show ${n} subagents`),
      hide: (n) => pluralEn(n, `Hide ${n} subagent`, `Hide ${n} subagents`),
      count: (n) => pluralEn(n, `${n} subagent`, `${n} subagents`)
    },
    empty: {
      projectTitle: (name) => `No session in ${name}`,
      projectBody: (where) => `The project will fill as soon as a session starts in ${where}.`,
      noneTitle: 'No session', noneBody: 'Start a session to see it here.',
      noMatch: 'No session matches', clear: 'Clear the filters',
      noMatchBody: (q, chip, none) => (!q && !chip && none ? `Nothing in “${none}”.` : q && chip ? `Nothing for “${q}” among the “${chip}” sessions.` : q ? `Nothing for “${q}”.` : `Nothing among the “${chip}” sessions.`)
    },
    foot: { walk: 'browse', open: 'open', filter: 'filter', note: 'pending requests come first in each group.' },
    enter: 'Enter',
    allow: 'Allow', deny: 'Deny', reply: 'Reply', open: 'Open', openTitle: 'Open the session (Enter)',
    when: {
      now: 'just now', wait: (d) => `for ${d}`, ago: (d) => `${d} ago`,
      requestNow: 'Request received just now', waitTitle: (d) => `Waiting for ${d}`,
      activityNow: 'Last activity just now', activityAgo: (d) => `Last activity ${d} ago`,
      seenAgo: (d) => `Last seen ${d} ago`,
      units: { min: 'min', h: 'h', d: 'd' }
    }
  },
  decisions: {
    failed: (name, message) => `Could not send the decision to ${name}: ${message}`,
    unconfirmed: (name) => `Ledge did not see the decision for ${name} land. Open the session to check.`,
    replyFailed: (name, message) => `Could not send the reply to ${name}: ${message}`,
    replyUnconfirmed: (name) => `Ledge did not see the reply to ${name} land. Check the thread.`,
    noteNotTyped: 'Refused, but the note could not be typed.'
  },
  session: {
    meta: 'Machine and repositories',
    subagent: 'Subagent',
    rail: {
      label: (p) => `Agents of the project ${p}`, kids: (n) => `Subagents · ${n}`, kidsOf: (n) => `Subagents of ${n}`, newHere: 'New session here'
    },
    kidsPill: (n) => pluralEn(n, '1 subagent', `${n} subagents`), kidsPillTitle: 'Show the subagents in the rail',
    views: { label: 'Session view', thread: 'Thread', changes: 'Changes' },
    changes: {
      files: 'Changed files', count: (n) => pluralEn(n, '1 file', `${n} files`), toggle: (n) => `Files · ${n}`,
      labels: { add: 'Added', edit: 'Modified', write: 'Rewritten', delete: 'Deleted', rename: 'Renamed' },
      letters: { add: 'A', edit: 'M', write: 'M', delete: 'D', rename: 'R' },
      empty: 'No file changed', emptyCursor: 'Cursor Agent does not report the files it touches.',
      emptyBody: (n) => `${n} has not changed anything in this session yet.`,
      copy: 'Copy the path', copied: (p) => `Path copied: ${p}`,
      prev: 'Previous file', next: 'Next file',
      createdBy: 'Created by', changedBy: 'Changed by', turn: (n) => `turn ${n}`, seeInThread: '· see it in the thread',
      diff: 'Differences',
      gap: (n, a, b) => pluralEn(n, `⋯ 1 unchanged line (line ${a})`, `⋯ ${n} unchanged lines (lines ${a}–${b})`),
      unfold: (n) => pluralEn(n, 'Show 1 unchanged line', `Show ${n} unchanged lines`),
      cut: 'Diff limited to the first 80 lines.', noDiff: 'This file has no recorded difference.',
      noTouchDiff: 'No recorded difference for this action.',
      signs: { add: 'added', del: 'removed' }
    },
    pane: {
      label: 'Reading pane', tabs: 'Open documents', closeTab: (l) => `Close ${l}`,
      grow: 'Enlarge', shrink: 'Shrink', growTitle: 'Enlarge the pane (65 %)', shrinkTitle: 'Shrink the pane (50 %)',
      close: 'Close', closeTitle: 'Close the pane (Esc)', closeShort: 'Close (Esc)',
      resize: 'Resize the pane', allChanges: 'All changes',
      diffTitle: (f) => `Change · ${f}`, diffLabel: (f) => `± ${f}`,
      reading: 'Reading the document…',
      errors: {
        not_found: 'Document not found.', too_large: 'Document too large (1 MB at most).',
        offline: 'The machine is offline: the document cannot be read.', timeout: 'The document did not arrive in time.',
        other: 'The document could not be read.'
      }
    },
    terminal: {
      title: 'Terminal', empty: 'No output received yet.', readOnly: 'Read-only preview', offline: 'Offline',
      open: 'Open in a terminal', openFailed: (n) => `${n}’s terminal could not open.`
    },
    pending: {
      regions: { approval: 'Approval requested', plan: 'Plan to approve', question: 'Question from the agent' },
      command: (n) => `${n} wants to run a command`, edit: (n) => `${n} wants to change a file`, approval: (n) => `${n} wants your approval`,
      question: (n) => `${n} asks you a question`, plan: (n, title) => `${n} proposes a plan · ${title}`, planBadge: 'Plan to approve',
      allow: 'Allow', deny: 'Deny', always: 'Always allow for this session', alwaysProject: 'Always allow in this project',
      approvePlan: 'Approve the plan', keepPlanning: 'Keep planning', approveAuto: 'Approve in auto mode',
      alwaysScope: {
        project: 'Claude Code saves the rule in the project’s settings: it also holds for its later sessions in this project.',
        edits: 'Claude Code switches to accepting edits for the whole session: every edit after this one is accepted without asking you.',
        session: 'The agent stops asking for this command or these files for the rest of the session.',
        plan: 'Claude Code switches to auto mode, which answers the next requests by itself, commands included. On versions without auto mode (before 2.1), it accepts edits automatically.'
      },
      relay: (p) => `${p} passes this decision on.`, relayAnswer: (p) => `${p} will relay your answer.`,
      revise: 'Write what to revise, then Enter.', reviseKey: 'Write what to revise, then Enter: the plan goes back to planning.'
    },
    reply: {
      label: 'Reply to the agent', send: 'Send', denyWith: 'Deny with this message',
      placeholder: {
        plan: 'What to revise in the plan… (Enter: keep planning)', approval: 'Or deny and say what to do instead…',
        question: (n) => `Or answer ${n} freely…`, done: (n) => `Start ${n} again with a new instruction…`, idle: (n) => `Reply to ${n}…`
      },
      denyHint: 'Enter denies with this message', planHint: 'Enter sends the plan back to planning', write: 'write',
      offline: (m) => `${m} is offline.`, offlineBody: ' The thread is frozen at the last known activity; you can reply once it reconnects.', seeMachine: 'See the machine',
      viaParent: (n, p) => `Replies to ${n} go through ${p}, who started it.`, openParent: (p) => `Open ${p}`,
      readOnly: 'Session started without Ledge: read only.', optionsOnly: 'Choose one of the proposed answers (1–9).',
      noNote: 'This agent takes no message with a refusal: deny with N.', tooLong: (max) => `A note holds ${max} characters at most.`
    },
    thread: {
      label: 'Session thread',
      you: 'You', fromParent: (n) => `Instruction from ${n}`,
      exchange: (at) => `Exchange at ${at}`, live: 'running',
      actions: (n) => pluralEn(n, '1 action', `${n} actions`),
      kinds: {
        read: (n) => pluralEn(n, `${n} read`, `${n} reads`), search: (n) => pluralEn(n, `${n} search`, `${n} searches`),
        command: (n) => pluralEn(n, `${n} command`, `${n} commands`), edit: (n) => pluralEn(n, `${n} edit`, `${n} edits`)
      },
      files: (n) => pluralEn(n, '· 1 file changed', `· ${n} files changed`),
      failed: (n) => `· ${n} failed`,
      cut: (n) => `· ${n} interrupted`,
      running: 'running · ', interrupted: 'interrupted', liveAction: 'Action running',
      marks: { running: 'Running', success: 'Succeeded', failed: 'Failed', unknown: 'Interrupted' },
      verbs: { create: 'Create', delete: 'Delete', read: 'Read', search: 'Search', command: 'Command', edit: 'Edit' },
      decided: { accept: 'Allowed', always: 'Always allowed', deny: 'Denied', unknown: 'Answered in the terminal' },
      helperLaunched: 'Subagent started', openHelper: (n, task) => `Open ${n}: ${task}`,
      seeChange: 'View the change', seeChangeShort: 'View',
      read: 'Read',
      unread: 'New since your last visit', latest: 'Go to the latest message',
      lost: (m) => `Connection lost with ${m}`,
      lostBody: 'The thread is frozen: what follows is the last known state; what the agent is doing now is not known.',
      frozenEnd: (s) => `No news since the connection was lost · ${s}`, ended: (s) => `Session ended · ${s}`,
      loading: 'Loading the thread…', empty: 'Nothing in the thread yet.', notLoaded: 'The thread was not loaded before the connection was lost.'
    },
    plan: {
      kicker: 'Proposed plan', fallback: 'Plan',
      statuses: { proposed: 'Awaiting your approval', open: 'Proposed', approved: 'Approved', revised: 'Revised afterwards' },
      more: (n) => pluralEn(n, '… and 1 more step', `… and ${n} more steps`), steps: (n) => pluralEn(n, '1 step', `${n} steps`),
      readPlan: 'Read the plan', openBeside: 'Open beside',
      approved: 'Plan approved', approvedAuto: 'Plan approved · auto mode', toRevise: 'Plan to revise',
      by: (n) => `Plan proposed by ${n}`, tab: (t) => `Plan · ${t}`,
      answerHint: { lead: 'Answer below the thread:', approve: 'approve', keep: 'keep planning' },
      summary: (n, s) => pluralEn(n, `1 step: ${s}`, `${n} steps: ${s}`)
    },
    todos: {
      workPlan: 'Work plan', workPlanUpdated: 'Work plan updated', updated: 'work plan updated',
      allDone: 'All done', paused: 'Paused',
      doneOf: (d, n) => `${d}/${n} done`, inProgress: (t) => `in progress: ${t}`,
      boxes: { completed: 'Done', in_progress: 'In progress', pending: 'To do' }
    }
  },
  launch: {
    prompt: 'Instruction', placeholder: 'What should the agent do? Describe the expected result.',
    suggestions: 'Suggestions', ideas: ['Review the latest pull request', 'Fix the failing tests', 'Update the documentation'],
    agent: 'Agent',
    tools: { claude: ['Claude Code', 'Design, review'], codex: ['Codex', 'Code and tests'], cursor: ['Cursor Agent', 'In the editor'] },
    project: 'Project', machine: 'Machine', offline: 'offline', offlineTitle: 'Offline: reconnect the machine in Settings',
    repos: (m) => `Repositories on ${m}`, noGit: 'Folder without Git', notFound: 'not found', oneRepo: (t) => `One repository only for ${t}`,
    noRepos: (p, m) => `No repository of ${p} on ${m}.`, editProject: 'Edit the project',
    noProjects: 'No project yet.', noProjectsBody: 'Create a project to launch agents in it.', newProject: 'New project',
    newAgent: 'A new agent', joins: (n, t) => `${n} will join the ${t} table`, seat: (n, m, r) => `Seat ${n} · ${m} · ${r}`, noRepo: 'no repository',
    missing: { tool: 'Choose an agent', prompt: 'Write the instruction', machine: 'No machine online', repos: 'Choose at least one repository' },
    cancel: 'Cancel', launch: 'Launch', launching: 'Launching…',
    started: (n, t) => `${n} is starting at the ${t} table.`, refused: (m) => `Launch refused: ${m}`,
    timeout: 'The launch did not answer. Check the machine, then try again.'
  },
  projects: {
    picker: {
      machines: 'Machine to browse', offline: 'offline',
      offlineBody: (m) => `${m} is offline. Reconnect it in Settings › Machines to browse its folders.`,
      crumbs: 'Current folder', root: 'root', parent: 'Parent folder', contents: (d, m) => `Contents of ${d} on ${m}`,
      open: (n) => `Open ${n}`,
      noGit: 'no Git', add: 'Add', added: 'Added', addLabel: (n, m) => `Add ${n} (${m})`, addedLabel: (n) => `${n} already added`,
      typed: (m) => `Path on ${m}`, typedPlaceholder: (m) => `Or type a path on ${m}`,
      offlinePath: (m) => `${m} is offline: this path cannot be checked.`, notFound: (m) => `Folder not found on ${m}.`,
      alreadyListed: 'This repository is already in the list.', absolute: 'Type a full path, starting with /.',
      timeout: 'The folder did not answer.', retry: 'Try again'
    }
  },
  stateLabel: { approval: 'Approval', question: 'Question', starting: 'Starting', idle: 'Available', working: 'Running', done: 'Done', error: 'Error', readonly: 'Read only' },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' }
};

export type Messages = typeof fr;
export type Lang = 'fr' | 'en';
export const LANGS: readonly Lang[] = ['fr', 'en'];
export const MESSAGES: Record<Lang, Messages> = { fr, en };
