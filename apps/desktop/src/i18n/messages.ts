import type { BotState } from '@ledge/ui/bots/poseFor';
import type { SectionId } from '../nav/state';
import type { Bucket, GroupBy } from '../list/model';

/** French counts 0 and 1 as singular, English only 1. */
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);
const pluralEn = (n: number, one: string, many: string) => (n === 1 ? one : many);

const fr = {
  side: {
    label: 'Barre latérale', newSession: 'Nouvelle session', search: 'Rechercher', searchLabel: 'Rechercher une session',
    views: 'Vues', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projets', newProject: 'Nouveau projet', unassigned: 'Sans projet',
    machines: 'Machines', manageMachines: 'Gérer les machines', agents: (n: number) => plural(n, `${n} agent`, `${n} agents`), offline: 'hors ligne', settings: 'Réglages'
  },
  crumb: { atelier: 'Atelier', list: 'Liste', settings: 'Réglages', clearFilter: 'Retirer le filtre : voir tous les projets', clearFilterTitle: 'Tous les projets (Échap)', escape: 'Échap' },
  top: {
    viewTabs: 'Vue des agents', helpersHide: 'Masquer les sous-agents', helpersShow: 'Afficher les sous-agents', pause: 'Figer les animations', play: 'Animer',
    search: 'Rechercher une session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Raccourcis clavier (?)', fullscreen: 'Plein écran', fullscreenExit: 'Quitter le plein écran'
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
    unconfirmed: (name: string) => `Ledge n’a pas vu la décision pour ${name} aboutir. Ouvrez la session pour vérifier.`
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
  crumb: { atelier: 'Atelier', list: 'List', settings: 'Settings', clearFilter: 'Remove the filter: show every project', clearFilterTitle: 'Every project (Esc)', escape: 'Esc' },
  top: {
    viewTabs: 'Agents view', helpersHide: 'Hide subagents', helpersShow: 'Show subagents', pause: 'Freeze animations', play: 'Animate',
    search: 'Search a session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Keyboard shortcuts (?)', fullscreen: 'Full screen', fullscreenExit: 'Exit full screen'
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
    unconfirmed: (name) => `Ledge did not see the decision for ${name} land. Open the session to check.`
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
