import type { NavAction, NavState } from '../nav/state';
import type { LayoutAction } from './layout';
import type { OpenSession } from './openPrefs';
import { open, type Tab, type Workspace } from './model';
import { ATELIER_TAB, SETTINGS_TAB, openrigTab } from './store';

/** What an existing screen's NavAction means in the IDE: a nav change, a tab change, a panel change. */
export interface Routed { nav?: NavAction; ws?: (w: Workspace) => Workspace; layout?: LayoutAction }

const right = (on: boolean): LayoutAction => ({ type: 'show', panel: 'right', on });

export function routeNav(a: NavAction, ctx: { isSeat(id: string): boolean; modalOpen: boolean; openSession: OpenSession }): Routed {
  switch (a.type) {
    case 'open': return { nav: a, ws: w => open(w, { kind: ctx.isSeat(a.id) ? 'seat' : 'session', ref: a.id }, a.where ?? ctx.openSession) };
    case 'home': return { ...(a.project !== undefined ? { nav: { type: 'filter', project: a.project } as NavAction } : {}), ws: w => open(w, ATELIER_TAB) };
    case 'ledge': return { nav: { type: 'chat', open: true }, layout: right(true) };
    case 'chat': return { nav: a, layout: right(a.open !== false) };
    case 'settings': return { nav: a, ws: w => open(w, SETTINGS_TAB) };
    case 'openrig': return { nav: a, ws: w => open(w, openrigTab(a.machine)) };
    case 'escape': return ctx.modalOpen ? { nav: { type: 'modal', modal: null } } : {};
    default: return { nav: a };
  }
}

/** The NavState seen by a tab's content: the real one when it speaks of that tab, else a synthetic place. */
export function tabNav(nav: NavState, tab: Tab): NavState {
  if (tab.kind === 'session' || tab.kind === 'seat') {
    return nav.place.kind === 'session' && nav.place.id === tab.ref ? nav : { ...nav, place: { kind: 'session', id: tab.ref, view: 'atelier', project: 'all' } };
  }
  if (tab.kind === 'settings' && nav.place.kind !== 'settings') {
    return { ...nav, place: { kind: 'settings', section: 'general', back: { kind: 'overview', view: 'atelier', project: 'all' } } };
  }
  return nav;
}
