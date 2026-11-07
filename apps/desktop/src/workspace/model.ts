/**
 * The IDE workspace (docs/ide-workspace.md, « Onglets et groupes »): windows, tab groups, tabs, colour links.
 * Pure and serialisable: no DOM, no React. The panel library (dockview) draws it; Ledge's own rules live here:
 * - a tab is never duplicated: opening one already open brings it forward, in whichever window;
 * - a group emptied disappears, except the last one of the main window; a secondary window without groups closes;
 * - colour-linked groups follow the session chosen in any group of the same colour, across windows: their Changes
 *   and Terminal tabs switch to that session.
 * Every function returns a new state, or the same object when nothing changed.
 */

export type TabKind = 'session' | 'seat' | 'changes' | 'terminal' | 'pr' | 'topology' | 'openrig' | 'atoi' | 'atelier' | 'settings';
export type View = 'thread' | 'terminal' | 'role';
export interface Tab { kind: TabKind; ref: string; /** session and seat tabs: the view in front. */ view?: View }
export type Link = 'violet' | 'teal';
export interface Group { id: string; window: string; tabs: Tab[]; active: number; link: Link | null; /** split from: the session the user left. */ from?: string }
export interface Workspace { version: 1; windows: string[]; groups: Group[]; focus: string; next: number }
export type Where = 'active' | 'right' | 'window';

export const MAIN = 'main';
export const LINKS: readonly Link[] = ['violet', 'teal'];

/** The identity of a tab: two tabs with the same key are the same tab. The view is not part of it. */
export const keyOf = (t: Tab): string => `${t.kind}:${t.ref}`;
const isAgent = (t: Tab | undefined): boolean => !!t && (t.kind === 'session' || t.kind === 'seat');
/** The session a tab is about: an agent tab, its changes, its attached terminal (`terminal:agent:<id>`). */
export function sessionOf(t: Tab | undefined): string | null {
  if (!t) return null;
  if (isAgent(t) || t.kind === 'changes') return t.ref;
  if (t.kind === 'terminal' && t.ref.startsWith('agent:')) return t.ref.slice(6);
  return null;
}
export const changesTab = (session: string): Tab => ({ kind: 'changes', ref: session });
export const agentTerminalTab = (session: string): Tab => ({ kind: 'terminal', ref: `agent:${session}` });

export function empty(): Workspace {
  return { version: 1, windows: [MAIN], groups: [{ id: 'g1', window: MAIN, tabs: [], active: 0, link: null }], focus: 'g1', next: 2 };
}

const groupById = (w: Workspace, id: string) => w.groups.find(g => g.id === id);
export const focused = (w: Workspace): Group => groupById(w, w.focus) ?? w.groups[0]!;
export function find(w: Workspace, key: string): { group: Group; index: number } | null {
  for (const group of w.groups) { const index = group.tabs.findIndex(t => keyOf(t) === key); if (index >= 0) return { group, index }; }
  return null;
}

function replaceGroup(w: Workspace, g: Group): Workspace { return { ...w, groups: w.groups.map(x => (x.id === g.id ? g : x)) }; }

/** A new empty group right after `after` (same window), or at the end of a new window. */
function addGroup(w: Workspace, place: { after: Group } | { window: 'new' }): { w: Workspace; group: Group } {
  const id = `g${w.next}`;
  if ('after' in place) {
    const group: Group = { id, window: place.after.window, tabs: [], active: 0, link: null };
    const i = w.groups.indexOf(place.after);
    return { w: { ...w, next: w.next + 1, groups: [...w.groups.slice(0, i + 1), group, ...w.groups.slice(i + 1)] }, group };
  }
  const win = `w${w.next}`;
  const group: Group = { id, window: win, tabs: [], active: 0, link: null };
  return { w: { ...w, next: w.next + 1, windows: [...w.windows, win], groups: [...w.groups, group] }, group };
}

/** The group just emptied disappears, unless it is the main window's last; a secondary window left without groups
 *  closes. Other empty groups (a split waiting for a tab) stay. */
function dropIfEmpty(w: Workspace, groupId: string): Workspace {
  const g = groupById(w, groupId);
  if (!g || g.tabs.length > 0) return w;
  if (g.window === MAIN && w.groups.filter(x => x.window === MAIN).length === 1) return w;
  const groups = w.groups.filter(x => x.id !== groupId);
  const windows = w.windows.filter(win => win === MAIN || groups.some(x => x.window === win));
  const focus = w.focus !== groupId ? w.focus : (groups.find(x => x.window === g.window) ?? groups.find(x => x.window === MAIN)!).id;
  return { ...w, groups, windows, focus };
}

/** Repairs a layout read back: the main window keeps one group at least, secondary windows without groups go. */
function repair(w: Workspace): Workspace {
  let out = w;
  if (!out.groups.some(g => g.window === MAIN)) out = { ...out, next: out.next + 1, groups: [{ id: `g${out.next}`, window: MAIN, tabs: [], active: 0, link: null }, ...out.groups] };
  const windows = out.windows.filter(win => win === MAIN || out.groups.some(g => g.window === win));
  const groups = out.groups.map(g => ({ ...g, active: Math.max(0, Math.min(g.active, g.tabs.length - 1)) }));
  const focus = groups.some(g => g.id === out.focus) ? out.focus : groups.find(g => g.window === MAIN)!.id;
  return { ...out, windows, groups, focus };
}

/** Makes `index` the active tab of group `groupId`, focuses it, and lets the groups linked to it follow its session. */
export function activate(w: Workspace, groupId: string, index: number): Workspace {
  const g = groupById(w, groupId);
  if (!g || index < 0 || index >= g.tabs.length) return w;
  let out = g.active === index && w.focus === groupId ? w : replaceGroup({ ...w, focus: groupId }, { ...g, active: index });
  const tab = g.tabs[index];
  if (g.link && tab && isAgent(tab)) out = follow(out, g.id, g.link, tab.ref);
  return out;
}

/** Linked groups of colour `link` (other than `source`) whose front tab is Changes or Terminal switch to `session`. */
function follow(w: Workspace, source: string, link: Link, session: string): Workspace {
  let out = w;
  for (const h of w.groups) {
    if (h.id === source || h.link !== link) continue;
    const front = h.tabs[h.active];
    if (!front || (front.kind !== 'changes' && !(front.kind === 'terminal' && front.ref.startsWith('agent:')))) continue;
    const want = front.kind === 'changes' ? changesTab(session) : agentTerminalTab(session);
    const at = h.tabs.findIndex(t => keyOf(t) === keyOf(want));
    const tabs = at >= 0 ? h.tabs : h.tabs.map((t, i) => (i === h.active ? want : t));
    out = replaceGroup(out, { ...h, tabs, active: at >= 0 ? at : h.active });
  }
  return out;
}

/** Opens `tab`: brought forward if already open anywhere, else added where asked (the setting « Ouvrir une session »). */
export function open(w: Workspace, tab: Tab, where: Where = 'active'): Workspace {
  const hit = find(w, keyOf(tab));
  if (hit) return activate(w, hit.group.id, hit.index);
  const base = focused(w);
  const { w: w1, group } = where === 'active' ? { w, group: base } : where === 'right' ? addGroup(w, { after: base }) : addGroup(w, { window: 'new' });
  const g = groupById(w1, group.id)!;
  const tabs = [...g.tabs, tab];
  return activate(replaceGroup(w1, { ...g, tabs }), g.id, tabs.length - 1);
}

export function close(w: Workspace, key: string): Workspace {
  const hit = find(w, key);
  if (!hit) return w;
  const g = hit.group;
  const tabs = g.tabs.filter((_, i) => i !== hit.index);
  const active = Math.max(0, Math.min(hit.index <= g.active ? g.active - (hit.index < g.active ? 1 : 0) : g.active, tabs.length - 1));
  return dropIfEmpty(replaceGroup(w, { ...g, tabs, active }), g.id);
}

/** « Fermer les autres »: the other tabs of `key`'s group close, it stays, alone and active; the group itself stays. */
export function closeOthers(w: Workspace, key: string): Workspace {
  const hit = find(w, key);
  if (!hit) return w;
  const tab = hit.group.tabs[hit.index]!;
  if (hit.group.tabs.length === 1) return w;
  return replaceGroup(w, { ...hit.group, tabs: [tab], active: 0 });
}

/** The colour of the linked group whose front tab is the Changes of the session `key` names, null when there is none:
 *  what lights the « +N −N » of a session tab. */
export function changesBeside(w: Workspace, key: string): Link | null {
  const hit = find(w, key);
  const session = sessionOf(hit?.group.tabs[hit.index]);
  if (!session) return null;
  const want = keyOf(changesTab(session));
  const peer = w.groups.find(g => g.link && g.tabs[g.active] && keyOf(g.tabs[g.active]!) === want);
  return peer?.link ?? null;
}

/** Moves tab `key` to a group, to a new group right of one, or to a new window (a tab torn out of the window). */
export function move(w: Workspace, key: string, to: { group: string } | { rightOf: string } | { window: 'new' }): Workspace {
  const hit = find(w, key);
  if (!hit) return w;
  const tab = hit.group.tabs[hit.index]!;
  if ('group' in to && to.group === hit.group.id) return w;
  let out = close(w, key);
  let target: Group | undefined;
  if ('group' in to) target = groupById(out, to.group);
  else if ('rightOf' in to) { const ref = groupById(out, to.rightOf); if (ref) { const r = addGroup(out, { after: ref }); out = r.w; target = r.group; } }
  else { const r = addGroup(out, { window: 'new' }); out = r.w; target = r.group; }
  if (!target) return w;
  const g = groupById(out, target.id)!;
  const tabs = [...g.tabs, tab];
  return activate(replaceGroup(out, { ...g, tabs }), g.id, tabs.length - 1);
}

/** `move` with the arrival position: inserted at `index` (clamped) in a group, else at the end. The tab becomes active
 *  and its group focused. Within its own group it is a reorder. */
export function moveTo(w: Workspace, key: string, to: { group: string; index?: number } | { rightOf: string }): Workspace {
  if ('group' in to) {
    // Same group: a reorder, which `move` leaves alone.
    const here = find(w, key);
    if (here && here.group.id === to.group) {
      if (to.index === undefined) return w;
      const tab = here.group.tabs[here.index]!;
      const tabs = here.group.tabs.filter((_, i) => i !== here.index);
      const at = Math.max(0, Math.min(to.index, tabs.length));
      tabs.splice(at, 0, tab);
      return activate(replaceGroup(w, { ...here.group, tabs }), here.group.id, at);
    }
  }
  const moved = move(w, key, to);
  if (moved === w || !('group' in to) || to.index === undefined) return moved;
  const hit = find(moved, key);
  if (!hit) return moved;
  const tabs = hit.group.tabs.filter((_, i) => i !== hit.index);
  tabs.splice(Math.max(0, Math.min(to.index, tabs.length)), 0, hit.group.tabs[hit.index]!);
  return activate(replaceGroup(moved, { ...hit.group, tabs }), hit.group.id, tabs.indexOf(hit.group.tabs[hit.index]!));
}

/** What an empty group offers: the Terminal of the session it was split from (the UI checks that session still exists).
 *  Split from the atelier or any non-session tab, nothing is proposed. */
export function emptyProposals(w: Workspace, groupId: string): { terminalOf: string | null } {
  const g = groupById(w, groupId);
  return { terminalOf: g && g.tabs.length === 0 ? (g.from ?? null) : null };
}

/** Focuses a group, an empty one included (clicked, or one of its proposals chosen): a tab then opened « active » lands in it. */
export function focusGroup(w: Workspace, groupId: string): Workspace {
  return w.focus === groupId || !groupById(w, groupId) ? w : { ...w, focus: groupId };
}

/** « Fermer le groupe » (×, Ctrl+W on an empty group): an EMPTY group goes, unless it is the main window's last. Focused,
 *  the focus goes to its left neighbour in its window, else its right one, else (a secondary window closing) the main
 *  window's first group. */
export function closeGroup(w: Workspace, groupId: string): Workspace {
  const g = groupById(w, groupId);
  if (!g || g.tabs.length > 0) return w;
  const siblings = w.groups.filter(x => x.window === g.window);
  if (g.window === MAIN && siblings.length === 1) return w;
  const at = siblings.indexOf(g);
  const groups = w.groups.filter(x => x.id !== groupId);
  const windows = w.windows.filter(win => win === MAIN || groups.some(x => x.window === win));
  const focus = w.focus !== groupId ? w.focus : (siblings[at - 1] ?? siblings[at + 1] ?? groups.find(x => x.window === MAIN)!).id;
  return { ...w, groups, windows, focus };
}

/** Ctrl+Tab / Ctrl+Shift+Tab (Ctrl+PageDown / PageUp): the next or previous tab of the group, wrapping. */
export function cycleTab(w: Workspace, groupId: string, step: 1 | -1): Workspace {
  const g = groupById(w, groupId);
  if (!g || g.tabs.length < 2) return w;
  return activate(w, groupId, (g.active + step + g.tabs.length) % g.tabs.length);
}

/** Ctrl+1…9: the Nth group (from 1) of the main window, left to right, focused if there is one. */
export function focusNth(w: Workspace, n: number): Workspace {
  const g = w.groups.filter(x => x.window === MAIN)[n - 1];
  return g ? focusGroup(w, g.id) : w;
}

/** Ctrl+Alt+→ / ←: the focused group's active tab into the group on its right / left (same window). No group on the
 *  right: a new one (unless the tab is its group's only one: nothing would change); none on the left: nothing. */
export function moveActive(w: Workspace, step: 1 | -1): Workspace {
  const g = focused(w);
  const tab = g.tabs[g.active];
  if (!tab) return w;
  const siblings = w.groups.filter(x => x.window === g.window);
  const next = siblings[siblings.indexOf(g) + step];
  if (next) return moveTo(w, keyOf(tab), { group: next.id });
  if (step === -1 || g.tabs.length === 1) return w;
  return moveTo(w, keyOf(tab), { rightOf: g.id });
}

/** A tab closed by the user, where it was: what Ctrl+Shift+T brings back. */
export interface Closed { tab: Tab; group: string; index: number }
export const CLOSED_MAX = 20;
/** Notes tab `key` (still open in `w`) on top of the closed tabs, keeping the CLOSED_MAX last. Unknown: the same stack. */
export function remember(stack: readonly Closed[], w: Workspace, key: string): readonly Closed[] {
  const hit = find(w, key);
  if (!hit) return stack;
  return [...stack, { tab: hit.group.tabs[hit.index]!, group: hit.group.id, index: hit.index }].slice(-CLOSED_MAX);
}
/** Ctrl+Shift+T: the last closed tab back where it was (its group if it still exists, at its place; else the focused
 *  group), active and focused. Tabs open again since are skipped. */
export function reopenLast(w: Workspace, stack: readonly Closed[]): { w: Workspace; stack: readonly Closed[] } {
  const rest = [...stack];
  for (let c = rest.pop(); c; c = rest.pop()) {
    if (find(w, keyOf(c.tab))) continue;
    const g = groupById(w, c.group) ?? focused(w);
    const tabs = [...g.tabs];
    const at = g.id === c.group ? Math.min(c.index, tabs.length) : tabs.length;
    tabs.splice(at, 0, c.tab);
    return { w: activate(replaceGroup(w, { ...g, tabs }), g.id, at), stack: rest };
  }
  return { w, stack: rest };
}

/** Ctrl+\: an empty group right of `groupId`, remembering the session left (its Changes and Terminal are offered). */
export function split(w: Workspace, groupId: string): Workspace {
  const g = groupById(w, groupId);
  if (!g) return w;
  const { w: w1, group } = addGroup(w, { after: g });
  const from = sessionOf(g.tabs[g.active]);
  return { ...replaceGroup(w1, from ? { ...group, from } : group), focus: group.id };
}

/** The square left of the tabs: no link → violet → teal → no link. */
export function cycleLink(w: Workspace, groupId: string): Workspace {
  const g = groupById(w, groupId);
  if (!g) return w;
  const link = g.link === null ? 'violet' : g.link === 'violet' ? 'teal' : null;
  const out = replaceGroup(w, { ...g, link });
  const front = g.tabs[g.active];
  return link && front && isAgent(front) ? follow(out, g.id, link, front.ref) : out;
}

/** « +N −N » of a session tab: its Changes (or its attached terminal) beside it, in a group of the same colour. The
 *  group is linked first if it was not (the colour no other group uses, violet when both are taken). */
export function beside(w: Workspace, groupId: string, kind: 'changes' | 'terminal', session: string): Workspace {
  let g = groupById(w, groupId);
  if (!g) return w;
  let out = w;
  if (!g.link) {
    const used = new Set(w.groups.filter(x => x.id !== g!.id && x.link).map(x => x.link));
    g = { ...g, link: LINKS.find(l => !used.has(l)) ?? 'violet' };
    out = replaceGroup(out, g);
  }
  const want = kind === 'changes' ? changesTab(session) : agentTerminalTab(session);
  const hit = find(out, keyOf(want));
  if (hit && hit.group.link === g.link) return { ...activate(out, hit.group.id, hit.index), focus: g.id };
  if (hit) out = close(out, keyOf(want));
  g = groupById(out, g.id)!;
  let peer = out.groups.find(x => x.id !== g!.id && x.window === g!.window && x.link === g!.link);
  if (!peer) { const r = addGroup(out, { after: g }); out = replaceGroup(r.w, { ...r.group, link: g.link }); peer = groupById(out, r.group.id)!; }
  const tabs = [...peer.tabs, want];
  out = replaceGroup(out, { ...peer, tabs, active: tabs.length - 1 });
  return { ...out, focus: g.id };
}

/** Sets the view of a session or seat tab (Ctrl+`: thread ⇄ terminal; role.md for a seat). */
export function setView(w: Workspace, key: string, view: View): Workspace {
  const hit = find(w, key);
  const tab = hit?.group.tabs[hit.index];
  if (!hit || !tab || !isAgent(tab) || tab.view === view) return w;
  const tabs = hit.group.tabs.map((t, i) => (i === hit.index ? { ...t, view } : t));
  return replaceGroup(w, { ...hit.group, tabs });
}

/** Drops the tabs whose subject is gone (a session removed, a rig deleted). */
export function reconcile(w: Workspace, exists: (t: Tab) => boolean): Workspace {
  let out = w;
  for (const g of w.groups) for (const t of g.tabs) if (!exists(t)) out = close(out, keyOf(t));
  return out;
}

/** A saved layout (« Dispositions »): the JSON a setting keeps. */
export function serialize(w: Workspace): string { return JSON.stringify(w); }

/** Reads a saved layout back; anything malformed gives `null` (the caller falls back to `empty()`). */
export function deserialize(json: string): Workspace | null {
  let v: unknown;
  try { v = JSON.parse(json); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Workspace>;
  if (o.version !== 1 || !Array.isArray(o.windows) || !Array.isArray(o.groups) || typeof o.focus !== 'string' || typeof o.next !== 'number') return null;
  if (!o.windows.includes(MAIN)) return null;
  const kinds: readonly string[] = ['session', 'seat', 'changes', 'terminal', 'pr', 'topology', 'openrig', 'atoi', 'atelier', 'settings'];
  for (const g of o.groups) {
    if (!g || typeof g.id !== 'string' || !o.windows.includes(g.window) || !Array.isArray(g.tabs) || typeof g.active !== 'number') return null;
    if (g.link !== null && !LINKS.includes(g.link)) return null;
    if (!g.tabs.every(t => t && kinds.includes(t.kind) && typeof t.ref === 'string')) return null;
  }
  return repair(o as Workspace);
}
