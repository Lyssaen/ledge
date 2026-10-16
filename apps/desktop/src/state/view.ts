import type { Grouping } from '../grouping/groups';

export interface ViewState { view: 'team' | 'room'; grouping: Grouping; attentionOnly: boolean; selected: string | null }
export type ViewAction =
  | { type: 'view'; view: 'team' | 'room' } | { type: 'grouping'; grouping: Grouping } | { type: 'attention'; on: boolean }
  | { type: 'select'; id: string | null } | { type: 'visible'; ids: string[] };
export const DEFAULT_VIEW: ViewState = { view: 'room', grouping: 'all', attentionOnly: false, selected: null };

/** The view's own state; the fleet tells it what is visible and it keeps the selection on screen (spec §9.1). */
export function reduce(state: ViewState, a: ViewAction): ViewState {
  switch (a.type) {
    case 'view': return state.view === a.view ? state : { ...state, view: a.view };
    case 'grouping': return state.grouping === a.grouping ? state : { ...state, grouping: a.grouping };
    case 'attention': return state.attentionOnly === a.on ? state : { ...state, attentionOnly: a.on };
    case 'select': return state.selected === a.id ? state : { ...state, selected: a.id };
    case 'visible': {
      if (state.selected === 'ledge' || (state.selected === null && a.ids.length === 0) || (state.selected !== null && a.ids.includes(state.selected))) return state;
      const next = a.ids[0] ?? null;
      return state.selected === next ? state : { ...state, selected: next };
    }
  }
}
