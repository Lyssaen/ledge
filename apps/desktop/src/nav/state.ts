import type { Projects, Session } from '@ledge/protocol';
import type { Overview } from './overview';

export type View = 'atelier';
/** 'all', 'none' (Sans projet) or a project id. */
export type ProjectFilter = string;
export type SectionId = 'general' | 'workspace' | 'appearance' | 'island' | 'notifications' | 'sounds' | 'machines' | 'mobile' | 'projects' | 'notes' | 'shortcuts' | 'about';
/** `workspace` is the IDE's own: the Settings nav shows it only while « Interface IDE (aperçu) » is on. */
export const SECTIONS: readonly SectionId[] = ['general', 'workspace', 'appearance', 'island', 'notifications', 'sounds', 'machines', 'mobile', 'projects', 'notes', 'shortcuts', 'about'];
/** The tabs of Ledge's home view (ledge home spec §2.2). */
export type HomeTab = 'conversation' | 'tasks' | 'history';
export const HOME_TABS: readonly HomeTab[] = ['conversation', 'tasks', 'history'];
/** A dialog of the OpenRig page to open on arrival (docs/mockups/ledge-sidebar-tidy.html): the rig launch form, or a running rig's seats. */
export type OpenRigOpen = { launch: true } | { reseat: string };

export type Place =
  /** Ledge's home view, where the app opens (ledge home spec §2.1): `view` and `project` are the atelier's, kept for the
   *  way back; `back` is the place Échap returns to (none at start: the atelier). */
  | { kind: 'home'; tab: HomeTab; view: View; project: ProjectFilter; back?: Exclude<Place, { kind: 'settings' } | { kind: 'home' }>; /** The task « Tâches » opens on. */ task?: string }
  | { kind: 'overview'; view: View; project: ProjectFilter }
  /** helper : la page d'un sous-agent de `id` ; focus : la réponse prend le focus à l'arrivée (« Répondre ») ; item : le message (id du fil) que la page met en vue et allume (« Voir dans le fil de X »). */
  | { kind: 'session'; id: string; helper?: string; focus?: 'reply'; item?: string; doc?: string; view: View; project: ProjectFilter }
  | { kind: 'settings'; section: SectionId; back: Exclude<Place, { kind: 'settings' }> }
  /** OpenRig on a machine (docs/mockups/ledge-openrig.html): its daemon, its kernel and its rigs. `machine`: the one shown, local when absent.
   *  `section` 'roles': its roles (docs/mockups/ledge-openrig-roles.html), `role` the one open (library id), `seat` the seat
   *  it is seen from (`rig/logicalId`), from the spec when absent. */
  | { kind: 'openrig'; machine?: string; section?: 'roles'; role?: string; seat?: string; open?: OpenRigOpen; view: View; project: ProjectFilter };
export type Modal =
  | { kind: 'search' } | { kind: 'shortcuts' }
  // project : la table ou le projet d'où on l'a demandée (lot 7) ; from : 'plus' quand c'est le + d'un groupe de l'IDE (ignoré hors IDE)
  | { kind: 'launch'; project?: string; from?: 'plus' }
  // edit : id du projet à modifier ; file : id de la session à y ranger (lot 8) ; delete : ouvert sur sa vue de suppression (Réglages › Projets, lot 10) ;
  // addFolder : ouvert sur le navigateur de dossiers (« Ajouter un dossier… » du menu d'un projet) ;
  // proposal : le pid d'une proposition de Ledge retenue par rememberProposal (lot 11), ouverte pour être vérifiée
  | { kind: 'project'; edit?: string; file?: string; delete?: true; proposal?: string; addFolder?: true }
  // to : un projet (son id) ou les sessions choisies dans la barre latérale (ids qualifiés) ; la flotte envoie à chaque machine qui en a sa part (broadcast)
  | { kind: 'broadcast'; to: { project: string } | { sessions: string[] } }
  // IDE lot 7d (R8) : « Lancer un rig », sur `machine` (sans elle, la machine affichée de la vue Rigs) ; dessinée seulement interrupteur ouvert
  | { kind: 'rigLaunch'; machine?: string }
  | null;
/** Every place and dialog kind, as the Ledge guide (docs/ledge-guide.md) must describe them: a Record, so a new kind fails to compile until it is listed here. */
const PLACE_KIND: Record<Place['kind'], true> = { home: true, overview: true, session: true, settings: true, openrig: true };
export const PLACE_KINDS = Object.keys(PLACE_KIND) as Place['kind'][];
const MODAL_KIND: Record<NonNullable<Modal>['kind'], true> = { search: true, shortcuts: true, launch: true, project: true, broadcast: true, rigLaunch: true };
export const MODAL_KINDS = Object.keys(MODAL_KIND) as NonNullable<Modal>['kind'][];
/** chatFocus: bumped each time the chat is asked for (/, an open button), even already open: its field takes the focus again. */
export interface NavState { place: Place; modal: Modal; chat: boolean; chatFocus: number; fullscreen: boolean; helpers: boolean; paused: boolean }
export type NavAction =
  /** The atelier (the overview), on a project filter. */
  | { type: 'home'; project?: ProjectFilter }
  /** Ledge's home view, on a tab; its composer takes the focus (`chatFocus`). */
  | { type: 'ledge'; tab?: HomeTab; task?: string }
  /** Sets the current place's project filter without going anywhere (a session page stays open; in Settings, the place behind). */
  | { type: 'filter'; project: ProjectFilter }
  | { type: 'open'; id: string; helper?: string; focus?: 'reply'; item?: string; /** A file to open in its side pane on arrival (« À toi »'s source). */ doc?: string; /** IDE only: where the tab opens, over the setting « Ouvrir une session »; the reducer ignores it. */ where?: 'active' | 'right' }
  | { type: 'settings'; section?: SectionId }
  /** The OpenRig page, on a machine (the one shown before, else local), on its rigs or its roles (the section shown before,
   *  else the rigs). `role`: open that role, seen from `seat` (`rig/logicalId`) or from its spec. */
  | { type: 'openrig'; machine?: string; section?: 'rigs' | 'roles'; role?: string; seat?: string; open?: OpenRigOpen }
  | { type: 'modal'; modal: Modal }
  | { type: 'chat'; open?: boolean }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'helpers' } | { type: 'paused' }
  | { type: 'escape' };

/** A click that opens a session: Ctrl/⌘ held, to the right (the IDE; the reducer ignores `where`), else where the setting says. */
export const openClick = (id: string, e: { ctrlKey: boolean; metaKey: boolean }): NavAction => ({ type: 'open', id, ...((e.ctrlKey || e.metaKey) && { where: 'right' as const }) });

/** Where the app opens: Ledge's home view (ledge home spec §2.1); the detached Atelier's window opens on the atelier. */
export function initialNav(overview: Overview, start: 'home' | 'atelier' = 'home'): NavState {
  return { place: start === 'home' ? { kind: 'home', tab: 'conversation', view: 'atelier', project: 'all' } : { kind: 'overview', view: 'atelier', project: 'all' }, modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: overview.helpers, paused: overview.paused };
}

type Base = Exclude<Place, { kind: 'settings' }>;
const baseOf = (p: Place): Base => (p.kind === 'settings' ? p.back : p);

export function navReducer(s: NavState, a: NavAction): NavState {
  const { place } = s;
  switch (a.type) {
    case 'home':
      return { ...s, place: { kind: 'overview', view: 'atelier', project: a.project ?? 'all' } };
    case 'ledge': {
      const b = baseOf(place);
      const back = b.kind === 'home' ? b.back : b;
      const tab = a.tab ?? (place.kind === 'home' ? place.tab : 'conversation');
      // The docked chat closes: the home view is the same conversation, wider.
      return { ...s, place: { kind: 'home', tab, view: b.view, project: b.project, ...(back ? { back } : {}), ...(a.task ? { task: a.task } : {}) }, modal: null, chat: false, chatFocus: s.chatFocus + 1 };
    }
    case 'filter': {
      if (baseOf(place).project === a.project) return s;
      return { ...s, place: place.kind === 'settings' ? { ...place, back: { ...place.back, project: a.project } } : { ...place, project: a.project } };
    }
    // 'open', and the other navigations that clear `modal` ('ledge', 'settings', 'openrig'), do not close a dialog in the IDE:
    // App.tsx's front-tab sync re-sends the open modal right after the navigation it dispatches.
    case 'open': {
      const b = baseOf(place);
      return { ...s, place: { kind: 'session', id: a.id, ...(a.helper !== undefined && { helper: a.helper }), ...(a.focus !== undefined && { focus: a.focus }), ...(a.item !== undefined && { item: a.item }), ...(a.doc !== undefined && { doc: a.doc }), view: b.view, project: b.project }, modal: null, chat: false };
    }
    case 'settings':
      return { ...s, place: { kind: 'settings', section: a.section ?? 'general', back: baseOf(place) }, modal: null, chat: false };
    case 'openrig': {
      const b = baseOf(place);
      const prev = b.kind === 'openrig' ? b : undefined;
      const machine = a.machine ?? prev?.machine;
      const section = a.section ?? (a.role !== undefined ? 'roles' : prev?.section ?? 'rigs');
      // A role belongs to its machine: another machine opens on its list. Naming a role names its lens too.
      const same = prev !== undefined && machine === prev.machine;
      const role = a.role ?? (same ? prev.role : undefined);
      const seat = a.role !== undefined ? a.seat : same ? prev.seat : undefined;
      return { ...s, place: { kind: 'openrig', ...(machine !== undefined ? { machine } : {}), ...(section === 'roles' ? { section } : {}), ...(role !== undefined ? { role } : {}), ...(seat !== undefined ? { seat } : {}), ...(a.open !== undefined && section !== 'roles' ? { open: a.open } : {}), view: b.view, project: b.project }, modal: null, chat: false };
    }
    case 'modal': return { ...s, modal: a.modal };
    case 'chat': {
      const chat = a.open ?? !s.chat;
      return chat ? { ...s, chat, chatFocus: s.chatFocus + 1 } : { ...s, chat };
    }
    case 'fullscreen': return s.fullscreen === a.on ? s : { ...s, fullscreen: a.on };
    case 'helpers': return { ...s, helpers: !s.helpers };
    case 'paused': return { ...s, paused: !s.paused };
    case 'escape': {
      if (s.modal) return { ...s, modal: null };
      if (s.chat) return { ...s, chat: false };
      if (place.kind === 'settings') return { ...s, place: place.back };
      // Échap from the home view goes back to where the user came from, the atelier at first.
      if (place.kind === 'home') return { ...s, place: place.back ?? { kind: 'overview', view: place.view, project: place.project } };
      if (place.kind === 'session' || place.kind === 'openrig') return { ...s, place: { kind: 'overview', view: place.view, project: place.project } };
      if (place.project !== 'all') return { ...s, place: { ...place, project: 'all' } };
      if (s.fullscreen) return { ...s, fullscreen: false };
      return s;
    }
  }
}

export function reconcile(s: NavState, sessions: readonly Session[], projects: Projects | null): NavState {
  const known = (f: ProjectFilter) => f === 'all' || f === 'none' || (projects !== null && projects.projects.some(p => p.id === f));
  const fix = (b: Base): Base => {
    const project = known(b.project) ? b.project : 'all';
    if (b.kind === 'session' && !sessions.some(x => x.id === b.id)) return { kind: 'overview', view: b.view, project };
    if (b.kind === 'home' && b.back) { const back = fix(b.back) as Exclude<Base, { kind: 'home' }>; if (back !== b.back || project !== b.project) return { ...b, project, back }; }
    return project === b.project ? b : { ...b, project };
  };
  const place = s.place.kind === 'settings' ? (() => { const back = fix(s.place.back); return back === s.place.back ? s.place : { ...s.place, back }; })() : fix(s.place);
  return place === s.place ? s : { ...s, place };
}
