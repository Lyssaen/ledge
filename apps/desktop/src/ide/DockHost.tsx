import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type DragEvent, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DockviewReact, type DockviewApi, type DockviewGroupDropLocation, type DockviewGroupPanel, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type IWatermarkPanelProps, type PanelTransfer, type Position } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { activate, closeGroup, closeWindow, find, focusGroup, keyOf, LINKS, MAIN, move, moveTo, setLink, split, windowOf, type Group, type Link, type Tab, type Workspace } from '../workspace/model';
import { Menu, MenuItem } from '../shell/Menu';
import type { WorkspaceStore } from '../workspace/store';
import { TabPlaceContext, type TabPlace } from '../workspace/tabPlace';
import type { TabBody } from './tabs';
import { panelDragRef, termDrag } from './termDrag';
import { boxAt, closeNative, mirrorRoot, outsideWindow, popoutLabel, popoutUrl, POPOUT_SIZE, type Box } from './popout';
import { PopoutTitleBar } from './PopoutTitleBar';
import { isTauri, setWindowTitle } from '../tauri/bridge';
import '../styles/ide.css';

export interface DockHostProps {
  ws: Workspace; store: WorkspaceStore; title(t: Tab): string; body: TabBody;
  /** A tab's content (SessionTabLabel for a session or seat, its title otherwise). */
  label(t: Tab): ReactNode;
  /** The alert a tab carries: a red or amber line under it. */
  alert(t: Tab): 'perm' | 'ask' | null;
  onTabMenu(t: Tab, at: { x: number; y: number }): void;
  /** The « + » at the right of each tab strip: the launch dialog. */
  /** A group's « + »: the group it was clicked in. */
  onNewSession(groupId: string): void;
  /** What a group without tabs shows (EmptyGroup): its proposals. */
  emptyGroup(groupId: string): ReactNode;
  /** A bottom-panel tile (its ref: `shell:<n>`, `agent:<id>`) dropped on a group, a tab of its strip, its right edge or
   *  « nouveau groupe »: where it goes. The host moves it (the model and the panel); the dock only says where. */
  onPanelDrop?(ref: string, to: { group: string; index?: number } | { rightOf: string } | { window: 'new' }): void;
  /** A detached window's name, from its active tab (v27: « Pim · ledge », « dev-front · ledge-dev », « À toi »). Absent: its title. */
  windowTitle?(t: Tab): string;
  /** A detached window closed by the user: `n` tabs came back to the main window (the toast). */
  onWindowClosed?(n: number): void;
}

/** R6: a group is never narrower than this (mockup `.grow-row>.pane{min-width:300px}`); past it the editing area scrolls. */
export const GROUP_MIN_WIDTH = 300;

/** What a panel reads to draw its tab's content: the latest of Shell's, each render. */
const Content = createContext<{ tabOf(id: string): Tab | undefined; body: TabBody; title(t: Tab): string; label(t: Tab): ReactNode; alert(t: Tab): 'perm' | 'ask' | null; onTabMenu(t: Tab, at: { x: number; y: number }): void; onNewSession(groupId: string): void; groupOf(id: string): string | undefined; focus: string;
  /** The model group a dockview group draws. */ modelOf(dg: unknown): Group | undefined; emptyGroup(groupId: string): ReactNode; split(groupId: string): void; setLink(groupId: string, link: Link | null): void;
  /** How many other groups of the window carry `link`. */ linkUse(groupId: string, link: Link): number;
  /** « Fermer le groupe »: an empty group goes; `lone` when it is the window's only group (it stays, without the button). */ closeGroup(groupId: string): void; lone: boolean } | null>(null);

/** One panel = one tab of the model (`id = keyOf(tab)`). dockview draws only the visible one (`onlyWhenVisible`, its default). */
function Pane({ api }: IDockviewPanelProps): JSX.Element | null {
  const c = useContext(Content);
  const tab = c?.tabOf(api.id);
  // Hidden panels stay mounted: the content must know whether it is the one on show.
  const [visible, setVisible] = useState(api.isVisible);
  useEffect(() => {
    setVisible(api.isVisible);
    const sub = api.onDidVisibilityChange(e => setVisible(e.isVisible));
    return () => sub.dispose();
  }, [api]);
  if (!tab) return null;
  const group = c!.groupOf(api.id) ?? '';
  const place: TabPlace = { key: api.id, group, visible, active: visible && group === c!.focus };
  return <TabPlaceContext.Provider value={place}><div className="ide-pane">{c!.body(tab)}</div></TabPlaceContext.Provider>;
}

/** The « × » of a tab and of an empty group's « Fermer le groupe ». */
function CloseGlyph({ size = 9 }: { size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>;
}

/** The tab of a panel: the label, the alert line (a class on dockview's own tab element, which draws the box), and the ×.
 *  The extras are aria-hidden in the label, so the tab's name (dockview's aria-label) stays the title. */
function PanelTab({ api }: IDockviewPanelHeaderProps): JSX.Element | null {
  const c = useContext(Content);
  const { t } = useI18n();
  const mark = useRef<HTMLSpanElement>(null);
  const tab = c?.tabOf(api.id);
  const alert = tab ? c!.alert(tab) : null;
  // The whole tab answers a right click, its padding included: a listener on dockview's element, not on our span.
  const menuRef = useRef<(at: { x: number; y: number }) => void>(() => {});
  menuRef.current = at => { if (tab) { api.setActive(); c!.onTabMenu(tab, at); } };
  useLayoutEffect(() => {
    const el = mark.current?.closest<HTMLElement>('.dv-tab');
    if (!el) return;
    const onMenu = (e: MouseEvent) => { e.preventDefault(); menuRef.current({ x: e.clientX, y: e.clientY }); };
    el.addEventListener('contextmenu', onMenu);
    return () => el.removeEventListener('contextmenu', onMenu);
  }, []);
  useLayoutEffect(() => {
    const el = mark.current?.closest('.dv-tab');
    if (!el) return;
    el.classList.toggle('alert', alert === 'perm');
    el.classList.toggle('alert-a', alert === 'ask');
    return () => { el.classList.remove('alert', 'alert-a'); };
  }, [alert]);
  if (!tab) return null;
  return (
    <span ref={mark} className="ide-tab" onPointerUp={e => { if (e.button === 1) api.close(); }}>
      {c!.label(tab)}
      <button type="button" className="dv-default-tab-action" tabIndex={-1} aria-label={t.ide.closeTab(c!.title(tab))}
        onPointerDown={e => e.preventDefault()} onClick={e => { e.preventDefault(); api.close(); }}>
        <CloseGlyph />
      </button>
    </span>
  );
}
/** The tools at the right of a group's tab strip (mockup groupHtml() `.tabs .tools`): « + », a new session, then the split;
 *  an empty group, unless it is the window's only one, ends with « × », which closes it (Ctrl+W too). */
function StripTools({ group }: IDockviewHeaderActionsProps): JSX.Element {
  const c = useContext(Content);
  const { t } = useI18n();
  const g = c?.modelOf(group);
  return (
    <div className="ide-strip-tools">
      <button type="button" title={t.ide.newSession} aria-label={t.ide.newSession} aria-keyshortcuts="N" onClick={() => { if (g) c!.onNewSession(g.id); }}>
        +
      </button>
      {/* No split in a detached window (v27: one group there). */}
      {g?.window === MAIN && (
        <button type="button" title={t.ide.splitTip} aria-label={t.ide.splitTip} onClick={() => c!.split(g.id)}>
          <Icon d={SHELL_ICONS.split} size={14} />
        </button>
      )}
      {g && g.tabs.length === 0 && !c!.lone && (
        <button type="button" title={t.ide.closeGroupTip} aria-label={t.ide.closeGroupTip} onClick={() => c!.closeGroup(g.id)}>
          <CloseGlyph size={10} />
        </button>
      )}
    </div>
  );
}
/** The link square left of the tabs (mockup `.lkbtn`): the group's colour, dashed when it has none. A click opens the
 *  colours (docs/mockups/ledge-ide-interactive.html, « Lier ce groupe »): six, the one in use and how many groups share each, then none. */
function LinkSquare({ group }: IDockviewHeaderActionsProps): JSX.Element {
  const c = useContext(Content);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const g = c?.modelOf(group);
  const choose = (link: Link | null) => { if (g) c!.setLink(g.id, link); };
  return (
    <Menu open={open} onOpenChange={setOpen} label={t.ide.linkMenu} className="ide-lk-wrap" menuClassName="ide-lk-menu" flip
      trigger={tr => (
        <button type="button" className="ide-lkbtn" title={t.ide.linkTip} aria-label={t.ide.linkTip} {...tr}>
          <span className={`ide-lk ${g?.link ?? 'none'}`} aria-hidden="true" />
        </button>
      )}>
      {LINKS.map(l => {
        const n = g ? c!.linkUse(g.id, l) : 0;
        return (
          <MenuItem key={l} onSelect={() => choose(l)} className={g?.link === l ? 'on' : undefined}>
            <span><span className={`ide-lk ${l}`} aria-hidden="true" />{t.ide.links[l]}</span>
            <small>{g?.link === l ? t.ide.linkCurrent : n > 0 ? t.ide.linkGroups(n) : ''}</small>
          </MenuItem>
        );
      })}
      <hr />
      <MenuItem onSelect={() => choose(null)} className={g?.link ? undefined : 'on'}>
        <span><span className="ide-lk none" aria-hidden="true" />{t.ide.linkNone}</span>
      </MenuItem>
    </Menu>
  );
}
/** dockview's watermark, shown by a group without a panel: a model group without tabs gets its proposals (EmptyGroup).
 *  A pointer on it makes the group dockview's active one (dockview's own listener), which focuses the model group. */
function GroupWatermark({ group }: IWatermarkPanelProps): JSX.Element | null {
  const c = useContext(Content);
  const g = group ? c?.modelOf(group) : undefined;
  if (!g || g.tabs.length > 0) return null;
  return <div className="ide-pane">{c!.emptyGroup(g.id)}</div>;
}
const COMPONENTS = { tab: Pane };
// Ledge's tokens, set on `.ide-dock` in ide.css. `tabAnimation` pinned to 'default' (no tab sliding, no smooth reorder):
// left unset, dockview takes a cross-group drag over a strip through its animation state, a path arrivalOf need not know.
const THEME: DockviewTheme = { name: 'ledge', className: 'ide-dock', tabAnimation: 'default' };

/** Notes the scroll positions of a panel's known scrollers (`[data-keep-scroll]`: the thread, the reply, the changes' list
 *  and diff, the agent's screen) and gives back what puts them back: a move re-attaches its DOM, which Chromium then shows
 *  from the top. A hidden panel's DOM is detached (all at 0): its page restores itself on show. */
export function keepScroll(root: HTMLElement): () => void {
  const kept: [Element, number, number][] = [];
  for (const el of root.querySelectorAll('[data-keep-scroll]')) if (el.scrollTop || el.scrollLeft) kept.push([el, el.scrollTop, el.scrollLeft]);
  return () => { for (const [el, top, left] of kept) { el.scrollTop = top; el.scrollLeft = left; } };
}

/** Where a tab dropped over dockview goes in the model. */
type Arrival = { key: string; to: { group: string; index?: number } | { rightOf: string } };
/** What dockview says of a drop, or of the overlay it is about to show for one (which has no `index`). */
interface DropSpot {
  kind: DockviewGroupDropLocation; position: Position; group?: DockviewGroupPanel; index?: number; edge?: boolean;
  getData(): PanelTransfer | undefined;
}
/** A drop's arrival, or null when it is refused: anything but one of this dock's tabs (a group, a file from outside), a
 *  floating group, the top, bottom and left edges (lot 3 stacks no groups). A group's centre or strip end takes the tab at
 *  its end, a tab of the strip at that tab's place, its right edge opens a new group right of it. A drop that would change
 *  nothing (a group's only tab on its own centre or right edge) is refused, so no overlay promises it. */
export function arrivalOf(e: DropSpot, viewId: string, modelOf: (dg: DockviewGroupPanel) => Group | undefined, outside: string | null = null): Arrival | null {
  const data = e.getData();
  if (e.edge) return null;
  // `outside`: the tab key of a bottom-panel tile being dragged, which dockview knows nothing of (no data of its own).
  if (outside !== null ? data !== undefined : !data || data.viewId !== viewId || !data.panelId) return null;
  const dg = e.group;
  // A secondary window (a popout) holds one group (option A): its tabs and centre take a tab, its right edge opens nothing.
  const popout = dg?.api.location.type === 'popout';
  if (!dg || (dg.api.location.type !== 'grid' && !popout)) return null;
  const g = modelOf(dg);
  if (!g) return null;
  const key = outside ?? data!.panelId!;
  const own = g.tabs.some(t => keyOf(t) === key);
  switch (e.kind) {
    // dockview's index is where the tab lands in the strip once taken out of it: the tab dropped on, or the one after it
    // past its middle, less one when the dragged tab sat before it in the same strip (tabAnimation 'default').
    case 'tab': return { key, to: { group: g.id, index: e.index } };
    case 'header_space': return { key, to: own ? { group: g.id, index: g.tabs.length - 1 } : { group: g.id } };
    case 'content':
      if (e.position === 'center') return own ? null : { key, to: { group: g.id } };
      if (e.position === 'right') return popout || (own && g.tabs.length === 1) ? null : { key, to: { rightOf: g.id } };
      return null;
    default: return null;
  }
}

/** The editing area: dockview drawing the main window's groups side by side, kept in step both ways. Model → dockview:
 *  one dockview group per model group (window MAIN, left to right), panels added, removed, retitled and activated to
 *  follow `ws`, the focused group made dockview's active one. Dockview → model: a tab chosen or a group clicked is
 *  `activate`d (which focuses its group), a tab closed is the store's `close` (remembered), an empty group clicked is focused. A model group without
 *  tabs is drawn as an empty dockview group showing its proposals. Each group keeps GROUP_MIN_WIDTH: the dock is as wide as
 *  its groups need and scrolls sideways in the editing area. A tab dragged goes through the model too: dockview's own move
 *  is cancelled, the model moves the tab (`moveTo`), and the sync moves its panel, whose content stays mounted. While a tab
 *  is dragged, a zone at the right end opens a new group. No floating groups, no stacked groups (lot 3). */
/** An open detached window: its dockview group, its page, and where its bar is drawn. */
interface Popped { dg: DockviewGroupPanel; win: Window; bar: HTMLElement; banner: HTMLElement }

export function DockHost({ ws, store, title, body, label, alert, onTabMenu, onNewSession, emptyGroup, onPanelDrop, windowTitle = title, onWindowClosed }: DockHostProps): JSX.Element {
  const { t } = useI18n();
  const [api, setApi] = useState<DockviewApi | null>(null);
  // The panel (tab key) being dragged, from dockview's drag start to its drop or end; `dragging` shows the drop zone.
  const dragged = useRef<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Set while the model is being written into dockview: the events that writing raises are not the user's.
  const syncing = useRef(false);
  // Model group id → the dockview group drawing it.
  const drawn = useRef(new Map<string, DockviewGroupPanel>());
  const latest = useRef(store);
  latest.current = store;
  const panelDrop = useRef(onPanelDrop);
  panelDrop.current = onPanelDrop;
  // Lot 9: a secondary window's group opening as a popout (model group id → the panel carried into it), the box a window
  // torn out opens at (model window id), and a render asked once a popout is open.
  const opening = useRef(new Map<string, string>());
  const boxes = useRef(new Map<string, Box>());
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [popped, setPopped] = useState<readonly Popped[]>([]);
  const windowClosed = useRef(onWindowClosed);
  windowClosed.current = onWindowClosed;
  /** A detached window closed by the user (its ✕, Alt+F4): its tabs come back to the main window, told by a toast. */
  const closeByUser = (win: string) => {
    const n = latest.current.get().groups.filter(g => g.window === win).reduce((a, g) => a + g.tabs.length, 0);
    latest.current.update(w => closeWindow(w, win));
    if (n) windowClosed.current?.(n);
  };
  // The drag under way, for its banner: the window it started in, a terminal or a tab, the pointer out of that window.
  const [tear, setTear] = useState<{ from: Window; term: boolean; out: boolean } | null>(null);
  const groups = ws.groups.filter(g => g.window === MAIN);
  // A secondary window holds one group (option A): its first.
  const popouts = ws.windows.filter(w => w !== MAIN).map(w => ws.groups.find(g => g.window === w)).filter((g): g is Group => !!g);
  const tabs = new Map<string, { tab: Tab; group: Group }>();
  for (const g of ws.groups) for (const tab of g.tabs) tabs.set(keyOf(tab), { tab, group: g });
  // Read when a part renders, after the sync below has drawn (and so mapped) its group.
  const modelOf = (dg: unknown) => { for (const [id, d] of drawn.current) if (d === dg) return ws.groups.find(g => g.id === id); return undefined; };
  // The listeners below outlive renders: they read the latest groups.
  const latestModelOf = useRef(modelOf);
  latestModelOf.current = modelOf;
  const content = { tabOf: (id: string) => tabs.get(id)?.tab, body, title, label, alert, onTabMenu, onNewSession, groupOf: (id: string) => tabs.get(id)?.group.id, focus: ws.focus,
    modelOf, emptyGroup, split: (id: string) => store.update(w => split(w, id)), setLink: (id: string, link: Link | null) => store.update(w => setLink(w, id, link)),
    // The link holds across windows: every window's groups count.
    linkUse: (id: string, link: Link) => ws.groups.filter(g => g.id !== id && g.link === link).length,
    closeGroup: (id: string) => store.update(w => closeGroup(w, id)), lone: groups.length === 1 };

  /** Draws each model group, left to right: its dockview group (made where it belongs if it has none) and its panels at
   *  their places. A panel sitting elsewhere is moved there, never remade, so its content keeps its state; what puts its
   *  scroll back goes in `scrolls`, run once it is on show. */
  const draw = (api: DockviewApi, table: Map<string, DockviewGroupPanel>, scrolls: (() => void)[]) => {
    const live = new Set(api.groups);
    for (const [id, dg] of table) if (!live.has(dg) || !ws.groups.some(g => g.id === id)) table.delete(id);
    let left: DockviewGroupPanel | undefined;
    groups.forEach((g, gi) => {
      let dg = table.get(g.id);
      // A group not drawn yet: right of its left neighbour, else left of the next one drawn, else of the first.
      if (!dg) {
        const next = groups.slice(gi + 1).map(n => table.get(n.id)).find(Boolean) ?? api.groups[0];
        dg = left ? api.addGroup({ referenceGroup: left, direction: 'right' }) : next ? api.addGroup({ referenceGroup: next, direction: 'left' }) : api.addGroup();
        table.set(g.id, dg);
      }
      const into = dg;
      g.tabs.forEach((tab, i) => {
        const id = keyOf(tab);
        const name = title(tab);
        const p = api.getPanel(id);
        if (!p) { api.addPanel({ id, component: 'tab', title: name, inactive: true, position: { referenceGroup: into, index: i } }); return; }
        if (p.title !== name) p.api.setTitle(name);
        if (p.group === into && into.panels.indexOf(p) === i) return;
        scrolls.push(keepScroll(p.view.content.element));
        p.api.moveTo({ group: into, position: 'center', index: i, skipSetActive: true });
      });
      if (dg.minimumWidth !== GROUP_MIN_WIDTH) dg.api.setConstraints({ minimumWidth: GROUP_MIN_WIDTH });
      left = dg;
    });
  };

  /** Draws each secondary window's group as a popout. One not open yet: its first tab's panel (made if need be) is put in a
   *  hidden group of its own, which dockview opens in a window (`addPopoutGroup` makes a fresh group there and leaves the
   *  hidden one behind, removed with the leftovers). Once open, its other tabs are moved in like a main group's. */
  const drawPopouts = (api: DockviewApi, table: Map<string, DockviewGroupPanel>, scrolls: (() => void)[]) => {
    for (const g of popouts) {
      const dg = table.get(g.id);
      if (!dg) {
        if (opening.current.has(g.id) || !g.tabs.length) continue;
        const first = g.tabs[g.active] ?? g.tabs[0]!;
        const id = keyOf(first);
        const carrier = api.addGroup();
        carrier.api.setVisible(false);
        const p = api.getPanel(id);
        if (p) p.api.moveTo({ group: carrier, position: 'center', skipSetActive: true });
        else api.addPanel({ id, component: 'tab', title: title(first), inactive: true, position: { referenceGroup: carrier } });
        opening.current.set(g.id, id);
        const box = boxes.current.get(g.window) ?? centred();
        void api.addPopoutGroup(carrier, { popoutUrl: popoutUrl(g.window), position: box }).then(ok => {
          opening.current.delete(g.id);
          const moved = api.getPanel(id);
          // Opened: its group is the popout's. Refused (no window): the window closes, its tabs come back.
          if (ok && moved && moved.group.api.location.type === 'popout') table.set(g.id, moved.group);
          else latest.current.update(w => (w.windows.includes(g.window) ? closeWindow(w, g.window) : w));
          redraw();
        });
        continue;
      }
      g.tabs.forEach((tab, i) => {
        const id = keyOf(tab);
        const name = title(tab);
        const p = api.getPanel(id);
        if (!p) { api.addPanel({ id, component: 'tab', title: name, inactive: true, position: { referenceGroup: dg, index: i } }); return; }
        if (p.title !== name) p.api.setTitle(name);
        if (p.group === dg && dg.panels.indexOf(p) === i) return;
        scrolls.push(keepScroll(p.view.content.element));
        p.api.moveTo({ group: dg, position: 'center', index: i, skipSetActive: true });
      });
    }
  };
  /** A window opened with no place given (a tab « Ouvrir dans une nouvelle fenêtre », a layout restored before the window-state
   *  plugin knew it): centred on the main window, at POPOUT_SIZE. */
  const centred = (): Box => ({ ...POPOUT_SIZE, left: Math.round(window.screenX + (window.outerWidth - POPOUT_SIZE.width) / 2), top: Math.round(window.screenY + (window.outerHeight - POPOUT_SIZE.height) / 2) });

  // Every render: a title may have changed (a session renamed) as well as the tabs.
  useLayoutEffect(() => {
    if (!api) return;
    syncing.current = true;
    try {
      const table = drawn.current;
      const scrolls: (() => void)[] = [];
      // Panels gone from the model go; the groups they leave stay while they draw a model group (an empty one shows its
      // proposals).
      for (const p of [...api.panels]) if (!tabs.has(p.id)) api.removePanel(p, { removeEmptyGroup: false });
      // dockview drops a group whose last panel is moved out: one still in the model (kept empty) is drawn again.
      // The popouts first: carrying a tab out may empty a main group, which the passes below draw again.
      drawPopouts(api, table, scrolls);
      for (let pass = 0; pass < 2; pass++) {
        draw(api, table, scrolls);
        if (groups.every(g => { const dg = table.get(g.id); return dg && api.groups.includes(dg); })) break;
      }
      // The groups left over (their model group gone, their panels moved out, a popout's window gone) go; a group carrying
      // a tab to a window still opening stays.
      const kept = new Set(table.values());
      for (const id of opening.current.values()) { const p = api.getPanel(id); if (p) kept.add(p.group); }
      for (const dg of [...api.groups]) if (!kept.has(dg)) api.removeGroup(dg);
      // Each group's front tab, then the focused group last: activating a panel also makes its group dockview's active one.
      for (const g of ws.groups) {
        if (!table.has(g.id)) continue;
        const front = g.tabs[g.active];
        const p = front ? api.getPanel(keyOf(front)) : undefined;
        if (p && p.group.activePanel !== p) p.api.setActive();
      }
      const focus = table.get(ws.focus);
      if (focus && api.activeGroup !== focus) focus.api.setActive();
      // A moved panel's DOM is back in the page now that the front tabs are shown.
      for (const back of scrolls) back();
    } finally { syncing.current = false; }
  });

  // Dockview → model. Unmounting (the switch turned off) closes nothing: a layout effect's cleanup runs before its
  // children's, so the listeners go before DockviewReact takes its panels down.
  useLayoutEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A bottom-panel tile carried over the dock lands as its terminal tab would (`terminal:<ref>`).
    const tile = () => { const ref = panelDragRef(); return ref === null ? null : `terminal:${ref}`; };
    const arrival = (e: DropSpot) => arrivalOf(e, api.id, dg => latestModelOf.current(dg), tile());
    const endDrag = () => { clearTimeout(timer); dragged.current = null; termDrag.set(null); setDragging(false); setTear(null); };
    /** The window a dockview group is drawn in: a popout's, else this page's. */
    const windowOfDg = (dg: DockviewGroupPanel | undefined): Window => (dg?.api.location.type === 'popout' ? dg.api.location.getWindow() : window);
    const subs = [
      api.onDidActivePanelChange(ev => {
        const id = ev.panel?.id;
        if (syncing.current || !id) return;
        latest.current.update(w => { const hit = find(w, id); return hit ? activate(w, hit.group.id, hit.index) : w; });
      }),
      // A click in a group's content: the group is focused, on its front tab; an empty group, on its proposals.
      api.onDidActiveGroupChange(dg => {
        if (syncing.current || !dg) return;
        const id = dg.activePanel?.id;
        if (id) { latest.current.update(w => { const hit = find(w, id); return hit ? activate(w, hit.group.id, hit.index) : w; }); return; }
        const empty = [...drawn.current].find(([, d]) => d === dg)?.[0];
        if (empty) latest.current.update(w => focusGroup(w, empty));
      }),
      // The user's close (×, middle click): remembered for Ctrl+Shift+T.
      api.onDidRemovePanel(p => { if (!syncing.current) latest.current.close(p.id); }),
      // A tab picked up: the drop zone shows once the browser has its drag image (a layout change in dragstart cancels it).
      // The bottom panel learns it too: it takes a terminal tab dropped on it.
      api.onWillDragPanel(e => {
        dragged.current = e.panel.id; termDrag.set({ from: 'dock', key: e.panel.id }); clearTimeout(timer);
        const from = windowOfDg(e.panel.group);
        timer = setTimeout(() => { if (dragged.current) { setDragging(true); setTear({ from, term: e.panel.id.startsWith('terminal:'), out: false }); } }, 0);
      }),
      // Something dockview does not know dragged over a group: taken only when it is a bottom-panel tile, where it could land.
      api.onUnhandledDragOver(e => { if (tile() !== null && arrival({ kind: e.target, position: e.position, group: e.group, getData: e.getData })) e.accept(); }),
      // No overlay where a drop would be refused.
      api.onWillShowOverlay(e => { if (!arrival(e)) e.preventDefault(); }),
      // Every drop is the model's: dockview moves nothing itself. (So dockview's onDidDrop, which follows an unprevented
      // onWillDrop, never comes: a tile's drop is read here too.)
      api.onWillDrop(e => {
        e.preventDefault();
        const ref = panelDragRef();
        const hit = arrival(e);
        endDrag();
        if (ref !== null) { if (hit) panelDrop.current?.(ref, hit.to); return; }
        if (hit) latest.current.update(w => moveTo(w, hit.key, hit.to));
      })
    ];
    // Lot 9. A popout opened: it takes the main window's look, and its drags end there too. Closed by the user (its ×,
    // Alt+F4; dockview has already put its panels back in the grid), the model closes the window: its tabs come back.
    // Closed because the model dropped it: its real window closes too (lot 0, point 5).
    const unmirror = new Map<Window, () => void>();
    const windowOfGroup = (dg: DockviewGroupPanel) => { const g = latestModelOf.current(dg); return g && g.window !== MAIN ? g.window : null; };
    subs.push(
      api.onDidAddPopoutGroup(e => {
        const w = e.window;
        if (!w) return;
        unmirror.set(w, mirrorRoot(w.document));
        // Its body takes the IDE's tokens; its bar goes above dockview's container, its drag banner after it.
        const doc = w.document;
        doc.body.classList.add('ide', 'ide-popout');
        const bar = doc.createElement('div');
        bar.className = 'ide-popout-bar-host';
        doc.body.prepend(bar);
        const banner = doc.createElement('div');
        doc.body.append(banner);
        setPopped(p => [...p.filter(x => x.win !== w), { dg: e.group, win: w, bar, banner }]);
        w.addEventListener('dragend', ev => { tearOut(ev, w); endDrag(); }, true);
        for (const type of ends) w.addEventListener(type, lateEnd, true);
        watchLeave(w);
      }),
      api.onWillClosePopoutWindow(e => { const w = e.window; if (!w) return; unmirror.get(w)?.(); unmirror.delete(w); setPopped(p => p.filter(x => x.win !== w)); closeNative(w); }),
      api.onDidRemovePopoutGroup(e => {
        const win = windowOfGroup(e.group);
        if (!win) return;
        drawn.current.forEach((d, id) => { if (d === e.group) drawn.current.delete(id); });
        closeByUser(win);
      })
    );
    /** The pointer leaving `w` while dragging: the banner of the window the drag started in turns solid; back in, dashed. */
    function watchLeave(w: Window): () => void {
      const doc = w.document;
      const leave = (ev: globalThis.DragEvent) => { if (!ev.relatedTarget && outsideWindow(ev, w)) setTear(t => (t && t.from === w && !t.out ? { ...t, out: true } : t)); };
      const enter = () => setTear(t => (t && t.from === w && t.out ? { ...t, out: false } : t));
      doc.addEventListener('dragleave', leave, true);
      doc.addEventListener('dragenter', enter, true);
      return () => { doc.removeEventListener('dragleave', leave, true); doc.removeEventListener('dragenter', enter, true); };
    }
    const unwatchMain = watchLeave(window);
    // Tauri tells the main window of each detached window destroyed (its ✕ by the OS, Alt+F4), by its label `ide-<id>`
    // (dev-back's contract, lot 9): the same as dockview noticing it, whichever comes first (the second finds nothing).
    let offClosed = () => {};
    let gone = false;
    if (isTauri()) void import('@tauri-apps/api/event').then(e => e.listen<string>('ledge://popout-closed', m => {
      const label = m.payload;
      if (typeof label === 'string' && label.startsWith('ide-')) closeByUser(label.slice(4));
    })).then(un => { if (gone) un(); else offClosed = un; }).catch(() => {});
    /** A drag let go outside the window it started in: the tab (or the bottom-panel terminal) opens in a new window there.
     *  The only tab of a secondary window moves its window instead (v27). Read before `endDrag` forgets what was dragged. */
    const tearOut = (e: globalThis.DragEvent, from: Window) => {
      if (!outsideWindow(e, from) || (e.dataTransfer && e.dataTransfer.dropEffect !== 'none')) return;
      const box = boxAt(e.screenX, e.screenY);
      const key = dragged.current;
      const ref = panelDragRef();
      const w = latest.current.get();
      // The model names its next window `w<next>` (addGroup): its box is known before it is drawn.
      const next = `w${w.next}`;
      if (ref !== null) { boxes.current.set(next, box); panelDrop.current?.(ref, { window: 'new' }); return; }
      if (!key) return;
      const hit = find(w, key);
      if (!hit) return;
      if (hit.group.window !== MAIN && hit.group.tabs.length === 1) { moveWindow(hit.group.window, box); return; }
      boxes.current.set(next, box);
      latest.current.update(x => move(x, key, { window: 'new' }));
    };
    /** A secondary window moved to `box` (its only tab torn out of it). */
    const moveWindow = (win: string, box: Box) => {
      boxes.current.set(win, box);
      const dg = drawn.current.get(latest.current.get().groups.find(g => g.window === win)?.id ?? '');
      const pw = dg?.api.location.type === 'popout' ? dg.api.location.getWindow() : null;
      try { pw?.moveTo(box.left, box.top); } catch { /* a webview may refuse: the window stays where it is */ }
    };
    const onMainDragEnd = (e: globalThis.DragEvent) => tearOut(e, window);
    // A tile picked up in the bottom panel shows the drop zone too (after its dragstart, as above); let go, it hides.
    const unwatch = termDrag.subscribe(() => {
      if (panelDragRef() !== null) { clearTimeout(timer); timer = setTimeout(() => { if (panelDragRef() !== null) { setDragging(true); setTear({ from: window, term: true, out: false }); } }, 0); }
      else if (!dragged.current) { clearTimeout(timer); setDragging(false); }
    });
    // Also when the tab is let go elsewhere (or Esc): the source tab, still in place, sends dragend up. A drag can also end
    // with no dragend (its source re-rendered away, a webview that drops it): a drop anywhere, or a pointer let go while
    // dragging, ends it too, once the drop's own handlers (the zone's) have read what was dragged.
    let late: ReturnType<typeof setTimeout> | undefined;
    const lateEnd = () => { if (dragged.current || termDrag.get()) { clearTimeout(late); late = setTimeout(endDrag, 0); } };
    const ends = ['drop', 'pointerup', 'mouseup'] as const;
    // The tear-out reads the drag first: registered before endDrag, which forgets it.
    window.addEventListener('dragend', onMainDragEnd, true);
    window.addEventListener('dragend', endDrag, true);
    for (const type of ends) window.addEventListener(type, lateEnd, true);
    return () => {
      clearTimeout(timer); clearTimeout(late);
      window.removeEventListener('dragend', onMainDragEnd, true);
      window.removeEventListener('dragend', endDrag, true);
      for (const off of unmirror.values()) off();
      unwatchMain();
      gone = true; offClosed();
      for (const type of ends) window.removeEventListener(type, lateEnd, true);
      for (const s of subs) s.dispose();
      unwatch();
    };
  }, [api]);
  const onReady = (e: DockviewReadyEvent) => setApi(e.api);
  // The drop zone: only this dock's tab or a bottom-panel tile (a file dragged in finds nothing to drop on), into a new group
  // at the right end.
  const onZoneOver = (e: DragEvent) => { if (!dragged.current && panelDragRef() === null) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };
  const onZoneDrop = (e: DragEvent) => {
    const key = dragged.current;
    const ref = panelDragRef();
    if (!key && ref === null) return;
    e.preventDefault();
    dragged.current = null;
    termDrag.set(null);
    setDragging(false);
    if (ref !== null) {
      const last = store.get().groups.filter(g => g.window === MAIN).at(-1);
      if (last) onPanelDrop?.(ref, { rightOf: last.id });
      return;
    }
    if (!key) return;
    store.update(w => {
      const last = w.groups.filter(g => g.window === MAIN).at(-1);
      // The last group's only tab is already there.
      if (!last || (last.tabs.length === 1 && keyOf(last.tabs[0]!) === key)) return w;
      return moveTo(w, key, { rightOf: last.id });
    });
  };
  const messages = useMemo(() => ({ closeTab: (name: string) => t.ide.closeTab(name) }), [t]);

  // Each detached window: the model window its group draws, and its name (its active tab's).
  const detached = popped.map(p => {
    const g = modelOf(p.dg);
    const front = g?.tabs[g.active];
    return { ...p, win: p.win, model: g?.window ?? null, name: front ? windowTitle(front) : '' };
  });
  // Its page title, and its taskbar title in Tauri (« {tab} — Ledge »).
  const names = detached.map(d => `${d.model}\u0000${d.name}`).join('\u0001');
  useEffect(() => {
    for (const d of detached) {
      if (!d.name) continue;
      const text = t.ide.windows.taskbar(d.name);
      if (d.win.document.title !== text) d.win.document.title = text;
      const label = popoutLabel(d.win);
      if (label) setWindowTitle(label, text);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, t]);
  const tearText = tear ? (tear.out ? t.ide.windows.tearOut : tear.term ? t.ide.windows.tearTerm : t.ide.windows.tearTab) : '';
  const banner = tear ? <div className={`ide-tear-banner${tear.out ? ' out' : ''}`} role="status">{tearText}</div> : null;

  return (
    <Content.Provider value={content}>
      {/* R6: the box is as wide as its groups need; dockview's element fills it (and lays out on its resize), the scroller
          lets it overflow the editing area. */}
      <div className={`ide-dock-scroll${dragging ? ' tab-dragging' : ''}`}>
        <div className="ide-dock-sized" style={{ minWidth: `${groups.length * GROUP_MIN_WIDTH}px` }}>
          <DockviewReact className="ide-dockview" components={COMPONENTS} defaultTabComponent={PanelTab} watermarkComponent={GroupWatermark}
            prefixHeaderActionsComponent={LinkSquare} rightHeaderActionsComponent={StripTools} onReady={onReady} theme={THEME}
            dndEdges={false} disableFloatingGroups messages={messages} />
        </div>
        <div className="ide-dropnew" onDragOver={onZoneOver} onDrop={onZoneDrop}><span>{t.ide.dropNew[0]}<br />{t.ide.dropNew[1]}</span></div>
      </div>
      {tear?.from === window && banner}
      {detached.map(d => (
        <Fragment key={d.dg.id}>
          {d.model && createPortal(<PopoutTitleBar name={d.name} label={popoutLabel(d.win)} onClose={() => closeByUser(d.model!)} />, d.bar)}
          {tear?.from === d.win && createPortal(banner, d.banner)}
        </Fragment>
      ))}
    </Content.Provider>
  );
}
