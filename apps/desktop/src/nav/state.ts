import type { Projects, Session } from '@ledge/protocol';
import type { Overview } from './overview';

export type View = 'atelier' | 'list';
/** 'all', 'none' (Sans projet) or a project id. */
export type ProjectFilter = string;
export type SectionId = 'general' | 'appearance' | 'notifications' | 'sounds' | 'machines' | 'projects' | 'shortcuts' | 'about';
export const SECTIONS: readonly SectionId[] = ['general', 'appearance', 'notifications', 'sounds', 'machines', 'projects', 'shortcuts', 'about'];
export type Place =
  | { kind: 'overview'; view: View; project: ProjectFilter }
  | { kind: 'session'; id: string; view: View; project: ProjectFilter }
  | { kind: 'settings'; section: SectionId; back: Exclude<Place, { kind: 'settings' }> };
export type Modal = 'search' | 'shortcuts' | 'launch' | 'project' | null;
export interface NavState { place: Place; modal: Modal; chat: boolean; fullscreen: boolean; helpers: boolean; paused: boolean }
export type NavAction =
  | { type: 'home'; project?: ProjectFilter }
  | { type: 'view'; view: View }
  | { type: 'open'; id: string }
  | { type: 'settings'; section?: SectionId }
  | { type: 'modal'; modal: Modal }
  | { type: 'chat'; open?: boolean }
  | { type: 'fullscreen'; on: boolean }
  | { type: 'helpers' } | { type: 'paused' }
  | { type: 'escape' };

export function initialNav(overview: Overview): NavState {
  return { place: { kind: 'overview', view: overview.view, project: 'all' }, modal: null, chat: false, fullscreen: false, helpers: overview.helpers, paused: overview.paused };
}

type Base = Exclude<Place, { kind: 'settings' }>;
const baseOf = (p: Place): Base => (p.kind === 'settings' ? p.back : p);

export function navReducer(s: NavState, a: NavAction): NavState {
  const { place } = s;
  switch (a.type) {
    case 'home': {
      const b = baseOf(place);
      return { ...s, place: { kind: 'overview', view: b.view, project: a.project ?? 'all' } };
    }
    case 'view': {
      const b = baseOf(place);
      return { ...s, place: { kind: 'overview', view: a.view, project: b.project } };
    }
    case 'open': {
      const b = baseOf(place);
      return { ...s, place: { kind: 'session', id: a.id, view: b.view, project: b.project }, modal: null, chat: false };
    }
    case 'settings':
      return { ...s, place: { kind: 'settings', section: a.section ?? 'general', back: baseOf(place) }, modal: null, chat: false };
    case 'modal': return { ...s, modal: a.modal };
    case 'chat': return { ...s, chat: a.open ?? !s.chat };
    case 'fullscreen': return { ...s, fullscreen: a.on };
    case 'helpers': return { ...s, helpers: !s.helpers };
    case 'paused': return { ...s, paused: !s.paused };
    case 'escape': {
      if (s.modal) return { ...s, modal: null };
      if (s.chat) return { ...s, chat: false };
      if (place.kind === 'settings') return { ...s, place: place.back };
      if (place.kind === 'session') return { ...s, place: { kind: 'overview', view: place.view, project: place.project } };
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
    return project === b.project ? b : { ...b, project };
  };
  const place = s.place.kind === 'settings' ? (() => { const back = fix(s.place.back); return back === s.place.back ? s.place : { ...s.place, back }; })() : fix(s.place);
  return place === s.place ? s : { ...s, place };
}
