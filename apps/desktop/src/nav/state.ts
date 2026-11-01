import type { ChatRigLaunch, Projects, Rig, Session } from '@ledge/protocol';
import { parseRigFilter } from '@ledge/ui/rigs/model';
import type { Overview } from './overview';

export type View = 'atelier';
/** 'all', 'none' (Sans projet), a project id, a rig (`rig:<machine>/<id>`) or a machine's kernel (`kernel:<machine>`). */
export type ProjectFilter = string;
export type SectionId = 'general' | 'ledge' | 'appearance' | 'island' | 'notifications' | 'sounds' | 'machines' | 'mobile' | 'projects' | 'shortcuts' | 'about';
export const SECTIONS: readonly SectionId[] = ['general', 'ledge', 'appearance', 'island', 'notifications', 'sounds', 'machines', 'mobile', 'projects', 'shortcuts', 'about'];
/** The tabs of the Ledge screen (spec §8, lot 4): its thread, its rigs and its mandate. */
export type HomeTab = 'conversation' | 'rigs' | 'mandat';
export const HOME_TABS: readonly HomeTab[] = ['conversation', 'rigs', 'mandat'];
/** A saved tab: an old one (`history`, `teams`, `tasks`) or anything unknown reads as the conversation. */
export function readHomeTab(saved: string | null): HomeTab {
  return (HOME_TABS as readonly string[]).includes(saved ?? '') ? saved as HomeTab : 'conversation';
}
/** The sub-tabs of the Rigs tab (spec §8.2): the running rigs, the specs a machine offers, every seat. */
export type RigsSub = 'live' | 'specs' | 'agents';
export type Place =
  /** Ledge's home view, where the app opens (ledge home spec §2.1): `view` and `project` are the atelier's, kept for the
   *  way back; `back` is the place Échap returns to (none at start: the atelier); `rigs` the Rigs tab's sub-tab and `spec` the spec
   *  chosen in its Specs, kept while the user goes from tab to tab. */
  | { kind: 'home'; tab: HomeTab; view: View; project: ProjectFilter; focus?: string; back?: Exclude<Place, { kind: 'settings' } | { kind: 'home' }>; rigs?: RigsSub; spec?: string }
  | { kind: 'overview'; view: View; project: ProjectFilter }
  /** helper : la page d'un sous-agent de `id` ; focus : la réponse prend le focus à l'arrivée (« Répondre ») ; item : le message (id du fil) que la page met en vue et allume (« Voir dans le fil de X »). */
  | { kind: 'session'; id: string; helper?: string; focus?: 'reply'; item?: string; view: View; project: ProjectFilter }
  | { kind: 'settings'; section: SectionId; back: Exclude<Place, { kind: 'settings' }> };
export type Modal =
  | { kind: 'search' } | { kind: 'shortcuts' }
  | { kind: 'launch'; project?: string;
      // Pré-remplissage : cwd, le dossier ; machine, celle du dossier (#99), locale si absente.
      cwd?: string; machine?: string }
  // edit : id du projet à modifier ; file : id de la session à y ranger (lot 8) ; delete : ouvert sur sa vue de suppression (Réglages › Projets, lot 10) ;
  // proposal : le pid d'une proposition de Ledge retenue par rememberProposal (lot 11), ouverte pour être vérifiée
  | { kind: 'project'; edit?: string; file?: string; delete?: true; proposal?: string }
  // Lancer un rig (lot 3 : fenêtre d'attente ; le lot 5 la remplit) : pré-remplissage du projet, de la spec, du but et de la machine ;
  // off : le nom de l'espace hors projet (la carte « Lancer ce rig » du cerveau, lot 7).
  | { kind: 'rig-launch'; project?: string; spec?: string; goal?: string; machine?: string; off?: string }
  | null;
/** The launch window a « Lancer ce rig » card opens (lot 7): its project or off-project name, spec, goal and machine. */
export function rigLaunchModal(c: ChatRigLaunch): Extract<Modal, { kind: 'rig-launch' }> {
  return { kind: 'rig-launch', goal: c.goal, ...(c.spec ? { spec: c.spec } : {}), ...(c.project ? { project: c.project } : {}),
    ...(c.off ? { off: c.off } : {}), ...(c.machine ? { machine: c.machine } : {}) };
}
/** What the Ledge screen was on when the user left it: its tab, the Rigs sub-tab, the spec chosen in Specs. */
export interface HomeMemo { tab: HomeTab; rigs?: RigsSub; spec?: string }
/** chatFocus: bumped each time the chat is asked for (/, an open button), even already open: its field takes the focus again.
 *  homeMemo: the Ledge screen as it was left, restored by `{ type: 'ledge' }` without values (set once the user has left it). */
export interface NavState { place: Place; modal: Modal; chat: boolean; chatFocus: number; fullscreen: boolean; helpers: boolean; paused: boolean; homeMemo?: HomeMemo }
export type NavAction =
  /** The atelier (the overview), on a project filter. */
  | { type: 'home'; project?: ProjectFilter }
  /** Ledge's home view, on a tab (and the Rigs tab's sub-tab, the spec chosen in Specs); its composer takes the focus (`chatFocus`). */
  | { type: 'ledge'; tab?: HomeTab; rigs?: RigsSub; spec?: string; focus?: string }
  /** The thread scrolled to the escalation `focus` named: the request is spent. */
  | { type: 'ledge-focused' }
  /** Sets the current place's project filter without going anywhere (a session page stays open; in Settings, the place behind). */
  | { type: 'filter'; project: ProjectFilter }
  | { type: 'open'; id: string; helper?: string; focus?: 'reply'; item?: string }
  | { type: 'settings'; section?: SectionId }
  | { type: 'modal'; modal: Modal }
  | { type: 'chat'; open?: boolean }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'helpers' } | { type: 'paused' }
  | { type: 'escape' };

/** Where the app opens: Ledge's home view (ledge home spec §2.1); the detached Atelier's window opens on the atelier. */
export function initialNav(overview: Overview, start: 'home' | 'atelier' = 'home'): NavState {
  return { place: start === 'home' ? { kind: 'home', tab: 'conversation', view: 'atelier', project: 'all' } : { kind: 'overview', view: 'atelier', project: 'all' }, modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: overview.helpers, paused: overview.paused };
}

type Base = Exclude<Place, { kind: 'settings' }>;
const baseOf = (p: Place): Base => (p.kind === 'settings' ? p.back : p);

/** Leaving the Ledge screen notes its tab, sub-tab and spec (lot-3 minor): they come back with it. */
export function navReducer(s: NavState, a: NavAction): NavState {
  const next = reduce(s, a);
  if (s.place.kind !== 'home' || next.place.kind === 'home') return next;
  const { tab, rigs, spec } = s.place;
  return { ...next, homeMemo: { tab, ...(rigs ? { rigs } : {}), ...(spec !== undefined ? { spec } : {}) } };
}

function reduce(s: NavState, a: NavAction): NavState {
  const { place } = s;
  switch (a.type) {
    case 'home':
      return { ...s, place: { kind: 'overview', view: 'atelier', project: a.project ?? 'all' } };
    case 'ledge': {
      const b = baseOf(place);
      const back = b.kind === 'home' ? b.back : b;
      const was: HomeMemo | undefined = place.kind === 'home' ? place : s.homeMemo;
      const tab = a.tab ?? was?.tab ?? 'conversation';
      const rigs = a.rigs ?? was?.rigs;
      const spec = a.spec ?? was?.spec;
      // The docked chat closes: the home view is the same conversation, wider.
      return { ...s, place: { kind: 'home', tab, view: b.view, project: b.project, ...(back ? { back } : {}), ...(rigs ? { rigs } : {}), ...(spec !== undefined ? { spec } : {}), ...(a.focus ? { focus: a.focus } : {}) },
        modal: null, chat: false, chatFocus: s.chatFocus + 1 };
    }
    case 'ledge-focused': {
      if (place.kind !== 'home' || place.focus === undefined) return s;
      const { focus: _spent, ...rest } = place;
      return { ...s, place: rest };
    }
    case 'filter': {
      if (baseOf(place).project === a.project) return s;
      return { ...s, place: place.kind === 'settings' ? { ...place, back: { ...place.back, project: a.project } } : { ...place, project: a.project } };
    }
    case 'open': {
      const b = baseOf(place);
      return { ...s, place: { kind: 'session', id: a.id, ...(a.helper !== undefined && { helper: a.helper }), ...(a.focus !== undefined && { focus: a.focus }), ...(a.item !== undefined && { item: a.item }), view: b.view, project: b.project }, modal: null, chat: false };
    }
    case 'settings':
      return { ...s, place: { kind: 'settings', section: a.section ?? 'general', back: baseOf(place) }, modal: null, chat: false };
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
      if (place.kind === 'session') return { ...s, place: { kind: 'overview', view: place.view, project: place.project } };
      if (place.project !== 'all') return { ...s, place: { ...place, project: 'all' } };
      if (s.fullscreen) return { ...s, fullscreen: false };
      return s;
    }
  }
}

/** A rig filter is known while its rig (a kernel on that machine for `kernel:`) is listed: before the rigs load, it goes back to 'all'. */
export function reconcile(s: NavState, sessions: readonly Session[], projects: Projects | null, rigs: readonly Rig[] = []): NavState {
  const known = (f: ProjectFilter) => {
    if (f === 'all' || f === 'none') return true;
    const r = parseRigFilter(f);
    if (r) return rigs.some(x => x.machine === r.machine && (r.kind === 'kernel' ? x.kernel : !x.kernel && x.id === r.rigId));
    return projects !== null && projects.projects.some(p => p.id === f);
  };
  const fix = (b: Base): Base => {
    const project = known(b.project) ? b.project : 'all';
    if (b.kind === 'session' && !sessions.some(x => x.id === b.id)) return { kind: 'overview', view: b.view, project };
    if (b.kind === 'home' && b.back) { const back = fix(b.back) as Exclude<Base, { kind: 'home' }>; if (back !== b.back || project !== b.project) return { ...b, project, back }; }
    return project === b.project ? b : { ...b, project };
  };
  const place = s.place.kind === 'settings' ? (() => { const back = fix(s.place.back); return back === s.place.back ? s.place : { ...s.place, back }; })() : fix(s.place);
  return place === s.place ? s : { ...s, place };
}
