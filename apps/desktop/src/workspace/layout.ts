import { isRecord, readJson, writeJson } from '../state/storage';

/** The IDE shell's panel layout: pure state, plus its persisted form (`ledge.ide.layout`). */
export type SideView = 'projects' | 'rigs' | 'atoi';
export interface IdeLayout { sideOpen: boolean; sideWidth: number; sideView: SideView; bottom: boolean; right: boolean }

export const SIDE_DEFAULT = 248, SIDE_MIN = 120, SIDE_MAX = 440, SIDE_FOLD = 150, RIGHT_WIDTH = 300, EDITOR_MIN = 360;
const ACTIVITY_BAR = 48;
export const LAYOUT_KEY = 'ledge.ide.layout';
const VIEWS: readonly SideView[] = ['projects', 'rigs', 'atoi'];

export type LayoutAction =
  | { type: 'toggle'; panel: 'side' | 'bottom' | 'right' }
  | { type: 'show'; panel: 'side' | 'bottom' | 'right'; on: boolean }
  | { type: 'view'; view: SideView }
  | { type: 'drag'; width: number }
  | { type: 'drop'; width: number }
  | { type: 'resetWidth' };

const FIELD = { side: 'sideOpen', bottom: 'bottom', right: 'right' } as const;
const clamp = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w));

/** Returns the same object when the action changes nothing. */
function patch(s: IdeLayout, p: Partial<IdeLayout>): IdeLayout {
  const changed = (Object.keys(p) as (keyof IdeLayout)[]).some(k => s[k] !== p[k]);
  return changed ? { ...s, ...p } : s;
}

export function layoutReducer(s: IdeLayout, a: LayoutAction): IdeLayout {
  switch (a.type) {
    case 'toggle': return patch(s, { [FIELD[a.panel]]: !s[FIELD[a.panel]] });
    case 'show': return patch(s, { [FIELD[a.panel]]: a.on });
    case 'view': return s.sideView === a.view && s.sideOpen ? patch(s, { sideOpen: false }) : patch(s, { sideView: a.view, sideOpen: true });
    case 'drag': return patch(s, { sideWidth: clamp(a.width) });
    case 'drop': return a.width < SIDE_FOLD ? patch(s, { sideOpen: false, sideWidth: SIDE_DEFAULT }) : patch(s, { sideOpen: true, sideWidth: clamp(a.width) });
    case 'resetWidth': return patch(s, { sideWidth: SIDE_DEFAULT });
  }
}

export function loadLayout(): IdeLayout {
  const raw = readJson(LAYOUT_KEY);
  const r = isRecord(raw) ? raw : {};
  const w = r.sideWidth;
  return {
    sideOpen: typeof r.sideOpen === 'boolean' ? r.sideOpen : true,
    sideWidth: typeof w === 'number' && Number.isFinite(w) ? clamp(w) : SIDE_DEFAULT,
    sideView: VIEWS.find(v => v === r.sideView) ?? 'projects',
    bottom: typeof r.bottom === 'boolean' ? r.bottom : false,
    right: typeof r.right === 'boolean' ? r.right : true,
  };
}

export function saveLayout(l: IdeLayout): void {
  writeJson(LAYOUT_KEY, l);
}

/** The right panel hides when the editing area would drop under EDITOR_MIN. */
export function rightFits(l: IdeLayout, windowWidth: number): boolean {
  return ACTIVITY_BAR + (l.sideOpen ? l.sideWidth : 0) + RIGHT_WIDTH + EDITOR_MIN <= windowWidth;
}
