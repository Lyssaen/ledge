import { isRecord, readJson, writeJson } from '../state/storage';

/** The IDE shell's panel layout: pure state, plus its persisted form (`ledge.ide.layout`). */
export type SideView = 'projects' | 'rigs' | 'atoi' | 'prs';
/** Every sidebar view, as the Ledge guide (docs/ledge-guide.md) describes them: a Record, so a new view fails to compile until it is listed. */
const SIDE_VIEW: Record<SideView, true> = { projects: true, rigs: true, atoi: true, prs: true };
export const SIDE_VIEWS = Object.keys(SIDE_VIEW) as SideView[];
export interface IdeLayout { sideOpen: boolean; sideWidth: number; sideView: SideView; bottom: boolean; bottomHeight: number; right: boolean }

export const SIDE_DEFAULT = 248, SIDE_MIN = 120, SIDE_MAX = 440, SIDE_FOLD = 150, RIGHT_WIDTH = 300, EDITOR_MIN = 360;
export const BOTTOM_DEFAULT = 240, BOTTOM_MIN = 120, BOTTOM_MAX = 640;
const ACTIVITY_BAR = 48;
export const LAYOUT_KEY = 'ledge.ide.layout';
const VIEWS: readonly SideView[] = ['projects', 'rigs', 'atoi', 'prs'];

export type LayoutAction =
  | { type: 'toggle'; panel: 'side' | 'bottom' | 'right' }
  | { type: 'show'; panel: 'side' | 'bottom' | 'right'; on: boolean }
  | { type: 'view'; view: SideView }
  | { type: 'drag'; width: number }
  | { type: 'drop'; width: number }
  | { type: 'resetWidth' }
  | { type: 'dragBottom'; height: number }
  | { type: 'resetBottom' };

const FIELD = { side: 'sideOpen', bottom: 'bottom', right: 'right' } as const;
const clamp = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w));
const clampBottom = (h: number) => Math.min(BOTTOM_MAX, Math.max(BOTTOM_MIN, Math.round(h)));

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
    case 'dragBottom': return patch(s, { bottomHeight: clampBottom(a.height) });
    case 'resetBottom': return patch(s, { bottomHeight: BOTTOM_DEFAULT });
  }
}

export function loadLayout(): IdeLayout {
  const raw = readJson(LAYOUT_KEY);
  const r = isRecord(raw) ? raw : {};
  const w = r.sideWidth;
  const h = r.bottomHeight;
  return {
    sideOpen: typeof r.sideOpen === 'boolean' ? r.sideOpen : true,
    sideWidth: typeof w === 'number' && Number.isFinite(w) ? clamp(w) : SIDE_DEFAULT,
    bottomHeight: typeof h === 'number' && Number.isFinite(h) ? clampBottom(h) : BOTTOM_DEFAULT,
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

/** Whether the right panel is on screen: asked for, and room for it. The title bar's toggle says this, not `l.right`. */
export const rightShown = (l: IdeLayout, windowWidth: number): boolean => l.right && rightFits(l, windowWidth);

/** layoutReducer, plus the room the right panel needs (in the IDE the chat is the only way to Ledge): asking to show it — a
 *  toggle while it is not on screen, or `show` on — folds the sidebar when that is what makes it fit. A toggle while it shows
 *  hides it. With no room even folded, nothing else changes, and the panel stays off screen. */
export function layoutFor(l: IdeLayout, a: LayoutAction, windowWidth: number): IdeLayout {
  const asksRight = (a.type === 'toggle' && a.panel === 'right') || (a.type === 'show' && a.panel === 'right' && a.on);
  if (!asksRight) return layoutReducer(l, a);
  if (a.type === 'toggle' && rightShown(l, windowWidth)) return layoutReducer(l, { type: 'show', panel: 'right', on: false });
  const on = layoutReducer(l, { type: 'show', panel: 'right', on: true });
  if (rightFits(on, windowWidth)) return on;
  const folded = layoutReducer(on, { type: 'show', panel: 'side', on: false });
  return rightFits(folded, windowWidth) ? folded : on;
}
