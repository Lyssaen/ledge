import type { BotState } from '@ledge/ui/bots/poseFor';
import type { SectionId } from '../nav/state';
import type { Bucket, GroupBy } from '../list/model';
import type { DaemonInfo, OmpApproval, ProjectColor, ToolStatus, UpdateFailure } from '@ledge/protocol';
import type { PlanDoc, ToolKind, Verb } from '../session/exchanges';
import type { Change } from '../session/changedFiles';
import type { TodoStatus } from '../session/todos';
import type { FinishedNotify, SoundCategory, SoundVolume } from '@ledge/ui/sounds/preferences';
import type { SshProblem, Summary, Why } from '@ledge/fleet';
import type { ScanStep } from '../projects/useLedgeScan';
import type { DraftProblem } from '../settings/machineDrafts';
import type { SaveOutcome } from '../settings/useMachineEditor';

type PlanStatus = PlanDoc['status'];

/** French counts 0 and 1 as singular. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
/** « de Otto », « d’Iris ». */
const deName = (n: string) => (/^[aeiouyhàâéèêîôûAEIOUYHÀÂÉÈÊÎÔÛ]/.test(n) ? `d’${n}` : `de ${n}`);
const andList = (xs: readonly string[]) => new Intl.ListFormat('fr', { type: 'conjunction' }).format(xs);

/** Desktop's copy in French: the source of truth, whose shape is `Messages` (see messages.ts, which loads it on demand). */
export const fr = {
  side: {
    label: 'Barre latérale', newSession: 'Nouvelle session', searchLabel: 'Rechercher une session',
    views: 'Vues', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projets', newProject: 'Nouveau projet', unassigned: 'Sans projet',
    machines: 'Machines', manageMachines: 'Gérer les machines', agents: (n: number) => plural(n, `${n} agent`, `${n} agents`), offline: 'hors ligne', daemonUpdating: 'mise à jour du daemon', settings: 'Réglages', shortcuts: 'Raccourcis clavier',
    ledgeHome: 'Accueil : Ledge, l’opérateur', ledgeLine: (yours: number, teams: number) => `${yours} à toi · ${plural(teams, `${teams} équipe active`, `${teams} équipes actives`)}`,
    ask: 'Demander à Ledge', askPlaceholder: 'Demander à Ledge…',
    openChat: 'Ouvrir la conversation avec Ledge',
    active: (n: number) => plural(n, `${n} actif`, `${n} actifs`),
    yours: 'À toi', yoursMore: (n: number) => `Voir les ${n} autres`, yoursLess: 'Réduire',
    allow: 'Oui', deny: 'Non', reply: 'Répondre', see: 'Voir',
    ofHelper: (parent: string) => `↳ ${parent}`,
    hideDone: 'Masquer les sessions terminées (H)', showDone: 'Afficher les sessions terminées (H)',
    dense: 'Mode compact (D)', foldAll: 'Tout replier',
    tree: 'Projets, branches et sessions',
    fold: (name: string) => `Replier ${name}`, unfold: (name: string) => `Déplier ${name}`,
    foldKids: (name: string) => `Masquer les sous-agents de ${name}`,
    unfoldKids: (name: string) => `Afficher les sous-agents de ${name}`,
    newHere: (name: string) => `Nouvelle session dans ${name}`,
    newOn: (branch: string) => `Nouvelle session sur ${branch}`,
    filterProject: (name: string) => `N’afficher que ${name} dans l’atelier`,
    moreDone: (n: number) => `+${n} ${plural(n, 'terminée', 'terminées')}`,
    archiveOne: (name: string) => `Archiver ${name}`,
    manageOne: (name: string) => `Gérer la session ${name}`,
    terminalOne: (name: string) => `Ouvrir le terminal de ${name}`,
    kids: (n: number) => `${n} ${plural(n, 'sous-agent', 'sous-agents')}`,
    wt: 'Worktree lié',
    tallyNeed: 'à décider', tallyWork: 'au travail', tallyOff: 'hors ligne', tallyDone: 'terminées',
    archives: 'Archives', archiveFilter: 'Filtrer les archives', archiveFilterPh: 'Filtrer les archives…',
    archiveEmpty: 'Rien d’archivé pour l’instant.', archiveNone: 'Aucune archive ne correspond.',
    read: (name: string, project: string, task: string, when: string) => `Relire ${name}, ${project}, ${task}, archivée ${when}`,
    restoreOne: (name: string) => `Remettre ${name} à la table`,
    resumeOne: (name: string) => `Reprendre ${name}`,
    deleteOne: (name: string) => `Supprimer ${name}`,
    dropHelp: (name: string) => `Déposez sur un projet pour y ranger ${name}.`,
    state: {
      approval: 'attend ton accord', question: 'te pose une question', error: 'en erreur',
      working: 'au travail', starting: 'démarre', idle: 'au repos', done: 'terminée', offline: 'hors ligne'
    } satisfies Record<string, string>
  },
  titlebar: {
    label: 'Barre de fenêtre',
    waiting: (n: number) => plural(n, `${n} session attend : ouvrir la première`, `${n} sessions attendent : ouvrir la première`),
    dnd: 'Ne pas déranger', dndOn: 'Ne pas déranger : activé', minimize: 'Réduire', maximize: 'Agrandir', restore: 'Restaurer', close: 'Fermer'
  },
  crumb: { atelier: 'Atelier', list: 'Liste', settings: 'Réglages', clearFilter: 'Retirer le filtre : voir tous les projets', clearFilterTitle: 'Tous les projets (Échap)', escape: 'Échap', openParent: (n: string) => `Ouvrir la conversation de ${n}` },
  top: {
    viewTabs: 'Vue des agents', helpersHide: 'Masquer les sous-agents', helpersShow: 'Afficher les sous-agents', pause: 'Figer les animations', play: 'Animer',
    chat: 'Chat Ledge', shortcuts: 'Raccourcis clavier (?)', fullscreen: 'Plein écran', fullscreenExit: 'Quitter le plein écran',
    terminalShow: 'Afficher le terminal', terminalHide: 'Masquer le terminal', terminalShowTitle: 'Afficher le terminal (O)', terminalHideTitle: 'Masquer le terminal (O)'
  },
  foot: { sessions: 'Sessions locales et SSH', islandOn: 'Encoche active', islandOff: 'Encoche masquée', islandTitle: 'Réglages de l’encoche' },
  daemonOutdated: { title: 'Le démon Ledge doit être mis à jour', body: 'Ce Ledge Desktop a besoin d’un démon plus récent dans WSL. Lancez une de ces commandes dans WSL ; Ledge se reconnecte tout seul.', npm: 'Installé avec npm', git: 'Installé depuis un clone git' },
  sections: { general: 'Général', appearance: 'Apparence', island: 'Encoche', notifications: 'Notifications', sounds: 'Sons', machines: 'Machines', mobile: 'Accès mobile', projects: 'Projets', shortcuts: 'Raccourcis clavier', about: 'À propos' } as Record<SectionId, string>,
  settings: {
    nav: 'Sections des réglages', back: 'Retour à l’atelier',
    saved: (what: string) => `Réglage enregistré · ${what}`,
    hints: {
      general: 'Langue, démarrage, agent par défaut, contexte max et mises à jour.',
      appearance: 'Thème, couleur de Ledge, échelle et mouvements.',
      island: 'L’encoche en haut de l’écran : où elle se pose et ce qu’elle signale.',
      notifications: 'Qui vous prévient, et quand vous laisser tranquille.',
      sounds: 'Les signaux sonores de votre équipe.',
      machines: 'Cette machine et vos serveurs SSH. Une seule liste pour l’encoche et Ledge Desktop.',
      mobile: 'Piloter vos agents depuis votre téléphone, via le serveur relais. Le contenu est chiffré de bout en bout : le serveur ne peut ni le lire ni le modifier.',
      projects: 'Projets, dépôts et dossiers mémorisés.',
      shortcuts: 'Dans l’application, et partout dans Windows.',
      about: 'Versions et mises à jour.'
    } as Record<SectionId, string>,
    machineOffline: 'Une machine est hors ligne', updateWaiting: 'Une mise à jour est disponible',
    mobileOffline: "L'accès mobile est hors ligne", mobileAsks: "Un appareil demande l'accès",
    general: {
      lang: 'Langue', langHint: 'S’applique tout de suite, menu de la zone de notification compris.',
      langs: { fr: 'Français', en: 'English' } as Record<'fr' | 'en', string>,
      // The language that stays speaks: the other one is the language asked for, which did not load.
      langFailed: 'Le français reste affiché : l’anglais n’a pas pu être chargé.',
      autostart: 'Lancer au démarrage de Windows', autostartHint: 'Ledge Desktop s’ouvre avec votre session Windows.',
      autostartMissing: 'Pas proposé ici : seule l’application installée peut se lancer avec Windows.',
      autostartFailed: 'Windows n’a pas pris ce réglage.', autostartOff: 'Pas de lancement au démarrage',
      tool: 'Agent par défaut', toolHint: 'Pour le chat de Ledge et ses cartes.', toolSaved: (name: string) => `Agent par défaut : ${name}`,
      context: 'Contexte max', contextHint: 'Au-delà, une session est proche de sa limite : « À toi » propose de passer le relais, et Ledge relève de lui-même un poste qui travaille sans demander.',
      contextSaved: (pct: number) => `Contexte max : ${pct} %`, contextUnknown: 'Mettez à jour le daemon Ledge local pour régler ce seuil.'
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
      profile: 'Profil', avatar: 'Photo de profil', avatarHint: 'À côté de « Vous » dans le fil d’une session. Choisissez une image ou déposez-la sur le rond. Elle reste sur ce PC.',
      avatarFile: 'Fichier de la photo de profil', avatarChoose: 'Choisir une image…', avatarRemove: 'Retirer la photo',
      avatarSaved: 'Photo de profil', avatarRemoved: 'Photo de profil retirée',
      avatarRefused: { notImage: 'Ce fichier n’est pas une image.', tooLarge: 'Image trop lourde : 8 Mo au plus.', unreadable: 'Cette image n’a pas pu être lue.' },
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
      reducedOff: 'Animations',
      seats: 'Agents autour d’une table', seatsHint: 'Au-delà, les autres agents du projet se rangent dans « +N ».',
      seatsSaved: (n: number) => `${n} agents autour d’une table`
    },
    notifications: {
      dnd: 'Ne pas déranger', dndHint: 'Suspend les bulles, les notifications Windows et les sons. Les demandes restent visibles dans l’encoche et dans les sessions.',
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
      behind: 'Seulement quand le terminal est derrière', behindHint: 'Si Windows Terminal est au premier plan, ou si Ledge montre l’écran de l’agent, vous regardez déjà : pas de son, la bulle s’affiche quand même.',
      behindSaved: (on: boolean): string => (on ? 'Sons seulement terminal derrière' : 'Sons toujours'),
      note: 'Un seul son à la fois, pour l’encoche et Ledge Desktop ensemble : une rafale de demandes ne joue qu’une fois. Ouvrir, fermer et survoler restent silencieux.'
    },
    machines: {
      title: 'Vos machines',
      noteLead: 'Ledge rejoint vos serveurs par SSH, depuis WSL. ', noteShared: 'Liste partagée', noteRest: ' : le daemon local la garde, l’encoche et Ledge Desktop affichent les mêmes machines.',
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
      label: 'Nom', labelAria: 'Nom de la machine', labelHint: 'Comme il apparaît dans l’atelier et l’encoche.', labelPlaceholder: 'Serveur de dev',
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
      confirm: { before: 'Retirer ', after: ' ? Ses sessions disparaissent de la liste, dans l’encoche comme ici. Rien n’est arrêté ni supprimé sur le serveur.' }
    },
    mobile: {
      connection: 'Connexion',
      access: 'Accès mobile', accessHint: "Ce PC garde une connexion sortante vers le serveur relais. Aucun port n'est ouvert.",
      relay: 'Serveur relais', relayHint: "L'adresse du serveur que vous et votre téléphone utilisez.",
      relayInvalid: 'Adresse refusée : https://, ou http:// pour localhost seulement, sans chemin.',
      account: 'Compte GitHub', accountHint: 'Le compte qui relie ce PC et vos téléphones.',
      codeLead: 'Saisissez ce code sur GitHub :',
      codeLabel: (spelled: string) => `Code à saisir sur GitHub : ${spelled}`,
      open: (where: string) => `Ouvrir ${where}`, copy: 'Copier le code', copied: 'Copié',
      waiting: (min: number) => `En attente de la confirmation sur GitHub… · expire dans ${min} min`, cancel: 'Annuler',
      signin: 'Se connecter avec GitHub', signout: 'Se déconnecter',
      notAllowed: "Ce compte GitHub n'est pas autorisé sur ce serveur. Demandez à son administrateur de l'ajouter.", otherAccount: 'Réessayer avec un autre compte',
      signedOut: { other_pc: "Ce PC a été déconnecté : un autre PC s'est connecté avec ce compte. Un compte n'a qu'un PC.", session_invalid: "Ce PC a été déconnecté : la session n'est plus valide." },
      reconnect: 'Se reconnecter',
      /** Why the last sign-in ended without a session; not_allowed has its own well (notAllowed). */
      signinEnded: { failed: 'La connexion à GitHub a échoué. Vérifiez le serveur relais, puis réessayez.', expired: 'Le code a expiré. Recommencez la connexion.', denied: 'La connexion a été refusée sur GitHub.', not_allowed: null } as Record<'failed' | 'expired' | 'denied' | 'not_allowed', string | null>,
      status: 'État',
      states: { off: 'Désactivé', idle: 'Pas encore connecté', online: 'Connecté au relais', connecting: 'Connexion…', offline: 'Hors ligne' },
      retryIn: (s: number) => `Hors ligne · nouvel essai dans ${s} s`,
      idleHint: 'La connexion démarre une fois le compte GitHub confirmé.',
      refusedHint: 'Le serveur a refusé ce compte.',
      outHint: { other_pc: 'Un autre PC a pris la place de celui-ci.', session_invalid: "La session n'est plus valide." },
      unreachable: "Le serveur relais ne répond pas. Vérifiez l'adresse et votre connexion ; Ledge réessaie tout seul.", retry: 'Réessayer',
      devices: 'Appareils', devicesHint: "Un appareil lié peut tout faire : lire, approuver, répondre, écrire. Révoquez-le s'il est perdu.",
      devicesOff: "L'accès mobile est désactivé : vos appareils liés ne peuvent pas se connecter.",
      revoked: ' est révoqué.',
      asks: "demande l'accès", asksLabel: (label: string) => `${label} demande l'accès`, waitingTag: 'En attente', via: (login: string) => `Connecté avec @${login}`,
      compare: 'Comparer le code',
      online: 'En ligne', offline: 'Hors ligne', seenNow: "Vu à l'instant", seenAgo: (d: string) => `Vu il y a ${d}`, linkedOn: (date: string) => `Lié le ${date}`,
      revoke: 'Révoquer', revokeAsk: { before: 'Révoquer ', after: " ? Il perd l'accès tout de suite et devra être lié à nouveau pour revenir." },
      emptyTitle: 'Aucun appareil lié.', emptyBefore: ' Sur votre téléphone, ouvrez ', emptyAfter: " et connectez-vous avec le même compte GitHub. Un code s'affichera ici et sur le téléphone.",
      unavailable: (error: string) => `L'accès mobile n'a pas démarré sur ce PC : ${error}`,
      outdated: 'Le daemon local est trop ancien pour l’accès mobile : mettez-le à jour.',
      refused: { offline: 'Le daemon local est hors ligne : rien n’a changé.', outdated: 'Le daemon local est trop ancien pour l’accès mobile : mettez-le à jour.' }
    },
    projects: {
      title: 'Projets',
      note: 'Un projet regroupe des dépôts de travail, sur une ou plusieurs machines, et leurs conversations. Sa table apparaît dans l’atelier dès qu’un agent y travaille.',
      noRepo: 'Aucun dossier ni dépôt', edit: 'Modifier', editLabel: (n: string) => `Modifier ${n}`, delete: 'Supprimer', deleteLabel: (n: string) => `Supprimer ${n}`,
      add: 'Nouveau projet',
      rules: 'Dossiers mémorisés',
      rulesNote: 'Quand vous rangez un agent sans projet à une table, Ledge retient son dossier : les prochaines sessions qui y démarrent rejoignent le même projet.',
      rule: (path: string, machine: string) => `${path} sur ${machine}`,
      target: (path: string) => `Projet pour ${path}`,
      forget: 'Oublier', forgetLabel: (path: string) => `Oublier ${path}`,
      empty: 'Aucun dossier mémorisé. Ranger un agent en ajoute un.',
      repointed: (path: string, project: string) => `${path} → ${project}`, forgotten: (path: string) => `${path} oublié`,
      suggest: {
        title: 'Laisser Ledge organiser',
        hint: 'Ledge regarde les dossiers des agents sans projet et les dépôts que vous n’avez rangés nulle part, puis propose des projets.',
        ask: 'Ledge, propose-moi des projets',
        card: (n: string) => `Proposition ${n}`, complete: (n: string) => `Compléter ${n}`,
        reviewCreate: 'Vérifier et créer…', reviewAdd: 'Vérifier et ajouter…', ignore: 'Ignorer',
        empty: 'Tout est déjà rangé : aucun dépôt libre ni agent sans projet à regrouper.',
        allIgnored: 'Toutes les propositions sont ignorées. « Relancer » les remet.'
      },
      refused: {
        offline: 'Le daemon local est hors ligne : rien n’a changé.', outdated: 'Le daemon local est trop ancien pour les projets : mettez-le à jour.',
        invalid: 'Le daemon a refusé ce changement. Rien n’a changé.', timeout: 'Le daemon n’a pas confirmé ce changement.'
      } as Record<'offline' | 'outdated' | 'invalid' | 'timeout', string>
    },
    island: {
      bannerTitle: 'L’encoche n’a plus de réglages à elle.',
      bannerBody: 'Le menu de son chat Ledge ouvre cette page, « Réglages dans Ledge Desktop ». L’encoche garde l’essentiel : vous prévenir, autoriser ou répondre d’un geste, ouvrir une session, parler à Ledge.',
      outdated: 'Le daemon local est trop ancien pour les réglages de l’encoche : mettez-le à jour.',
      show: 'Afficher l’encoche', showHint: 'La petite encoche en haut de l’écran. Masquée, Ledge Desktop continue de vous prévenir.', shown: 'Encoche affichée', hidden: 'Encoche masquée',
      preview: 'Aperçu de l’encoche', bubble: 'Otto attend votre accord',
      caption: {
        dnd: 'Ne pas déranger : les demandes restent dans l’encoche, sans bulle.',
        strip: 'Mode discret : un simple trait sous la fenêtre maximisée.',
        whole: 'Mode discret désactivé : l’encoche reste entière au-dessus de la fenêtre.',
        rest: 'L’encoche au repos, trois agents qui l’habitent.',
        hidden: 'L’encoche est masquée. Ledge Desktop continue de vous prévenir.'
      },
      cover: 'Simuler une fenêtre maximisée', uncover: 'Retirer la fenêtre',
      screen: 'Écran', screens: { primary: 'Principal', nth: (n: number) => `Écran ${n}`, missing: 'Débranché' },
      screenHint: (size: string | null) => (size ? `L’encoche se pose en haut de cet écran (${size}).` : 'L’encoche se pose en haut de cet écran.'),
      screenSaved: { primary: 'Écran principal', nth: (n: number) => `Écran ${n}` },
      position: 'Position de l’encoche', positionHint: 'Au centre du bord supérieur, ou décalée au quart de l’écran pour laisser libres les titres et les onglets.',
      positions: { left: 'À gauche', center: 'Centre', right: 'À droite' } as Record<'left' | 'center' | 'right', string>, positionSaved: (p: string) => `Position : ${p}`,
      discreet: 'Mode discret sous une fenêtre', discreetHint: 'Un simple trait quand une fenêtre maximisée occupe l’écran ; un survol la redéploie.', discreetOn: 'Mode discret', discreetOff: 'Encoche toujours entière',
      islandScale: 'Taille de l’encoche', islandScaleHint: 'L’encoche et ses compagnons en haut de l’écran.', islandScaleSaved: (label: string) => `Taille de l’encoche ${label}`,
      panelScale: 'Taille des fenêtres de l’encoche', panelScaleHint: 'Bulle, liste, session et chat qui s’ouvrent depuis l’encoche.', panelScaleSaved: (label: string) => `Taille des fenêtres ${label}`,
      does: 'Ce que fait l’encoche', doesNote: 'Les demandes d’accord et les questions s’affichent toujours dans l’encoche. Le reste est à votre choix.',
      quick: 'Autoriser et répondre depuis l’encoche', quickHint: 'Autoriser, refuser (Y / N) ou répondre en une ligne sans ouvrir Ledge Desktop.', quickOn: 'Réponses rapides dans l’encoche', quickOff: 'Réponses dans Ledge Desktop seulement',
      finished: 'Bulle quand un agent a terminé', finishedHint: 'Une bulle de 6 s sous l’encoche.', finishedOn: 'Bulle de fin de tâche', finishedOff: 'Pas de bulle de fin de tâche',
      say: 'Paroles des agents', sayHint: 'Une phrase d’un agent, en bulle, qui s’efface après 5 s.', sayOn: 'Paroles des agents', sayOff: 'Paroles masquées',
      helpers: 'Sous-agents dans l’encoche', helpersHint: 'Les petits bots sur l’épaule de leur agent principal.', helpersOn: 'Sous-agents affichés', helpersOff: 'Sous-agents masqués',
      shortcut: 'Raccourci pour ouvrir l’encoche', shortcutHint: 'Ouvre la liste des sessions de l’encoche, partout dans Windows.', recordingHint: 'Appuyez sur la combinaison voulue. Échap pour annuler.',
      recorder: (keys: string) => `Raccourci pour ouvrir l’encoche : ${keys}. Modifier`, press: 'Appuyez…', edit: 'Modifier', cancel: 'Annuler',
      needsModifier: 'Ajoutez Ctrl, Alt ou ⊞ : le raccourci doit marcher partout dans Windows.', shortcutSaved: (keys: string) => `Ouvrir l’encoche : ${keys}`,
      /** How a stored key name (`Ctrl Alt Shift Win L`) is shown. */
      keyNames: { Shift: 'Maj', Win: '⊞' } as Record<string, string>,
      refused: {
        offline: 'Le daemon local est hors ligne : rien n’a changé.', outdated: 'Le daemon local est trop ancien pour les réglages de l’encoche : mettez-le à jour.',
        invalid: 'Le daemon a refusé ce changement. Rien n’a changé.', timeout: 'Le daemon n’a pas confirmé ce changement.'
      } as Record<'offline' | 'outdated' | 'invalid' | 'timeout', string>
    },
    shortcuts: {
      global: 'Partout dans Windows', globalNote: 'Ces raccourcis marchent même quand Ledge Desktop est fermé dans la zone de notification.',
      globalRows: { island: 'Ouvrir la liste de l’encoche', newSession: 'Nouvelle session', theme: 'Changer le thème', dnd: 'Ne pas déranger, depuis l’encoche' },
      edit: 'Modifier', editLabel: 'Modifier le raccourci de l’encoche',
      title: 'Dans Ledge Desktop',
      note: 'Y et N n’agissent que sur la demande épinglée de la session ouverte, jamais pendant la saisie.'
    },
    about: {
      tagline: 'Une nouvelle façon de travailler avec vos agents. L’encoche et Ledge Desktop, une seule application.',
      versions: 'Versions', app: 'Ledge Desktop', daemon: (label: string) => `Daemon · ${label}`,
      install: { npm: 'npm', git: 'clone git', unknown: 'installation inconnue' } as Record<DaemonInfo['install'], string>,
      unknown: 'Version inconnue', behindTag: 'À mettre à jour', latest: 'Dernière version', latestUnknown: 'Pas encore vérifiée',
      behind: (names: readonly string[]) => `${new Intl.ListFormat('fr', { type: 'conjunction' }).format(names)} ${plural(names.length, 'n’a', 'n’ont')} pas la dernière version.`,
      updateDaemon: (label: string) => `Mettre à jour le daemon · ${label}`, updateDaemonHint: (label: string, v: string) => `Le daemon de ${label} passe à Ledge ${v}, puis redémarre.`, update: 'Mettre à jour',
      log: (label: string) => `Journal du daemon · ${label}`,
      step: {
        sent: (label: string, v: string, auto: boolean) => auto ? `Mise à jour automatique du daemon de ${label} : ${v}` : `Demande envoyée au daemon de ${label} : ${v}`,
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
        offline: 'Ce daemon n’est pas connecté : rien n’a été envoyé.',
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
    rows: [['Ctrl / ⌘ K','Rechercher et ouvrir une session'],['Ctrl ,','Ouvrir les réglages'],['Alt 1…9','Accès direct aux sessions principales'],['Alt ← / →','Session précédente / suivante'],['J / K ou ↓ / ↑','Parcourir les sessions (atelier)'],['Entrée','Ouvrir la session sélectionnée'],['← / →','Plier / déplier un projet (barre latérale)'],['E','Archiver la session sélectionnée'],['H','Afficher / masquer les sessions terminées'],['Ctrl ⇧ E','Aller à la barre latérale'],['N','Nouvelle session'],['+ / −','Zoomer / dézoomer l’atelier'],['0','Ajuster l’atelier à l’écran'],['Ctrl + molette / pincer','Zoomer sous le pointeur ou les doigts'],['Espace + glisser','Déplacer la vue'],['/','Demander à Ledge'],['R','Écrire une réponse à l’agent'],['Y / N','Autoriser / refuser la demande en attente'],['1…9','Choisir une réponse proposée'],['J / K','Fichier suivant / précédent (Modifications)'],['O','Afficher ou masquer le terminal'],['Ctrl `','Passer du fil au terminal et retour'],['Échap','Fermer le panneau ou revenir à l’atelier'],['?','Afficher ces raccourcis']] as ReadonlyArray<readonly [string, string]>
  },
  tray: { open: 'Ouvrir Ledge Desktop', newSession: 'Nouvelle session', dnd: 'Ne pas déranger', dndOff: 'Réactiver les alertes', quit: 'Quitter Ledge Desktop' },
  notify: {
    approval: (name: string) => `${name} attend votre accord`,
    question: (name: string) => `${name} a une question`,
    finished: (name: string) => `${name} a terminé`,
    failed: (name: string) => `${name} a rencontré une erreur`,
    manyTitle: 'Votre équipe',
    many: (n: number) => `${n} sessions vous attendent ou ont terminé`,
    /** A pairing waits for its code to be compared (the dialog « Lier un appareil »); the body is the device's label. */
    pairing: "Un appareil demande l'accès"
  },
  /** The dialog « Lier un appareil » (docs/mockups/mobile-access, scenario « pairing »). */
  pairing: {
    title: 'Lier un appareil',
    intro: { before: 'Un appareil connecté avec votre compte ', after: " demande l'accès à vos agents." },
    introNoAccount: "Un appareil demande l'accès à vos agents.",
    codeLabel: 'Code de liaison',
    codeSpelled: (spelled: string) => `Code de liaison : ${spelled}`,
    check: 'Vérifiez que le téléphone affiche exactement ce code. Approuvez ici, puis confirmez sur le téléphone.',
    warn: "Si les codes diffèrent, refusez : quelqu'un d'autre tente de se lier.",
    expiresIn: (left: string) => `expire dans ${left}`,
    deny: 'Refuser', approve: 'Approuver',
    approved: { strong: 'Approuvé sur ce PC.', rest: ' Confirmez maintenant sur le téléphone.' },
    linked: { strong: (label: string) => `${label} est lié.`, rest: ' Il apparaît dans Réglages › Accès mobile › Appareils.' },
    expired: 'La demande a expiré. Recommencez depuis le téléphone.',
    close: 'Fermer'
  },
  atelier: {
    table: (name: string) => `Table ${name}`,
    conversations: (name: string) => `Conversations du projet ${name}`,
    actions: (name: string) => `Actions du projet ${name}`, actionsTitle: 'Actions du projet',
    edit: 'Modifier le projet',
    newSession: 'Nouvelle session', newSessionAt: (name: string) => `Nouvelle session à la table ${name}`,
    isolate: (name: string) => `Isoler le projet ${name}`, isolateLabel: 'Isoler cette table', showAll: 'Voir tous les projets',
    more: (n: number) => `+${n} à cette table`, moreTitle: 'Voir tous les agents du projet',
    seat: (name: string, task: string, machine: string) => `${name}, ${task}, ${machine}`,
    helperSeat: (kind: string, parent: string, task: string) => `${kind}, sous-agent de ${parent} : ${task}`,
    offline: 'Hors ligne',
    ledgeTaskLabel: (owner: string, title: string) => `Ledge confie « ${title} » à ${owner}. Voir la tâche`,
    messageTo: (n: string) => `à ${n}`,
    messageLabel: (sender: string, n: string, summary: string) => `${sender} écrit à ${n} : ${summary}. Ouvrir l’échange`,
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
  home: {
    operator: (sessions: number, teams: number, machines: number) => `Opérateur · voit ${plural(sessions, `${sessions} session`, `${sessions} sessions`)}, ${plural(teams, `${teams} équipe`, `${teams} équipes`)}, ${plural(machines, `${machines} machine`, `${machines} machines`)} · lecture seule`,
    tabsLabel: 'Vues de Ledge',
    tabs: { conversation: 'Conversation', teams: (n: number) => `Équipes · ${n}`, tasks: (n: number) => `Tâches · ${n}`, history: 'Historique' },
    toAtelier: 'Retour à l’atelier',
    point: {
      title: 'Le point', yours: 'À toi', teams: 'Équipes', given: 'Confiées par Ledge',
      summarize: 'Résumer la journée', summarizeQuestion: 'Résume la journée : ce qui a avancé, ce qui attend ma décision, ce qui bloque.',
      nothingYours: 'Rien ne t’attend.', noTeam: 'Aucune équipe en cours.', noTask: 'Ledge n’a confié aucune tâche aujourd’hui.',
      seats: (n: number) => plural(n, `${n} siège`, `${n} sièges`), progress: (done: number, given: number) => `${done}/${given} ${plural(given, 'tâche', 'tâches')} de Ledge`,
      table: 'Table', resume: 'Reprendre', resting: 'au repos', allow: 'Oui', deny: 'Non', see: 'Voir', dismiss: 'Ranger',
      closed: (owner: string, title: string, state: 'done' | 'refused' | 'dropped') => state === 'done' ? `${owner} a fini « ${title} »` : state === 'refused' ? `${owner} a refusé « ${title} »` : `${owner} a abandonné « ${title} »`,
      ofLedge: 'tâche de Ledge', owner: (owner: string, state: string) => `${owner} · ${state}`
    },
    suggestions: (team?: string) => ['Monte une équipe…', 'Confie une tâche à…', team ? `Où en est ${team} ?` : 'Où en sont les équipes ?', 'Qui a besoin de moi ?'],
    readOnly: 'lecture seule · rien sans ton clic',
    mentions: 'Mentionner', mentionSession: (name: string) => `session ${name}`, mentionTeam: (name: string) => `équipe ${name}`,
    tasks: {
      filters: 'Filtres', all: 'Toutes', open: 'Ouvertes', closed: 'Closes', giver: 'Donneur', anyGiver: 'Tous', ledge: 'Ledge', seats: 'Les sièges', team: 'Équipe', anyTeam: 'Toutes',
      none: 'Aucune tâche.', result: 'Résultat', reason: 'Raison', log: 'Historique', from: (giver: string, owner: string) => `de ${giver} à ${owner}`, close: 'Fermer'
    },
    teams: { none: 'Aucune équipe en cours. Demande à Ledge d’en monter une.', dissolved: 'dissoute' },
    history: { none: 'Aucune conversation aujourd’hui.', open: 'Voir dans la conversation' }
  },
  handover: {
    nearShort: (name: string, pct: number) => `${name} · contexte ${pct} %`, nearHint: 'limite proche', failedShort: (name: string) => `Relève de ${name} échouée`, retry: 'Réessayer',
    pass: 'Passer le relais', passTitle: 'Une nouvelle session prend sa place : il écrit son bilan, ses tâches lui sont passées', later: 'Plus tard',
    gauge: (pct: number) => `contexte ${pct} %`,
    state: { briefing: 'relève : bilan demandé', launching: 'relève : lancement…', done: 'relevée', failed: 'relève échouée' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relevée par ${name}`, relieves: (name: string) => `relève de ${name}`,
    refused: (why: string) => `Relève refusée : ${why}`, auto: 'par Ledge'
  },
  teamLaunch: {
    title: (project: string) => `Nouvelle équipe · ${project}`, folder: 'Dossier', noFolder: 'Aucun dossier de ce projet sur cette machine', loading: 'Lecture des rôles et des modèles…',
    template: 'Modèle', custom: 'Sièges choisis un par un', seats: 'Sièges', noRole: 'Aucun rôle : écris ~/.ledge/roles/<id>.md', agentOf: (role: string) => `Agent de @${role}`,
    name: 'Nom de l’équipe', preview: (team: string, project: string) => `L’équipe ${team} s’installera à une nouvelle table de la pièce ${project}.`,
    unknown: (roles: string) => `Rôles inconnus dans ce dossier : ${roles}`, launch: 'Lancer l’équipe', launching: 'Lancement…',
    failed: (why: string) => `L’équipe n’a pas été lancée : ${why}`, noAnswer: 'Ledge n’a pas répondu.', launched: (team: string, project: string) => `L’équipe ${team} s’installe dans la pièce ${project}.`
  },
  teams: {
    tables: (n: number) => plural(n, `${n} table`, `${n} tables`),
    treeLine: (done: number, given: number) => `équipe · ${done}/${given}`, treeResting: 'au repos',
    common: 'table commune',
    room: (name: string) => `Pièce ${name}`,
    plaqueCounts: (tables: number, sessions: number) => `${plural(tables, `${tables} table`, `${tables} tables`)} · ${plural(sessions, `${sessions} session`, `${sessions} sessions`)}`,
    waiting: (n: number) => plural(n, `${n} attend`, `${n} attendent`), working: (n: number) => plural(n, `${n} au travail`, `${n} au travail`),
    roomMenu: (name: string) => `Actions de la pièce ${name}`, roomMenuTitle: 'Actions de la pièce',
    newSessionHere: 'Nouvelle session ici', newTeamHere: 'Nouvelle équipe ici…', entrance: 'ENTRÉE',
    teamTable: (name: string) => `Équipe ${name}`,
    teamLine: (done: number, given: number) => `équipe · opérateur Ledge · ${done}/${given} ${plural(given, 'tâche', 'tâches')}`,
    restingLine: 'équipe au repos', resume: 'Reprendre',
    teamMenu: (name: string) => `Actions de l'équipe ${name}`, teamMenuTitle: "Actions de l'équipe",
    openTasks: 'Voir les tâches', dissolve: "Dissoudre l'équipe",
    dissolveTitle: (name: string) => `Dissoudre l'équipe ${name} ?`,
    dissolveBody: 'Sa table disparaît de la pièce ; ses sessions restent, à la table commune ou dans les archives, et ses tâches restent à leurs sessions.',
    dropJoin: 'Lâcher pour rejoindre', dropLeave: 'Lâcher pour revenir à la table commune',
    sheet: (id: string, title: string, giver: string) => `${id} · ${title} · ${giver}`,
    chooseRole: (name: string, team: string) => `Rôle de ${name} dans ${team}`, otherRole: 'autre rôle…', loadingRoles: 'Lecture des rôles…', noRole: 'Aucun autre rôle',
    joined: (name: string, team: string, role: string) => `${name} rejoint ${team} comme @${role}.`,
    left: (name: string) => `${name} revient à la table commune.`
  },
  zoom: {
    bar: "Zoom de l'atelier", out: 'Dézoomer', outTitle: 'Dézoomer (−)', in: 'Zoomer', inTitle: 'Zoomer (+)',
    reset: 'Revenir à 100 %', fit: 'Ajuster', fitTitle: 'Tout voir (0)', hint: 'Ctrl + molette ou pincer · glisser le sol · double-clic sur une table'
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
  manage: {
    menu: {
      label: (name: string): string => `Gérer la session ${name}`, more: 'Gérer la session (clic droit)',
      open: 'Ouvrir la session', terminal: 'Terminal', rename: 'Renommer…', moveTo: 'Ranger dans…', end: 'Terminer la session', resume: 'Reprendre la session',
      archive: 'Archiver', endAndArchive: 'Terminer et archiver…', delete: 'Supprimer…',
      kids: (n: number, name: string): string => `${n} ${plural(n, 'sous-agent part', 'sous-agents partent')} avec ${name}.`,
      cannotEnd: (machine: string): string => `${machine} est injoignable : Ledge ne peut pas l’arrêter.`,
      outsideLedge: 'Lancée hors de Ledge : Ledge ne peut pas l’arrêter.',
      deleteKey: 'Suppr', archiveFinished: 'Archiver les terminées'
    },
    rename: { title: (name: string): string => `Renommer ${name}`, label: 'Nom de la session', save: 'Renommer', cancel: 'Annuler' },
    archivedBanner: {
      pill: 'Archivée', title: 'Session archivée',
      body: (ago: string): string => `${ago} · l’agent est arrêté, la conversation est en lecture seule.`,
      restore: 'Remettre à la table', delete: 'Supprimer…', resume: 'Reprendre'
    },
    outdated: (machine: string): string => `Mettez Ledge à jour sur ${machine}`,
    undo: 'Annuler',
    archived: (name: string, kids: number): string => `${name} est archivé${kids > 0 ? ` avec ${kids} ${plural(kids, 'sous-agent', 'sous-agents')}` : ''}.`,
    archivedMany: (n: number): string => `${n} sessions archivées.`,
    refused: (name: string, message: string): string => `${name} : ${message}`,
    confirm: {
      title: {
        end: (names: readonly string[]): string => `Terminer ${names.length === 1 ? names[0] : `ces ${names.length} sessions`} ?`,
        archive: (names: readonly string[]): string => `Terminer et archiver ${names.length === 1 ? names[0] : `ces ${names.length} sessions`} ?`,
        delete: (names: readonly string[]): string => `Supprimer ${names.length === 1 ? names[0] : `ces ${names.length} sessions`} ?`
      },
      body: {
        end: (names: readonly string[]): string => `L’agent s’arrête maintenant, même au milieu d’une tâche. Sa conversation reste lisible et ${names.length > 1 ? 'les sessions restent à leur table, marquées' : 'il reste à sa table, marqué'} « Terminée ».`,
        archive: (names: readonly string[], live: number): string => `${live === 1 && names.length === 1 ? `${names[0]} travaille encore : Ledge l’arrête, puis le range dans les Archives.` : `${live} ${plural(live, 'session travaille', 'sessions travaillent')} encore : Ledge les arrête, puis les range dans les Archives.`} Vous pourrez relire la conversation ou la reprendre plus tard.`,
        delete: (names: readonly string[], live: number, archived: boolean): string => `${names.length > 1 ? `Ces ${names.length} sessions disparaissent` : `${names[0]} disparaît`} de Ledge${archived ? ', archives comprises' : ''} : fil, documents et position à la table. ${live > 0 ? `${live > 1 ? `${live} sessions travaillent` : 'La session travaille'} encore : Ledge ${live > 1 ? 'les' : 'l’'}arrête d’abord. ` : ''}L’historique gardé par l’outil de l’agent sur la machine n’est pas touché.`
      },
      ok: { end: 'Terminer', archive: 'Terminer et archiver', delete: 'Supprimer définitivement' },
      kids: (kind: 'end' | 'archive' | 'delete', kids: number, names: readonly string[]): string => `${kids} ${plural(kids, 'sous-agent', 'sous-agents')} ${kind === 'delete' ? (kids > 1 ? 'sont supprimés' : 'est supprimé') : kind === 'end' ? (kids > 1 ? 's’arrêtent' : 's’arrête') : (kids > 1 ? 'partent' : 'part')} avec ${names.length > 1 ? 'eux' : names[0]}.`,
      offline: (kind: 'end' | 'archive' | 'delete', names: readonly string[]): string => `${names.join(', ')} : machine injoignable. Ledge ${kind === 'delete' ? 'l’oublie' : 'le range'} sans pouvoir l’arrêter ; l’agent s’arrêtera de lui-même ou au retour de la machine.`,
      cancel: 'Annuler'
    }
  },
  session: {
    meta: 'Machine et dépôts',
    subagent: 'Sous-agent',
    kidsPill: (n: number) => plural(n, `${n} sous-agent`, `${n} sous-agents`), kidsPillTitle: 'Voir les sous-agents dans la barre latérale',
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
      title: 'Terminal', empty: 'Aucune sortie reçue pour l’instant.',
      resize: 'Largeur du terminal', openFailed: (n: string) => `Le terminal de ${n} n’a pas pu s’ouvrir.`,
      agentTab: (n: string) => `${n} · agent`, shellTab: (n: number, dir: string) => `${n === 1 ? 'Shell' : `Shell ${n}`} · ${dir}`,
      addShell: 'Nouveau shell', closeTab: (label: string) => `Fermer ${label}`,
      local: 'wsl', remote: (host: string) => `ssh · ${host}`,
      external: 'Ouvrir dans un terminal externe', max: 'Agrandir le terminal', unmax: 'Réduire le terminal',
      attached: 'Attaché', attachedSsh: 'Attaché par SSH', reconnecting: 'Reconnexion…', readOnly: 'Lecture seule', offline: 'Hors ligne', preview: 'Aperçu · lecture seule',
      connecting: 'Connexion…', shell: 'Shell',
      tmuxTarget: (session: string, host?: string) => (host ? `ssh ${host} · tmux · ${session}` : `tmux · ${session}`),
      shellTarget: (host?: string, shell?: string) => `${host ? `ssh ${host}` : 'wsl'}${shell ? ` · ${shell}` : ''}`,
      detached: (name: string, s: number, attempt: number) => `L’écran de ${name} s’est détaché. Nouvelle tentative dans ${s} s (essai ${attempt}).`,
      shellEndedNoCode: 'Shell terminé',
      noTmux: 'aucune session tmux',
      lost: (host: string, s: number, attempt: number, name: string) => `Connexion à ${host} perdue. Nouvelle tentative dans ${s} s (essai ${attempt}). ${name} continue de travailler sur le serveur.`,
      reconnect: 'Reconnecter',
      offlineBanner: (host: string, time?: string) => (time ? `${host} ne répond plus depuis ${time}. Dernière sortie conservée ; rien ne peut être tapé.` : `${host} ne répond plus. Dernière sortie conservée ; rien ne peut être tapé.`),
      retry: 'Réessayer',
      subagent: (h: string, p: string) => `${h} est un sous-agent de ${p} et n’a pas de terminal à lui : voici l’écran de ${p}, en lecture seule.`,
      goParent: (p: string) => `Aller à ${p}`,
      outside: (n: string) => `${n} a été lancée hors de Ledge : pas d’écran à rattacher. Voici ses dernières lignes, en lecture seule. Votre shell reste disponible.`,
      ended: (n: string) => `${n} est terminée : voici ses dernières lignes, en lecture seule. Votre shell reste disponible.`,
      shellIntro: (n: string, dir: string) => `Shell ouvert dans le dossier de ${n} : ${dir}`,
      shellIntroSsh: (host: string, n: string, dir: string) => `Shell sur ${host}, dans le dossier de ${n} : ${dir}`,
      shellEnded: (code: number | null) => `Shell terminé (code ${code})`, shellLost: 'Shell terminé : connexion perdue',
      reopen: 'Rouvrir', shellUnavailable: 'Ce dossier ne peut pas être ouvert dans un shell.',
      toTerminal: (k: string) => `Donner le clavier au terminal · Ctrl ${k}`, toThread: (k: string) => `Le clavier va au terminal · revenir au fil : Ctrl ${k}`
    },
    pending: {
      writeOwn: 'Écrire ma propre réponse', writeOwnHint: 'Dans le champ ci-dessous, puis Entrée',
      ask: { send: 'Envoyer les réponses', decline: 'Décliner', other: (q: string) => `Autre réponse à « ${q} »`, otherPlaceholder: 'Autre réponse…' },
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
        queued: (n: string) => `Pour ${n}, après ce tour…`, question: (n: string) => `Ou répondez librement à ${n}…`, done: (n: string) => `Relancer ${n} avec une nouvelle consigne…`, idle: (n: string) => `Répondre à ${n}…`
      },
      denyHint: 'Entrée refuse avec ce message', planHint: 'Entrée renvoie le plan en préparation', write: 'écrire',
      offline: (m: string) => `${m} est hors ligne.`, offlineBody: ' Le fil est figé à la dernière activité connue ; vous pourrez répondre à la reconnexion.', seeMachine: 'Voir la machine',
      viaParent: (n: string, p: string) => `Les réponses à ${n} passent par ${p}, qui l’a lancé.`, openParent: (p: string) => `Ouvrir ${p}`,
      readOnly: 'Session démarrée sans Ledge : lecture seule.', optionsOnly: 'Choisissez une des réponses proposées (1–9).',
      askCard: 'Répondez depuis la carte ci-dessus.',
      afterTurn: 'Entrée : après ce tour', queue: 'Envoyer après ce tour', steer: 'Réorienter maintenant', steerTitle: 'Dévie le tour en cours au lieu d’attendre sa fin',
      interrupt: 'Interrompre', interruptTitle: 'Arrête le travail en cours ; la session et sa conversation restent',
      stop: (n: string) => `Arrêter ${n}`, stopTitle: 'Arrête le travail en cours et remet les consignes en attente dans le champ ; la session et sa conversation restent',
      stopKey: 'arrêter', escKey: 'Échap', stopping: 'Arrêt demandé…', stopped: (n: string) => `Vous avez interrompu ${n}.`, whenQueued: 'après ce tour', whenNow: 'maintenant',
      queueLabel: 'Consignes en attente', queued: (n: number) => `En attente (${n})`, queueSteer: 'réorienter', queueAfter: 'après ce tour', restore: 'Interrompre et récupérer', restoreTitle: 'Arrête le travail et remet les consignes en attente dans le champ',
      queueTitle: (n: number) => plural(n, `${n} message en attente`, `${n} messages en attente`), queueOrder: 'partent dans l’ordre', queueNow: 'maintenant', queueLater: 'après le tour', queueTakeBack: 'Arrêter et reprendre',
      noNote: 'Cet agent ne prend pas de message avec un refus : refusez avec N.', tooLong: (max: number) => `Une note tient en ${max} caractères au plus.`
    },
    model: {
      label: 'Modèle et effort', apply: 'Appliquer', schedule: 'Programmer', cancel: 'Annuler', nextTurn: 'au prochain tour',
      applyHint: (n: string) => `${n} redémarre sur la même conversation et garde son contexte.`,
      scheduleHint: (n: string) => `${n} travaille : le changement s’appliquera à la fin de ce tour.`,
      refused: (m: string) => `Changement de modèle refusé : ${m}`
    },
    thread: {
      label: 'Fil de la session',
      you: 'Vous', fromParent: (n: string) => `Consigne de ${n}`,
      exchange: (at: string) => `Échange de ${at}`,
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
      decided: { accept: 'Accordé', always: 'Toujours autorisé', deny: 'Refusé', unknown: 'Répondu dans le terminal', denyByClose: 'Refusé par la fermeture' } as Record<'accept' | 'always' | 'deny' | 'unknown' | 'denyByClose', string>,
      questionByClose: 'Refusée par la fermeture',
      seeChange: 'Voir la modification', seeChangeShort: 'Voir',
      read: 'Lire',
      unread: 'Nouveau depuis votre dernière visite', latest: 'Aller au dernier message',
      lost: (m: string) => `Connexion perdue avec ${m}`,
      lostBody: 'Le fil est figé : ce qui suit est le dernier état connu, l’activité actuelle n’est pas connue.',
      frozenEnd: (s: string) => `Plus aucune nouvelle depuis la perte de connexion · ${s}`, ended: (at: string, s: string) => `Session terminée à ${at} · ${s}`,
      // The rail (issue #34, maquette B): a folded exchange or run, the end of an exchange, a subagent's card, the waiting row,
      // the Story / Objectif markers and the task card.
      endOf: 'Fin de l’échange',
      endFailed: (n: number, recovered: boolean) => plural(n, `${n} échec`, `${n} échecs`) + (recovered ? plural(n, ' rattrapé', ' rattrapés') : ''),
      subagent: 'sous-agent', openThread: (n: string) => `Ouvrir le fil ${deName(n)}`,
      launched: (n: number) => plural(n, 'Sous-agent lancé', 'Sous-agents lancés'),
      tally: {
        done: (n: number) => plural(n, `${n} terminé`, `${n} terminés`), working: (n: number) => `${n} en cours`, error: (n: number) => `${n} en échec`
      } as Record<'done' | 'working' | 'error', (n: number) => string>,
      quote: (s: string) => `« ${s} »`,
      waits: {
        permission: (n: string) => `${n} attend votre accord pour une commande.`, question: (n: string) => `${n} attend votre réponse à une question.`,
        plan: (n: string) => `${n} attend votre accord sur son plan.`, diff: (n: string) => `${n} attend votre accord sur une modification.`
      } as Record<'permission' | 'question' | 'plan' | 'diff', (n: string) => string>,
      resumes: 'Le fil reprend après votre réponse.',
      // La ligne d'attente : l'agent travaille sans action en cours. D'abord ce que montre le fil, puis la banque, puis le temps.
      working: {
        label: 'L’agent travaille',
        prompt: { you: 'Lit votre message…', parent: 'Lit sa consigne…' } as Record<'you' | 'parent', string>,
        received: (n: string) => `Lit le message de ${n}…`,
        // [avant, après] la cible de l'action, en code.
        tool: { read: ['Vient de lire ', '…'], search: ['Parcourt les résultats de ', '…'], command: ['Regarde le résultat de ', '…'], edit: ['Relit sa modification de ', '…'] } as Record<ToolKind, readonly [string, string]>,
        failed: ['Regarde pourquoi ', ' a échoué…'] as readonly [string, string],
        helper: (n: string) => `Reprend le rapport ${/^[aeiouyhéèêàâîôû]/i.test(n) ? `d’${n}` : `de ${n}`}…`,
        decision: 'Reprend après votre réponse…', said: 'Enchaîne…',
        bank: ['Tourne sept fois sa langue…', 'Consulte ses notes…', 'Tire sur un fil…', 'Pèse le pour et le contre…', 'Gratte le papier…', 'Fait chauffer les neurones…', 'Cherche le mot juste…', 'Relit une dernière fois…'] as readonly string[],
        long: 'Prend son temps, ça cogite…'
      },
      planDecided: {
        accept: 'Vous avez approuvé le plan', always: 'Vous avez approuvé le plan en mode automatique', deny: 'Vous avez renvoyé le plan à revoir', unknown: 'Plan répondu dans le terminal'
      } as Record<'accept' | 'always' | 'deny' | 'unknown', string>,
      objective: 'Objectif de la session', notedBy: (n: string) => `· noté par ${n}`,
      tags: { story: 'Story', objectif: 'Objectif' },
      tagValues: { 'hors-story': 'Hors story', analyse: 'Analyse', correction: 'Correction', implementation: 'Implémentation' } as Record<string, string>,
      task: {
        kicker: 'Tâche', statuses: { killed: 'Arrêtée', completed: 'Terminée', failed: 'En échec', other: 'Notifiée' } as Record<'killed' | 'completed' | 'failed' | 'other', string>,
        agent: 'L’agent', command: 'La commande',
        agentDid: { killed: 'a été arrêté. Il peut reprendre si vous lui écrivez.', completed: 'a terminé en arrière-plan.', failed: 'a échoué en arrière-plan.', other: 's’est arrêté.' } as Record<'killed' | 'completed' | 'failed' | 'other', string>,
        commandDid: { killed: 'a été arrêtée.', completed: 's’est terminée en arrière-plan.', failed: 'a échoué en arrière-plan.', other: 's’est arrêtée.' } as Record<'killed' | 'completed' | 'failed' | 'other', string>,
        code: (c: string) => `code ${c}`, raw: 'Notification brute'
      },
      loading: 'Chargement du fil…', empty: 'Rien dans le fil pour l’instant.', notLoaded: 'Le fil n’a pas été chargé avant la perte de connexion.'
    },
    message: {
      sent: 'Message envoyé', received: 'Message reçu',
      readBy: (n: string) => `Lu par ${n}`, delivered: 'Remis, pas encore lu', sending: 'Envoi…', failed: 'Non remis',
      conversation: (n: string, k: number) => `Échange avec ${n} · ${k} messages`, fold: 'Replier', unfold: 'Déplier',
      readAll: 'Lire tout le message', showLess: 'Réduire', seeIn: (n: string) => `Voir dans le fil de ${n}`,
      to: 'À', from: 'De', seeTheirs: 'voir son fil', seen: 'lu'
    },
    /** Claude Code's automated cross-session notices (NoticeLine): system events, never the user's words. */
    seat: {
      task: (id: string, title: string, giver: string, state: string) => `${id} · ${title} · donnée par ${giver} · ${state}`,
      seeTasks: 'Voir les tâches', pinned: 'Tâche en cours', autonomy: { ask: 'demande', edits: 'modifie sans demander', auto: 'autonome' }
    },
    notice: {
      task: 'TÂCHE', taskFrom: (name: string) => `Tâche de ${name}`, team: 'ÉQUIPE', teamJoined: 'Équipe rejointe',
      kicker: 'Avis automatique', other: 'Avis automatique entre sessions', anotherSession: 'une autre session',
      idle: (n: string, time?: string) => `${n} a terminé${time ? ` · ${time}` : ''}`,
      exited: (n: string, time?: string) => `Session ${n} fermée${time ? ` · ${time}` : ''}`,
      unavailable: (n: string) => `Aucun avis de fin à attendre de ${n}`,
      expired: (n: string) => `Plus d’avis de fin attendu de ${n} : délai dépassé`,
      messages: (count: number, to: string) => (count > 1 ? `${count} messages à ${to}` : `Message à ${to}`),
      status: {
        held: (many: boolean) => `retenu${many ? 's' : ''} : en attente d’approbation`,
        denied: (many: boolean) => `non remis : refusé${many ? 's' : ''} par son utilisateur`,
        expired: (many: boolean) => `non remis : jamais approuvé${many ? 's' : ''}`,
        refused: (many: boolean) => `non remis : la session ${many ? 'les' : 'le'} refuse`,
        dropped: (many: boolean) => `non remis : rejeté${many ? 's' : ''} par sa boîte de réception`,
        delivered: (_many: boolean) => 'remis après approbation',
        unknown: (_many: boolean) => ': avis de remise'
      },
      open: (n: string) => `Ouvrir ${n}`
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
      workPlan: 'Plan de travail', updated: 'plan de travail mis à jour',
      allDone: 'Tout est fait', paused: 'En pause',
      doneOf: (d: number, n: number) => `${d}/${n} faites`, inProgress: (t: string) => `en cours : ${t}`,
      boxes: { completed: 'Fait', in_progress: 'En cours', pending: 'À faire' } as Record<TodoStatus, string>
    }
  },
  launch: {
    prompt: 'Consigne', placeholder: 'Que doit faire l’agent ? Décrivez le résultat attendu.',
    suggestions: 'Suggestions', ideas: ['Relire la dernière pull request', 'Corriger les tests qui échouent', 'Mettre à jour la documentation'] as readonly string[],
    agent: 'Agent', agentHint: 'Le moteur de cette session', change: 'Changer', chooseFor: 'Choisir pour cette session', byDefaultTag: 'Par défaut', thisSession: 'Cette session', defaultMark: 'Défaut',
    isDefault: 'Présélectionné pour vos prochaines sessions.', defaultStays: (n: string) => `Votre défaut reste ${n}.`, setDefault: (n: string) => `Définir ${n} par défaut`, doneChoosing: 'Terminer le choix',
    onlyThisOne: (n: string) => `Pour cette session uniquement. Défaut : ${n}.`, backToDefault: 'Revenir au défaut',
    switched: (n: string) => `${n} pour cette session. Consigne, projet et dépôts conservés ; modèle remis au défaut de l’agent.`, defaultSaved: (n: string) => `${n} sera présélectionné pour les prochaines sessions.`,
    ompNative: 'Conversation pilotée dans Ledge. Seul le shell libre reste disponible, sans suivi terminal OMP.',
    approval: 'Autorisations', approvalOutdated: 'Mettez à jour Ledge sur cette machine pour choisir les autorisations d’OMP : il demandera avant chaque écriture ou commande.',
    approvals: { 'always-ask': ['Demander', 'Avant chaque écriture ou commande'], write: ['Fichiers auto', 'Écrit sans demander, demande avant les commandes'], yolo: ['Auto', 'Approuve tout, commandes comprises'] } as Record<OmpApproval, readonly [string, string]>,
    tools: { claude: ['Claude Code', 'Conception, revue'], codex: ['Codex', 'Code et tests'], cursor: ['Cursor Agent', 'Dans l’éditeur'], omp: ['OMP', 'Piloté en natif'] } as Record<'claude' | 'codex' | 'cursor' | 'omp', readonly [string, string]>,
    project: 'Projet', machine: 'Machine', offline: 'hors ligne', offlineTitle: 'Hors ligne : reconnectez la machine dans les réglages',
    repos: (m: string) => `Dossiers et dépôts sur ${m}`, noGit: 'Dossier sans Git', notFound: 'introuvable', oneRepo: (t: string) => `Un seul dossier ou dépôt pour ${t}`,
    noRepos: (p: string, m: string) => `Aucun dossier ni dépôt de ${p} sur ${m}.`, editProject: 'Modifier le projet',
    noProjects: 'Aucun projet pour l’instant.', noProjectsBody: 'Créez un projet pour y lancer des agents.', newProject: 'Nouveau projet',
    newAgent: 'Un nouvel agent', joins: (n: string, t: string) => `${n} rejoindra la table ${t}`, seat: (n: number, m: string, r: string) => `Place ${n} · ${m} · ${r}`, noRepo: 'aucun dossier ni dépôt',
    missing: { prompt: 'Écrivez la consigne', machine: 'Aucune machine en ligne', repos: 'Choisissez au moins un dossier ou un dépôt' } as Record<'prompt' | 'machine' | 'repos', string>,
    cancel: 'Annuler', launch: 'Lancer', launching: 'Lancement…',
    started: (n: string, t: string) => `${n} démarre à la table ${t}.`, startedNoTable: (n: string) => `${n} démarre, sans projet.`, refused: (m: string) => `Démarrage refusé : ${m}`,
    timeout: 'Le démarrage n’a pas répondu. Vérifiez la machine puis réessayez.',
    modelOf: (t: string) => `Modèle de ${t}`, remembered: 'Dernier choix pour ce projet retenu',
    byDefault: 'Par défaut', byDefaultHint: 'Celui que l’agent prend de lui-même', defaultBadge: 'défaut',
    exactId: 'Identifiant exact, passé tel quel', currentBadge: 'actuel',
    searchModel: 'Chercher un modèle ou taper un identifiant', searchFew: 'Chercher, ou taper un identifiant', searchMany: (n: number) => `Chercher parmi ${n} modèles, ou taper un identifiant`, resultCount: (n: number, total: number) => `${n} sur ${total}`,
    useAsIs: 'Utiliser tel quel', noMatch: 'Aucun modèle ne correspond.', notAnId: 'Aucun modèle ne correspond, et ce n’est pas un identifiant de modèle.', moreModels: (n: number) => `${n} autres : tapez pour les chercher`,
    modelsLoading: 'Lecture des modèles de la machine…', modelsUnavailable: (e: string) => `Liste des modèles indisponible (${e}) : le défaut et un identifiant exact restent possibles.`,
    ompOutdated: 'OMP ne peut pas être lancé ici : mettez à jour Ledge sur cette machine.', ompUnavailable: (e: string) => `OMP ne peut pas être lancé sur cette machine (${e}). Choisissez un autre agent ou réparez OMP là-bas ; rien n’est changé à votre place.`,
    modelsOutdated: 'Mettez à jour Ledge sur cette machine pour choisir le modèle.',
    effort: 'Effort', effortHint: 'Temps de réflexion par tour', cursorEffort: 'Effort compris dans le nom du modèle', lessEffort: 'Moins d’effort', moreEffort: 'Plus d’effort',
    efforts: { low: 'Bas', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max', ultra: 'Ultra' } as Record<string, string>,
    modelHints: { 'claude:fable': 'Le plus capable', 'claude:opus': 'Très capable, plus lent', 'claude:sonnet': 'Équilibré, usage courant', 'claude:haiku': 'Rapide et économique' } as Record<string, string>,
    pickSummary: (m: string, e?: string) => (e ? `${m} · ${e}` : m)
  },
  projects: {
    titles: {
      new: 'Nouveau projet', edit: (n: string) => `Modifier ${n}`, delete: (n: string) => `Supprimer ${n}`,
      scan: 'Ledge prépare un projet', proposal: 'Proposition de Ledge', proposalFor: (n: string) => `Proposition de Ledge pour ${n}`
    },
    name: 'Nom', namePlaceholder: 'Ex. Paper Rendering', color: 'Couleur',
    colors: { blue: 'Bleu', green: 'Vert', amber: 'Ambre', violet: 'Violet', teal: 'Sarcelle', pink: 'Rose', red: 'Rouge', slate: 'Ardoise' } as Record<ProjectColor, string>,
    description: 'Description', optional: 'facultatif', descriptionPlaceholder: 'Une phrase qui dit à quoi sert le projet',
    repos: (n: number) => `Dossiers et dépôts de travail · ${n}`, branchTitle: 'Branche par défaut détectée', noGit: 'Dossier sans Git',
    notFound: 'introuvable', offline: 'hors ligne', remove: (n: string, m: string) => `Retirer ${n} (${m})`, addRepo: 'Ajouter un dossier ou un dépôt',
    empty: 'Aucun dossier ni dépôt pour l’instant. Le projet peut exister sans, mais Ledge ne saura pas y ranger les sessions.',
    fileToo: 'Ranger aussi',
    problems: { name_empty: 'Donnez un nom au projet', name_taken: 'Ce nom est déjà utilisé par un autre projet', repo_duplicate: 'Ce dossier est en double', gone: 'Ce projet a été supprimé entre-temps',
      repo_taken: (p: string) => `Ce dossier est déjà dans ${p}` },
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
    /** Why Ledge proposes a repository (`small.pe-why`, after « Ledge · »); `chat` is the LLM's own reason. */
    why: (w: Why): string => w.kind === 'remote' ? `Même remote ${w.remote}${w.machines.length > 1 ? `, sur ${andList(w.machines)}` : ''}`
      : w.kind === 'agent' ? `Dossier ouvert par ${andList(w.names)}`
      : w.kind === 'naming' ? `Nommé ${w.stem}-*`
      : w.kind === 'name' ? (w.in === 'remote' ? `Remote ${w.value} proche de « ${w.word} »` : w.in === 'manifest' ? `Manifeste « ${w.value} » proche de « ${w.word} »` : `Nom proche de « ${w.word} »`)
      : w.kind === 'folder' ? `Rangé dans ${w.parent}`
      : w.text,
    /** « Laisser Ledge faire » (lot 11): the offer, the scan's steps, the proposal. */
    ledge: {
      offerTitle: 'Pas envie de chercher les dépôts vous-même ?',
      offerBody: 'Ledge parcourt vos machines, regroupe les dépôts qui vont ensemble et vous propose un projet à vérifier.',
      offer: 'Laisser Ledge faire', ask: 'Demander à Ledge',
      /** The offer once a name is typed (#22); `browse` opens the folder browser after a scan cut short. */
      searchFor: (name: string) => `Chercher les dépôts de « ${name} »`, browse: 'Parcourir les dossiers',
      scanning: (ms: readonly string[]) => `Ledge parcourt ${ms.length ? andList(ms) : 'vos machines'}…`,
      step: (s: ScanStep): string => s.state === 'waiting' ? `Parcourt ${s.label}…`
        : s.state === 'done' ? `${s.label} · ${s.repos} dépôt${plural(s.repos, '', 's')} trouvé${plural(s.repos, '', 's')}${s.truncated ? ' · parcours limité' : ''}`
        : s.state === 'outdated' ? `${s.label} : daemon trop ancien, ignorée`
        : s.state === 'timeout' ? `${s.label} n’a pas répondu, ignorée`
        : s.state === 'failed' ? `${s.label} : le parcours a échoué, ignorée`
        : `${s.label} hors ligne, ignorée`,
      compared: 'Remotes et sessions comparés',
      proposes: 'Ledge propose', check: 'Décochez ce qui ne va pas, puis validez : rien n’est créé avant.',
      summary: (s: Summary): string => {
        const n = `${s.repos} dépôt${plural(s.repos, '', 's')}`;
        const on = s.machines.length ? `sur ${andList(s.machines)}` : '';
        const head = s.target ? `${n} de plus pour ${s.target}${on ? `, ${on}` : ''}.` : `${n}${on ? ` ${on}` : ''}.`;
        return head + (s.agents.length ? ` À ranger aussi : ${andList(s.agents)}.` : '');
      },
      nothing: 'Tous les dépôts trouvés appartiennent déjà à un projet. Ajoutez-en un à la main.',
      /** Appended to the proposal and to « nothing »: the machines whose walk was cut short, so what was found may not be all. */
      limited: (ms: readonly string[]) => ` · parcours limité sur ${andList(ms)}`,
      unscanned: 'Aucune machine n’a pu être parcourue.', again: 'Relancer',
      why: 'Ledge · ', keep: (n: string, m: string) => `Garder ${n} (${m})`, addTo: (n: string) => `Ajouter à ${n}`,
      gone: 'Cette proposition n’existe plus.',
      already: (n: string) => `Tout est déjà dans ${n}.`
    },
    picker: {
      machines: 'Machine à parcourir', offline: 'hors ligne',
      offlineBody: (m: string) => `${m} est hors ligne. Reconnectez-la dans Réglages › Machines pour parcourir ses dossiers.`,
      crumbs: 'Dossier courant', root: 'racine', parent: 'Dossier parent', contents: (d: string, m: string) => `Contenu de ${d} sur ${m}`,
      open: (n: string) => `Ouvrir ${n}`,
      noGit: 'sans Git', add: 'Ajouter', added: 'Ajouté', addLabel: (n: string, m: string) => `Ajouter ${n} (${m})`, addedLabel: (n: string) => `${n} déjà ajouté`,
      typed: (m: string) => `Chemin sur ${m}`, typedPlaceholder: (m: string) => `Ou saisissez un chemin sur ${m}`,
      offlinePath: (m: string) => `${m} est hors ligne : impossible de vérifier ce chemin.`, notFound: (m: string) => `Dossier introuvable sur ${m}.`,
      alreadyListed: 'Ce dossier est déjà dans la liste.', absolute: 'Saisissez un chemin complet, qui commence par /.',
      ownedBy: (p: string) => `Déjà dans ${p}`, ownedLabel: (n: string, p: string) => `${n} est déjà dans ${p}`,
      timeout: 'Le dossier n’a pas répondu.', retry: 'Réessayer',
      /** « Nouveau dossier » (#32): made in the folder shown, on its machine. */
      newFolder: 'Nouveau dossier', newFolderName: (d: string, m: string) => `Nom du nouveau dossier dans ${d} sur ${m}`,
      create: 'Créer', creating: 'Création…', cancel: 'Annuler', created: (n: string, m: string) => `${n} créé sur ${m}.`,
      nameEmpty: 'Saisissez un nom pour le dossier.', nameInvalid: 'Choisissez un nom sans /, autre que . et ..',
      exists: (n: string) => `${n} existe déjà ici.`, createOffline: (m: string) => `${m} est hors ligne : le dossier n’a pas été créé.`,
      createTimeout: (m: string) => `${m} n’a pas répondu : vérifiez le dossier avant de réessayer.`, createFailed: (why: string) => `Le dossier n’a pas été créé : ${why}`
    }
  },
  /** The Ledge chat (shared ChatView): the notch's `chat`, `machines` (those its cards read) and `time` copy, word for word. */
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
    // #24 : plusieurs sessions dans une réponse.
    group: { label: (n: number) => `${n} sessions proposées`, launchAll: (n: number) => `Tout lancer (${n})`, launchRow: 'Lancer', pick: (project: string) => `Lancer ${project}` },
    closeGroup: { label: (n: number) => n === 1 ? 'Session à fermer' : `${n} sessions à fermer`, row: 'Fermer', all: (n: number) => `Fermer tout (${n})`, closing: 'Fermeture…', closed: 'Fermée', killed: 'Fermée de force', ended: 'Terminée', retry: 'Réessayer', failed: (m: string) => `Échec : ${m}` },
    relay: {
      label: 'Instruction à envoyer', session: 'Session', instruction: 'Instruction',
      send: 'Envoyer', sending: 'Envoi…', cancel: 'Annuler', retry: 'Réessayer', orRephrase: 'ou reformule ta demande',
      queued: 'travaille, j’enverrai dès qu’il aura fini', sentTo: 'Envoyé à', failed: (why: string) => `Échec de l’envoi : ${why}`,
      pill: { yours: 'à toi', working: 'travaille', waiting: 'attend ta réponse', stopped: 'arrêtée' }
    },
    team: {
      label: 'Équipe proposée', folder: 'Dossier', table: (project: string) => `Table`, newTable: (project: string) => `nouvelle table dans la pièce ${project}`, seats: 'Sièges',
      autonomy: { ask: 'demande avant d’agir', edits: 'modifie sans demander', auto: 'autonome' },
      autoWarning: (roles: string) => `${roles} travaillera sans demander : modifications et commandes sans ton accord.`,
      launch: 'Lancer l’équipe', launching: 'Lancement…', retry: 'Réessayer', save: 'Enregistrer', saved: (path: string) => `Enregistrée : ${path}`,
      launched: (at: string) => `Équipe lancée à ${at}`, openTable: 'Ouvrir la table', failed: (why: string) => `Échec : ${why}`, template: (id: string) => `modèle ${id}`
    },
    task: {
      label: (n: number) => n === 1 ? 'Tâche à confier' : `${n} tâches à confier`, to: 'à', give: 'Confier', giving: 'Envoi…', retry: 'Réessayer',
      waitTeam: 'active une fois l’équipe lancée',
      given: (owner: string, id: string, state: string) => `Confiée à ${owner} · ${id} · ${state}`,
      state: { open: 'à prendre', taken: 'prise', done: 'finie', refused: 'refusée', dropped: 'abandonnée' }, failed: (why: string) => `Refusée : ${why}`
    },
    // #94 : la carte générique, une ligne par action, un plan au-delà d’une (docs/mockups/ledge-action-card.html).
    action: {
      label: (n: number) => n > 1 ? `Plan de ${n} actions` : 'Action proposée',
      risk: { read: 'Lecture', reversible: 'Réversible', destructive: 'Irréversible' },
      riskTip: { read: 'rien ne change', reversible: 'Ledge peut le défaire', destructive: 'Ledge ne peut pas le défaire' },
      step: (k: number) => `Étape ${k}`,
      stepState: { done: (k: number) => `Étape ${k}, appliquée`, failed: (k: number) => `Étape ${k}, échouée`, refused: (k: number) => `Étape ${k}, refusée`, running: (k: number) => `Étape ${k}, en cours` },
      askAgain: 'je te redemanderai',
      verbs: {
        'session.model': 'Changer', 'session.interrupt': 'Interrompre', 'session.archive': 'Archiver', 'session.restore': 'Restaurer', 'session.resume': 'Reprendre',
        'session.decide': 'Accepter', 'team.join': 'Ajouter', 'team.leave': 'Retirer', 'team.resume': 'Reprendre', 'team.dissolve': 'Dissoudre', 'team.save': 'Enregistrer',
        'task.cancel': 'Abandonner', 'task.pass': 'Passer le relais'
      } as Record<string, string>,
      apply: 'Appliquer', deny: 'Refuser', ignore: 'Ignorer', review: 'Revoir', retry: 'Réessayer', running: 'En cours…',
      done: (at: string) => `Appliquée · ${at}`, refusedState: 'Refusée', denied: (at: string) => `Refus envoyé · ${at}`, open: (name: string) => `Ouvrir ${name}`,
      failed: (why: string) => `Échec : ${why}`, refused: (why: string) => `Refusée : ${why} Rien n’a été envoyé.`,
      held: (k: number) => `Pas appliquée : le plan s’est arrêté à l’étape ${k}.`,
      stale: (name: string) => `La demande de ${name} a changé depuis ma réponse : rien n’a été envoyé. Ouvre ${name} pour voir la nouvelle, ou redemande-moi.`,
      deniedNote: (name: string) => `${name} a reçu ton refus : la commande n’a pas été lancée.`,
      all: (n: number) => `Tout appliquer (${n})`, resume: (k: number, n: number) => `Reprendre à l’étape ${k} (${n})`, skip: (k: number, n: number) => `Continuer sans l’étape ${k} (${n})`,
      inOrder: 'dans l’ordre, s’arrête au premier échec', destructiveLater: (n: number) => `${n} ${n > 1 ? 'irréversibles' : 'irréversible'}, je te redemanderai`,
      notReplayed: 'les étapes faites ne sont pas rejouées', progress: (k: number, n: number) => `Étape ${k} sur ${n}…`, planDone: (at: string) => `Plan appliqué à ${at}`,
      confirm: {
        label: 'Confirmation', many: (n: number, all: boolean) => `Appliquer ${all ? 'ces' : 'les'} ${n} actions, dans l’ordre ?`, one: (summary: string) => `${summary} ?`,
        oneWhy: 'Ledge ne pourra pas la défaire une fois envoyée.',
        manyWhy: (d: number) => `${d === 1 ? 'Une est irréversible' : `${d} sont irréversibles`} : relis ${d === 1 ? 'son' : 'leur'} détail ci-dessus. Si une étape échoue, les suivantes ne sont pas appliquées.`,
        cancel: 'Annuler', go: (n: number) => `Appliquer les ${n}`, alreadyDone: 'déjà faite'
      },
      ignored: (n: number, at: string) => `${n > 1 ? `Plan de ${n} actions ignoré` : 'Carte ignorée'} à ${at} · rien n’a été envoyé`
    },
    project: {
      label: 'Proposition de projet', title: (name: string) => `Proposition de projet · ${name}`, complete: (name: string) => `Compléter ${name}`,
      repos: (n: number) => `${n} dépôt${n > 1 ? 's' : ''}`, review: 'Vérifier la proposition'
    },
  },
  machines: { clarification: 'Vous pouvez aussi répondre dans le chat.', destination: 'Destination', choose: (name: string) => `Sur ${name}.`, local: 'Cette machine', offline: 'Hors ligne' },
  whatsNew: {
    title: (v: string) => `Nouveautés de Ledge ${v}`, updated: (v: string) => `Ledge a été mis à jour en ${v}`,
    none: 'Les notes de cette version ne sont pas sur cette machine. Elles sont sur sa release GitHub.',
    skipped: (from: string) => `Vous veniez de Ledge ${from} : les notes des versions intermédiaires sont sur les releases GitHub.`,
    release: 'Release GitHub', all: 'Toutes les releases', later: 'Plus tard', update: 'Mettre à jour', open: 'Nouveautés'
  },
  /** The detached Atelier (#21): its own window, beside the session the main window keeps. */
  detached: {
    detach: 'Détacher l’Atelier', detachTitle: 'Ouvrir l’Atelier dans sa propre fenêtre',
    away: 'L’Atelier est dans sa propre fenêtre', awayBody: 'Les sessions que vous y ouvrez s’affichent ici.',
    show: 'Afficher l’Atelier', attach: 'Rattacher ici', attachTitle: 'Remettre l’Atelier dans la fenêtre principale'
  },
  time: { seconds: (n: number) => `${n} s`, minutes: (n: number) => `${n} min`, hours: (n: number) => `${n} h`, locale: 'fr-FR' },
  /** Why the chat cannot send while the local daemon is away. */
  offline: 'Le daemon local est hors ligne.',
  stateLabel: { approval: 'Votre accord', question: 'Une question', starting: 'Démarrage', idle: 'Disponible', working: 'Au travail', done: 'Terminée', error: 'Erreur', readonly: 'Lecture seule' } as Record<BotState, string>,
  botLabel: { starting: 'Démarrage', working: 'Au travail', approval: 'Attend votre accord', question: 'A une question', idle: 'Disponible', error: 'Erreur', done: 'Terminée', readonly: 'Lecture seule' } as Record<BotState, string>,
  botReadOnly: 'Lecture seule',
  botNotLive: 'Figé',
  resident: { name: 'Ledge', offline: 'Ledge · connexion perdue' }
};
