import type { BotState } from '@ledge/ui/bots/poseFor';
import type { SectionId } from '../nav/state';
import type { Bucket, GroupBy } from '../list/model';
import type { DaemonInfo, ProjectColor, ToolStatus, UpdateFailure } from '@ledge/protocol';
import type { PlanDoc, ToolKind, Verb } from '../session/thread';
import type { Change } from '../session/changes';
import type { TodoStatus } from '../session/todos';
import type { FinishedNotify, SoundCategory, SoundVolume } from '@ledge/ui/sounds/preferences';
import type { SshProblem } from '@ledge/fleet';
import type { DraftProblem } from '../settings/machines';
import type { SaveOutcome } from '../settings/useMachineEditor';

type PlanStatus = PlanDoc['status'];

/** French counts 0 and 1 as singular. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Desktop's copy in French: the source of truth, whose shape is `Messages` (see messages.ts, which loads it on demand). */
export const fr = {
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
  sections: { general: 'Général', appearance: 'Apparence', notifications: 'Notifications', sounds: 'Sons', machines: 'Machines', projects: 'Projets', shortcuts: 'Raccourcis clavier', about: 'À propos' } as Record<SectionId, string>,
  settings: {
    nav: 'Sections des réglages', back: 'Retour à l’atelier',
    saved: (what: string) => `Réglage enregistré · ${what}`,
    hints: {
      general: 'Langue, démarrage, agent par défaut et mises à jour.',
      appearance: 'Thème, couleur de Ledge, échelle et mouvements.',
      notifications: 'Qui vous prévient, et quand vous laisser tranquille.',
      sounds: 'Les signaux sonores de votre équipe.',
      machines: 'Cette machine et vos serveurs SSH. Une seule liste pour l’île et Ledge Desktop.',
      projects: 'Projets, dépôts et dossiers mémorisés.',
      shortcuts: 'Les raccourcis de l’application.',
      about: 'Versions et mises à jour.'
    } as Record<SectionId, string>,
    machineOffline: 'Une machine est hors ligne', updateWaiting: 'Une mise à jour est disponible',
    general: {
      lang: 'Langue', langHint: 'S’applique tout de suite, menu de la zone de notification compris.',
      langs: { fr: 'Français', en: 'English' } as Record<'fr' | 'en', string>,
      // The language that stays speaks: the other one is the language asked for, which did not load.
      langFailed: 'Le français reste affiché : l’anglais n’a pas pu être chargé.',
      autostart: 'Lancer au démarrage de Windows', autostartHint: 'Ledge Desktop s’ouvre avec votre session Windows.',
      autostartMissing: 'Pas proposé ici : seule l’application installée peut se lancer avec Windows.',
      autostartFailed: 'Windows n’a pas pris ce réglage.', autostartOff: 'Pas de lancement au démarrage',
      tool: 'Agent par défaut', toolHint: 'Pour le chat de Ledge et ses cartes.', toolSaved: (name: string) => `Agent par défaut : ${name}`
    },
    updates: {
      title: 'Mises à jour',
      version: (v: string | null) => (v ? `Ledge ${v}` : 'Ledge Desktop'),
      phase: {
        idle: 'Aucune vérification pour l’instant.',
        checking: 'Recherche d’une nouvelle version…',
        current: 'Ledge Desktop est à jour.',
        available: (v: string) => `Ledge ${v} est disponible. Rien n’est installé sans votre clic.`,
        installing: (v: string) => `Installation de Ledge ${v}. Ledge Desktop redémarrera seul.`,
        failedCheck: 'La vérification a échoué. Vérifiez votre connexion.',
        failedInstall: 'L’installation a échoué. L’application n’a pas changé.'
      },
      upToDate: 'À jour',
      installingTag: (percent: number | null) => (percent === null ? 'Installation…' : `Installation… ${percent} %`),
      install: 'Installer', retry: 'Réessayer',
      auto: 'Rechercher les mises à jour', autoHint: 'Au démarrage, puis toutes les 6 heures. Ledge ne met jamais à jour sans votre clic.',
      autoOn: 'Recherche automatique des mises à jour', autoOff: 'Recherche manuelle des mises à jour',
      checking: 'Vérification…', never: 'Jamais vérifié', checkedNow: 'Vérifié à l’instant', checkedAgo: (d: string) => `Vérifié il y a ${d}`,
      source: 'Sur les releases GitHub de Lyssaen/ledge.', check: 'Vérifier'
    },
    appearance: {
      theme: 'Thème', themeHint: 'Change aussi la matière des mascottes.',
      themes: { light: ['Clair', 'Galet'], dark: ['Sombre', 'Signal'] } as Record<'light' | 'dark', readonly [string, string]>,
      themeSaved: { light: 'Thème clair · Galet', dark: 'Thème sombre · Signal' } as Record<'light' | 'dark', string>,
      accent: 'Couleur de Ledge', accentHint: 'Le point, les boutons et le halo de Ledge. Les couleurs des états restent inchangées.',
      picker: 'Couleur personnalisée', hex: 'Code hexadécimal', coral: 'Corail',
      accentInvalid: 'Couleur invalide : utilisez # et six caractères hexadécimaux.',
      accentSaved: (hex: string) => `Couleur de Ledge ${hex}`, coralSaved: 'Couleur de Ledge : Corail',
      sample: 'Valider le plan', sampleHint: 'Bouton, compteur et halo de Ledge.',
      scale: 'Échelle de l’interface', scaleHint: 'Taille du texte et des contrôles de Ledge Desktop. Auto suit la mise à l’échelle de Windows.',
      percent: (n: number) => `${Math.round(n * 100)} %`, auto: 'Auto', autoAt: (pct: string) => `Auto (${pct})`, scaleSaved: (label: string) => `Échelle de l’interface ${label}`, scaleFailed: 'L’échelle n’a pas pu être appliquée.',
      reduced: 'Mouvements réduits', reducedHint: 'Les mascottes s’immobilisent ; les états restent lisibles sans animation. La préférence de Windows reste prioritaire.',
      reducedOff: 'Animations'
    },
    notifications: {
      dnd: 'Ne pas déranger', dndHint: 'Suspend les bulles, les notifications Windows et les sons. Les demandes restent visibles dans l’île et dans les sessions.',
      dndSaved: (on: boolean): string => (on ? 'Ne pas déranger activé' : 'Ne pas déranger désactivé'),
      finished: 'Quand un agent a terminé', finishedHint: 'Comment Ledge Desktop vous prévient quand une tâche arrive au bout.',
      modes: { both: 'Bulle et son', bubble: 'Bulle', sound: 'Son', none: 'État de session seul' } as Record<FinishedNotify, string>,
      finishedSaved: (mode: string) => `À la fin d’un agent : ${mode}`,
      note: 'L’état de la session reste toujours visible, même sans bulle ni son.'
    },
    sounds: {
      enabled: 'Sons', enabledHint: 'Des tons courts et doux pour ce qui vous attend. Jamais en Ne pas déranger.',
      enabledSaved: (on: boolean): string => (on ? 'Sons activés' : 'Sons coupés'),
      custom: 'Personnaliser les sons',
      volume: 'Volume', volumeHint: 'Tester joue le signal de question.',
      volumes: { quiet: 'Bas', normal: 'Normal', loud: 'Fort' } as Record<SoundVolume, string>,
      volumeSaved: (label: string) => `Volume ${label.toLowerCase()}`,
      test: 'Tester', dndOn: 'Ne pas déranger est actif : aucun son.',
      when: 'Jouer un son quand',
      categories: { requests: 'Un bot a besoin de vous · accord, question', finished: 'Un bot ou Ledge a terminé sa tâche', errors: 'Quelque chose échoue', decisions: 'Vous acceptez ou refusez', team: 'Un bot arrive ou part' } as Record<SoundCategory, string>,
      categorySaved: (label: string, on: boolean): string => `${label} : ${on ? 'activé' : 'désactivé'}`,
      behind: 'Seulement quand le terminal est derrière', behindHint: 'Si Windows Terminal est la fenêtre au premier plan, vous regardez déjà : pas de son, la bulle s’affiche quand même.',
      behindSaved: (on: boolean): string => (on ? 'Sons seulement terminal derrière' : 'Sons toujours'),
      note: 'Un seul son à la fois, pour l’île et Ledge Desktop ensemble : une rafale de demandes ne joue qu’une fois. Ouvrir, fermer et survoler restent silencieux.'
    },
    machines: {
      title: 'Vos machines',
      noteLead: 'Ledge rejoint vos serveurs par SSH, depuis WSL. ', noteShared: 'Liste partagée', noteRest: ' : le daemon local la garde, l’île et Ledge Desktop affichent les mêmes machines.',
      status: { online: 'Connectée', connecting: 'Connexion…', offline: 'Hors ligne' } as Record<'online' | 'connecting' | 'offline', string>,
      local: 'Cette machine', localKind: 'Local · WSL',
      ssh: (alias: string) => `SSH · ${alias}`,
      version: (v: string | undefined) => (v ? `Ledge ${v}` : 'Version inconnue'),
      sessions: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
      reconnect: 'Reconnecter', test: 'Tester', edit: 'Modifier', remove: 'Retirer', cancel: 'Annuler',
      add: 'Ajouter une machine',
      count: (n: number, max: number) => `${n} ${plural(n, 'machine', 'machines')} · ${max} au plus`,
      addTitle: 'Ajouter une machine',
      editTitle: (label: string) => `Modifier ${label}`,
      label: 'Nom', labelAria: 'Nom de la machine', labelHint: 'Comme il apparaît dans l’atelier et l’île.', labelPlaceholder: 'Serveur de dev',
      alias: 'Alias SSH', aliasHint: 'Nom d’un bloc Host de ~/.ssh/config dans WSL.', aliasPlaceholder: 'gpu-box',
      aliasInvalid: 'Lettres, chiffres, point, tiret ou souligné, sans espace.',
      before: 'Avant d’ajouter un serveur',
      checklist: ['L’alias fonctionne depuis WSL, sans mot de passe.', 'La clé du serveur est déjà approuvée.', 'Node 22+ et tmux sont installés.', 'Ledge est installé et démarré sur le serveur.'],
      probe: 'Tester la connexion', save: 'Enregistrer', saving: 'Enregistrement…',
      optional: 'Le test est facultatif : une machine injoignable peut être enregistrée.',
      probing: 'Connexion à ',
      probeOk: (v: string | undefined, n: number) => `${v ? `Ledge ${v}` : 'Ledge'} répond · ${n} ${plural(n, 'session', 'sessions')}`,
      problem: {
        alias: 'Alias introuvable. Ajoutez un bloc Host pour cet alias dans ~/.ssh/config de WSL.',
        key: 'La clé SSH est refusée. Vérifiez IdentityFile pour cet alias dans ~/.ssh/config de WSL.',
        hostKey: 'La clé du serveur n’est pas encore approuvée. Connectez-vous une fois depuis WSL avec ssh et cet alias.',
        unreachable: 'Le serveur ne répond pas. Il est peut-être éteint, ou hors du réseau.',
        ledge: 'Ledge est absent ou trop ancien sur ce serveur. Installez-le, puis lancez « ledge setup ».',
        stopped: 'Le service Ledge ne tourne pas sur le serveur. Lancez « ledge setup » sur le serveur.',
        local: 'Mettez à jour Ledge sur cette machine pour rejoindre un serveur.',
        other: 'La connexion a échoué.'
      } as Record<SshProblem, string>,
      errors: {
        invalid: 'Vérifiez le nom et l’alias SSH : lettres, chiffres, point, tiret ou souligné, sans espace.',
        duplicate: 'Cet alias est déjà ajouté.',
        full: 'Vous avez atteint 20 machines.',
        offline: 'Le daemon local n’est pas connecté : réessayez dans un instant.',
        timeout: 'Le daemon local n’a pas répondu. Rien n’a changé.',
        refused: 'Le daemon local a refusé cette liste. Rien n’a changé.'
      } as Record<DraftProblem | Exclude<SaveOutcome, 'saved'>, string>,
      added: (label: string) => `${label} ajoutée`,
      edited: (label: string) => `${label} modifiée`,
      removed: (label: string) => `${label} retirée`,
      confirm: { before: 'Retirer ', after: ' ? Ses sessions disparaissent de la liste, dans l’île comme ici. Rien n’est arrêté ni supprimé sur le serveur.' }
    },
    projects: {
      title: 'Projets',
      note: 'Un projet regroupe des dépôts de travail, sur une ou plusieurs machines, et leurs conversations. Sa table apparaît dans l’atelier dès qu’un agent y travaille.',
      noRepo: 'Aucun dépôt', edit: 'Modifier', editLabel: (n: string) => `Modifier ${n}`, delete: 'Supprimer', deleteLabel: (n: string) => `Supprimer ${n}`,
      add: 'Nouveau projet',
      rules: 'Dossiers mémorisés',
      rulesNote: 'Quand vous rangez un agent sans projet à une table, Ledge retient son dossier : les prochaines sessions qui y démarrent rejoignent le même projet.',
      rule: (path: string, machine: string) => `${path} sur ${machine}`,
      target: (path: string) => `Projet pour ${path}`,
      forget: 'Oublier', forgetLabel: (path: string) => `Oublier ${path}`,
      empty: 'Aucun dossier mémorisé. Ranger un agent en ajoute un.',
      repointed: (path: string, project: string) => `${path} → ${project}`, forgotten: (path: string) => `${path} oublié`,
      refused: {
        offline: 'Le daemon local est hors ligne : rien n’a changé.', outdated: 'Le daemon local est trop ancien pour les projets : mettez-le à jour.',
        invalid: 'Le daemon a refusé ce changement. Rien n’a changé.', timeout: 'Le daemon n’a pas confirmé ce changement.'
      } as Record<'offline' | 'outdated' | 'invalid' | 'timeout', string>
    },
    shortcuts: {
      title: 'Dans Ledge Desktop',
      note: 'Y et N n’agissent que sur la demande épinglée de la session ouverte, jamais pendant la saisie.'
    },
    about: {
      tagline: 'Une nouvelle façon de travailler avec vos agents. L’île et Ledge Desktop, une seule application.',
      versions: 'Versions', app: 'Ledge Desktop', daemon: (label: string) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'clone git', unknown: 'installation inconnue' } as Record<DaemonInfo['install'], string>,
      unknown: 'Version inconnue', behindTag: 'À mettre à jour', latest: 'Dernière version', latestUnknown: 'Pas encore vérifiée',
      behind: (names: readonly string[]) => `${new Intl.ListFormat('fr', { type: 'conjunction' }).format(names)} ${plural(names.length, 'n’a', 'n’ont')} pas la dernière version.`,
      updateDaemon: 'Mettre à jour le daemon', updateDaemonHint: (v: string) => `Le daemon local passe à Ledge ${v}, puis redémarre.`, update: 'Mettre à jour',
      log: 'Journal du daemon',
      step: {
        sent: (v: string) => `Demande envoyée au daemon local : ${v}`,
        installing: 'Installation de la nouvelle version…',
        restarting: 'Redémarrage du daemon…',
        done: (v: string) => `Daemon à jour : ${v}`
      },
      failed: {
        'git-install': 'Votre daemon tourne depuis un clone git : mettez-le à jour vous-même.',
        'no-systemd': 'Le daemon ne tourne pas comme service : il ne peut pas se relancer seul.',
        'sessions-at-risk': 'Vos sessions tournent dans le service du daemon : un redémarrage les fermerait. Fermez-les, ou redémarrez WSL, puis réessayez.',
        'npm-failed': 'Le daemon n’a pas pu se mettre à jour. Rien n’a changé.',
        busy: 'Une mise à jour est déjà en cours.',
        offline: 'Le daemon local n’est pas connecté : rien n’a été envoyé.',
        timeout: 'Le daemon ne répond plus.'
      } as Record<UpdateFailure | 'offline' | 'timeout', string>,
      timeoutCommand: 'systemctl --user status ledge-daemon',
      manualUnknown: 'Ledge ne sait pas comment votre daemon a été installé : mettez-le à jour vous-même.'
    }
  },
  chunkFailed: 'Cette partie de Ledge n’a pas pu se charger. Relancez l’application.',
  close: 'Fermer',
  modalTitles: { launch: 'Nouvelle session' },
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
    started: (n: string, t: string) => `${n} démarre à la table ${t}.`, startedNoTable: (n: string) => `${n} démarre, sans projet.`, refused: (m: string) => `Démarrage refusé : ${m}`,
    timeout: 'Le démarrage n’a pas répondu. Vérifiez la machine puis réessayez.'
  },
  projects: {
    titles: { new: 'Nouveau projet', edit: (n: string) => `Modifier ${n}`, delete: (n: string) => `Supprimer ${n}` },
    name: 'Nom', namePlaceholder: 'Ex. Paper Rendering', color: 'Couleur',
    colors: { blue: 'Bleu', green: 'Vert', amber: 'Ambre', violet: 'Violet', teal: 'Sarcelle', pink: 'Rose', red: 'Rouge', slate: 'Ardoise' } as Record<ProjectColor, string>,
    description: 'Description', optional: 'facultatif', descriptionPlaceholder: 'Une phrase qui dit à quoi sert le projet',
    repos: (n: number) => `Dépôts de travail · ${n}`, branchTitle: 'Branche par défaut détectée', noGit: 'Dossier sans Git',
    notFound: 'introuvable', offline: 'hors ligne', remove: (n: string, m: string) => `Retirer ${n} (${m})`, addRepo: 'Ajouter un dépôt',
    empty: 'Aucun dépôt pour l’instant. Le projet peut exister sans, mais Ledge ne saura pas y ranger les sessions.',
    fileToo: 'Ranger aussi',
    problems: { name_empty: 'Donnez un nom au projet', name_taken: 'Ce nom est déjà utilisé par un autre projet', repo_duplicate: 'Ce dépôt est en double', gone: 'Ce projet a été supprimé entre-temps',
      repo_taken: (p: string) => `Ce dépôt est déjà dans ${p}` },
    refused: {
      offline: 'Le daemon local est hors ligne : rien n’a été enregistré.', outdated: 'Le daemon local est trop ancien pour les projets : mettez-le à jour.',
      invalid: 'Le daemon a refusé ce projet.', timeout: 'Le daemon n’a pas confirmé l’enregistrement.'
    } as Record<'offline' | 'outdated' | 'invalid' | 'timeout', string>,
    preview: (n: number, ms: string) => `${n} dépôt${plural(n, '', 's')}${ms ? ` sur ${ms}` : ''}`, firstSession: ' · la table apparaîtra avec la première session', newName: 'Nouveau projet',
    create: 'Créer le projet', save: 'Enregistrer', saving: 'Enregistrement…', cancel: 'Annuler', deleteProject: 'Supprimer le projet',
    saved: (n: string) => `${n} enregistré.`,
    created: (n: string) => `Projet ${n} créé. Il apparaît dans la barre latérale ; sa table s’ouvrira avec la première session.`,
    createdWith: (n: string, names: readonly string[]) => `Projet ${n} créé. ${new Intl.ListFormat('fr', { type: 'conjunction' }).format(names)} ${plural(names.length, 'rejoint', 'rejoignent')} sa table.`,
    /** The deletion view (`.pe-delete`): `names` is the agents' names already joined (four at most, then « … »). */
    delete: {
      lead: (n: string) => `${n} disparaît de la barre latérale et de l’atelier. Ses dépôts restent intacts sur vos machines.`,
      noAgents: 'Aucun agent à cette table.',
      agents: (n: number, names: string) => `${n} agent${plural(n, '', 's')} (${names})`,
      toNone: (n: number) => `${plural(n, 'passera', 'passeront')} dans « Sans projet ».`,
      toProject: (n: number, p: string) => `${plural(n, 'rejoindra', 'rejoindront')} ${p}.`,
      rules: (n: number) => `${n} dossier${plural(n, '', 's')} mémorisé${plural(n, '', 's')}`,
      rulesForget: (n: number) => plural(n, 'sera oublié.', 'seront oubliés.'),
      rulesMove: (n: number) => plural(n, 'pointera vers ce projet.', 'pointeront vers ce projet.'),
      noRules: 'Aucun dossier mémorisé.',
      reposMove: (n: number, p: string) => `${n} dépôt${plural(n, '', 's')} ${plural(n, 'rejoindra', 'rejoindront')} ${p}.`,
      reposGone: (n: number) => `${n} dépôt${plural(n, '', 's')} ${plural(n, 'quittera', 'quitteront')} Ledge (les dossiers restent sur vos machines).`,
      their: 'Ses agents', none: 'Sans projet', moveTo: 'Déplacer vers…', target: 'Projet de destination',
      confirm: (n: string) => `Supprimer ${n}`, moveAndDelete: 'Déplacer et supprimer',
      done: (n: string) => `${n} supprimé.`,
      doneMoved: (k: number, p: string) => ` ${k} agent${plural(k, '', 's')} ${plural(k, 'rejoint', 'rejoignent')} ${p}.`,
      doneNone: (k: number) => ` ${k} agent${plural(k, '', 's')} ${plural(k, 'passe', 'passent')} dans « Sans projet ».`
    },
    picker: {
      machines: 'Machine à parcourir', offline: 'hors ligne',
      offlineBody: (m: string) => `${m} est hors ligne. Reconnectez-la dans Réglages › Machines pour parcourir ses dossiers.`,
      crumbs: 'Dossier courant', root: 'racine', parent: 'Dossier parent', contents: (d: string, m: string) => `Contenu de ${d} sur ${m}`,
      open: (n: string) => `Ouvrir ${n}`,
      noGit: 'sans Git', add: 'Ajouter', added: 'Ajouté', addLabel: (n: string, m: string) => `Ajouter ${n} (${m})`, addedLabel: (n: string) => `${n} déjà ajouté`,
      typed: (m: string) => `Chemin sur ${m}`, typedPlaceholder: (m: string) => `Ou saisissez un chemin sur ${m}`,
      offlinePath: (m: string) => `${m} est hors ligne : impossible de vérifier ce chemin.`, notFound: (m: string) => `Dossier introuvable sur ${m}.`,
      alreadyListed: 'Ce dépôt est déjà dans la liste.', absolute: 'Saisissez un chemin complet, qui commence par /.',
      ownedBy: (p: string) => `Déjà dans ${p}`, ownedLabel: (n: string, p: string) => `${n} est déjà dans ${p}`,
      timeout: 'Le dossier n’a pas répondu.', retry: 'Réessayer'
    }
  },
  /** The Ledge chat (shared ChatView): the island's `chat`, `machines` (those its cards read) and `time` copy, word for word. */
  chat: {
    title: 'Ledge', subtitle: (n: number, repos: number) => `Voit ${n} ${plural(n, 'session', 'sessions')} · ${repos} ${plural(repos, 'dépôt', 'dépôts')} · lecture seule`,
    ask: 'Demander à Ledge', askPlaceholder: 'Demander à Ledge…', open: 'Ouvrir la conversation avec Ledge', send: 'Envoyer', stop: 'Arrêter', reset: 'Nouvelle conversation', back: 'Retour aux sessions', close: 'Fermer',
    emptyTitle: 'Demandez-moi des nouvelles.',
    emptyHint: (n: number) => `${n === 0 ? 'Je ne vois aucune session pour l’instant.' : n === 1 ? 'Je vois 1 session, son terminal et son dépôt.' : `Je vois ${n} sessions, les terminaux et les dépôts.`} Je lis, je ne touche à rien.`,
    starters: 'Pour commencer',
    chips: ['Où en sont les autres ?', 'Qu’est-ce qui attend ma décision ?', 'Quelles branches peuvent être fusionnées ?'],
    thinking: 'Ledge cherche…',
    step: { sessions: 'Relit les sessions', pane: (name: string) => `Lit le terminal de ${name}`, reply: (name: string) => `Lit la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => `Lit ${path}` },
    source: { sessions: 'les sessions', pane: (name: string) => `le terminal de ${name}`, reply: (name: string) => `la dernière réponse de ${name}`, git: (name: string) => `git dans le dossier de ${name}`, repo: (path: string) => path },
    sources: 'Sources', sourcesNone: 'aucune lecture', ago: (when: string) => `il y a ${when}`,
    error: (why: string) => `Ledge n’a pas pu répondre : ${why}`,
    stopped: 'Arrêté.',
    card: {
      label: 'Session proposée', folder: 'Dossier', tool: 'Harnais', byDefault: (tool: string) => `${tool} · par défaut`, prompt: 'Instruction', noPrompt: 'Aucune, session vide',
      launch: 'Lancer la session', launching: 'Lancement…', retry: 'Réessayer', orRephrase: 'ou reformule ta demande', orFolder: 'ou donne-moi un autre dossier',
      failed: (why: string) => `Échec du lancement : ${why}`, started: 'a démarré', startedUnknown: 'Session démarrée', terminal: 'Terminal'
    },
    relay: {
      label: 'Instruction à envoyer', session: 'Session', instruction: 'Instruction',
      send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', retry: 'Réessayer', orRephrase: 'ou reformule ta demande',
      queued: 'travaille, j’enverrai dès qu’il aura fini', sentTo: 'Envoyé à', failed: (why: string) => `Échec de l’envoi : ${why}`,
      pill: { yours: 'à toi', working: 'travaille', waiting: 'attend ta réponse', stopped: 'arrêtée' }
    },
  },
  machines: { clarification: 'Vous pouvez aussi répondre dans le chat.', destination: 'Destination', choose: (name: string) => `Sur ${name}.`, local: 'Cette machine', offline: 'Hors ligne' },
  time: { seconds: (n: number) => `${n} s`, minutes: (n: number) => `${n} min`, hours: (n: number) => `${n} h`, locale: 'fr-FR' },
  /** Why the chat cannot send while the local daemon is away. */
  offline: 'Le daemon local est hors ligne.',
  stateLabel: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' }
};
