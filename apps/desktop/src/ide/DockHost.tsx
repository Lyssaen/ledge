import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type JSX, type ReactNode } from 'react';
import { DockviewReact, type DockviewApi, type DockviewGroupDropLocation, type DockviewGroupPanel, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type IWatermarkPanelProps, type PanelTransfer, type Position } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { activate, closeGroup, cycleLink, find, focusGroup, keyOf, MAIN, moveTo, split, type Group, type Tab, type Workspace } from '../workspace/model';
import type { WorkspaceStore } from '../workspace/store';
import { TabPlaceContext, type TabPlace } from '../workspace/tabPlace';
import type { TabBody } from './tabs';
import '../styles/ide.css';

export interface DockHostProps {
  ws: Workspace; store: WorkspaceStore; title(t: Tab): string; body: TabBody;
  /** A tab's content (SessionTabLabel for a session or seat, its title otherwise). */
  label(t: Tab): ReactNode;
  /** The alert a tab carries: a red or amber line under it. */
  alert(t: Tab): 'perm' | 'ask' | null;
  onTabMenu(t: Tab, at: { x: number; y: number }): void;
  /** The « + » at the right of each tab strip: the launch dialog. */
  onNewSession(): void;
  /** What a group without tabs shows (EmptyGroup): its proposals. */
  emptyGroup(groupId: string): ReactNode;
}

/** R6: a group is never narrower than this (mockup `.grow-row>.pane{min-width:300px}`); past it the editing area scrolls. */
export const GROUP_MIN_WIDTH = 300;

/** What a panel reads to draw its tab's content: the latest of Shell's, each render. */
const Content = createContext<{ tabOf(id: string): Tab | undefined; body: TabBody; title(t: Tab): string; label(t: Tab): ReactNode; alert(t: Tab): 'perm' | 'ask' | null; onTabMenu(t: Tab, at: { x: number; y: number }): void; onNewSession(): void; groupOf(id: string): string | undefined; focus: string;
  /** The model group a dockview group draws. */ modelOf(dg: unknown): Group | undefined; emptyGroup(groupId: string): ReactNode; split(groupId: string): void; cycleLink(groupId: string): void;
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
      <button type="button" title={t.ide.newSession} aria-label={t.ide.newSession} onClick={() => c?.onNewSession()}>
        +
      </button>
      <button type="button" title={t.ide.splitTip} aria-label={t.ide.splitTip} onClick={() => { if (g) c!.split(g.id); }}>
        <Icon d={SHELL_ICONS.split} size={14} />
      </button>
      {g && g.tabs.length === 0 && !c!.lone && (
        <button type="button" title={t.ide.closeGroupTip} aria-label={t.ide.closeGroupTip} onClick={() => c!.closeGroup(g.id)}>
          <CloseGlyph size={10} />
        </button>
      )}
    </div>
  );
}
/** The link square left of the tabs (mockup `.lkbtn`): the group's colour, dashed when it has none; a click cycles it. */
function LinkSquare({ group }: IDockviewHeaderActionsProps): JSX.Element {
  const c = useContext(Content);
  const { t } = useI18n();
  const g = c?.modelOf(group);
  return (
    <button type="button" className="ide-lkbtn" title={t.ide.linkTip} aria-label={t.ide.linkTip} onClick={() => { if (g) c!.cycleLink(g.id); }}>
      <span className={`ide-lk ${g?.link ?? 'none'}`} aria-hidden="true" />
    </button>
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
export function arrivalOf(e: DropSpot, viewId: string, modelOf: (dg: DockviewGroupPanel) => Group | undefined): Arrival | null {
  const data = e.getData();
  if (!data || data.viewId !== viewId || !data.panelId || e.edge) return null;
  const dg = e.group;
  if (!dg || dg.api.location.type !== 'grid') return null;
  const g = modelOf(dg);
  if (!g) return null;
  const key = data.panelId;
  const own = g.tabs.some(t => keyOf(t) === key);
  switch (e.kind) {
    // dockview's index is where the tab lands in the strip once taken out of it: the tab dropped on, or the one after it
    // past its middle, less one when the dragged tab sat before it in the same strip (tabAnimation 'default').
    case 'tab': return { key, to: { group: g.id, index: e.index } };
    case 'header_space': return { key, to: own ? { group: g.id, index: g.tabs.length - 1 } : { group: g.id } };
    case 'content':
      if (e.position === 'center') return own ? null : { key, to: { group: g.id } };
      if (e.position === 'right') return own && g.tabs.length === 1 ? null : { key, to: { rightOf: g.id } };
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
export function DockHost({ ws, store, title, body, label, alert, onTabMenu, onNewSession, emptyGroup }: DockHostProps): JSX.Element {
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
  const groups = ws.groups.filter(g => g.window === MAIN);
  const tabs = new Map<string, { tab: Tab; group: Group }>();
  for (const g of groups) for (const tab of g.tabs) tabs.set(keyOf(tab), { tab, group: g });
  // Read when a part renders, after the sync below has drawn (and so mapped) its group.
  const modelOf = (dg: unknown) => { for (const [id, d] of drawn.current) if (d === dg) return groups.find(g => g.id === id); return undefined; };
  // The listeners below outlive renders: they read the latest groups.
  const latestModelOf = useRef(modelOf);
  latestModelOf.current = modelOf;
  const content = { tabOf: (id: string) => tabs.get(id)?.tab, body, title, label, alert, onTabMenu, onNewSession, groupOf: (id: string) => tabs.get(id)?.group.id, focus: ws.focus,
    modelOf, emptyGroup, split: (id: string) => store.update(w => split(w, id)), cycleLink: (id: string) => store.update(w => cycleLink(w, id)),
    closeGroup: (id: string) => store.update(w => closeGroup(w, id)), lone: groups.length === 1 };

  /** Draws each model group, left to right: its dockview group (made where it belongs if it has none) and its panels at
   *  their places. A panel sitting elsewhere is moved there, never remade, so its content keeps its state; what puts its
   *  scroll back goes in `scrolls`, run once it is on show. */
  const draw = (api: DockviewApi, table: Map<string, DockviewGroupPanel>, scrolls: (() => void)[]) => {
    const live = new Set(api.groups);
    for (const [id, dg] of table) if (!live.has(dg) || !groups.some(g => g.id === id)) table.delete(id);
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
      for (let pass = 0; pass < 2; pass++) {
        draw(api, table, scrolls);
        if (groups.every(g => { const dg = table.get(g.id); return dg && api.groups.includes(dg); })) break;
      }
      // The groups left over (their model group gone, their panels moved out) go.
      const kept = new Set(table.values());
      for (const dg of [...api.groups]) if (!kept.has(dg)) api.removeGroup(dg);
      // Each group's front tab, then the focused group last: activating a panel also makes its group dockview's active one.
      for (const g of groups) {
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
    const arrival = (e: DropSpot) => arrivalOf(e, api.id, dg => latestModelOf.current(dg));
    const endDrag = () => { clearTimeout(timer); dragged.current = null; setDragging(false); };
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
      api.onWillDragPanel(e => { dragged.current = e.panel.id; clearTimeout(timer); timer = setTimeout(() => { if (dragged.current) setDragging(true); }, 0); }),
      // No overlay where a drop would be refused.
      api.onWillShowOverlay(e => { if (!arrival(e)) e.preventDefault(); }),
      // Every drop is the model's: dockview moves nothing itself.
      api.onWillDrop(e => {
        e.preventDefault();
        const hit = arrival(e);
        endDrag();
        if (hit) latest.current.update(w => moveTo(w, hit.key, hit.to));
      })
    ];
    // Also when the tab is let go elsewhere (or Esc): the source tab, still in place, sends dragend up. A drag can also end
    // with no dragend (its source re-rendered away, a webview that drops it): a drop anywhere, or a pointer let go while
    // dragging, ends it too, once the drop's own handlers (the zone's) have read what was dragged.
    let late: ReturnType<typeof setTimeout> | undefined;
    const lateEnd = () => { if (dragged.current) { clearTimeout(late); late = setTimeout(endDrag, 0); } };
    const ends = ['drop', 'pointerup', 'mouseup'] as const;
    window.addEventListener('dragend', endDrag, true);
    for (const type of ends) window.addEventListener(type, lateEnd, true);
    return () => {
      clearTimeout(timer); clearTimeout(late);
      window.removeEventListener('dragend', endDrag, true);
      for (const type of ends) window.removeEventListener(type, lateEnd, true);
      for (const s of subs) s.dispose();
    };
  }, [api]);
  const onReady = (e: DockviewReadyEvent) => setApi(e.api);
  // The drop zone: only this dock's tab (a file dragged in finds nothing to drop on), into a new group at the right end.
  const onZoneOver = (e: DragEvent) => { if (!dragged.current) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };
  const onZoneDrop = (e: DragEvent) => {
    const key = dragged.current;
    if (!key) return;
    e.preventDefault();
    dragged.current = null;
    setDragging(false);
    store.update(w => {
      const last = w.groups.filter(g => g.window === MAIN).at(-1);
      // The last group's only tab is already there.
      if (!last || (last.tabs.length === 1 && keyOf(last.tabs[0]!) === key)) return w;
      return moveTo(w, key, { rightOf: last.id });
    });
  };
  const messages = useMemo(() => ({ closeTab: (name: string) => t.ide.closeTab(name) }), [t]);

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
    </Content.Provider>
  );
}
