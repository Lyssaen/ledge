import { DEFAULT_VIEW, type ViewState } from './view';

const VIEW_KEY = 'desktop.view', SELECTED_KEY = 'desktop.selected';
const VIEWS = ['team', 'room'] as const, GROUPINGS = ['all', 'machine', 'jira'] as const;
const oneOf = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list as readonly unknown[]).includes(v) ? (v as T) : d;

/** Each field checked on its own, like `loadSounds` in the island (spec §7). */
export function loadViewState(): ViewState {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'); } catch { raw = null; }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  let selected: string | null = null;
  try { selected = localStorage.getItem(SELECTED_KEY) || null; } catch { selected = null; }
  return { view: oneOf(VIEWS, o.view, DEFAULT_VIEW.view), grouping: oneOf(GROUPINGS, o.grouping, DEFAULT_VIEW.grouping), attentionOnly: typeof o.attentionOnly === 'boolean' ? o.attentionOnly : DEFAULT_VIEW.attentionOnly, selected };
}
export function saveViewState(s: ViewState): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ view: s.view, grouping: s.grouping, attentionOnly: s.attentionOnly }));
    if (s.selected) localStorage.setItem(SELECTED_KEY, s.selected); else localStorage.removeItem(SELECTED_KEY);
  } catch { /* storage unavailable: the view still works for this run */ }
}
