import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { DockviewReact, type DockviewApi, type DockviewGroupPanel, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type IWatermarkPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { activate, close, cycleLink, find, focusGroup, keyOf, MAIN, split, type Group, type Tab, type Workspace } from '../workspace/model';
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
  /** The model group a dockview group draws. */ modelOf(dg: unknown): Group | undefined; emptyGroup(groupId: string): ReactNode; split(groupId: string): void; cycleLink(groupId: string): void } | null>(null);

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
        <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" /></svg>
      </button>
    </span>
  );
}
/** The tools at the right of a group's tab strip (mockup groupHtml() `.tabs .tools`): « + », a new session, then the split. */
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
// Ledge's tokens, set on `.ide-dock` in ide.css.
const THEME: DockviewTheme = { name: 'ledge', className: 'ide-dock' };

/** The editing area: dockview drawing the main window's groups side by side, kept in step both ways. Model → dockview:
 *  one dockview group per model group (window MAIN, left to right), panels added, removed, retitled and activated to
 *  follow `ws`, the focused group made dockview's active one. Dockview → model: a tab chosen or a group clicked is
 *  `activate`d (which focuses its group), a tab closed is `close`d, an empty group clicked is focused. A model group without
 *  tabs is drawn as an empty dockview group showing its proposals. Each group keeps GROUP_MIN_WIDTH: the dock is as wide as
 *  its groups need and scrolls sideways in the editing area. No drag and drop, no floating groups (lot 3). */
export function DockHost({ ws, store, title, body, label, alert, onTabMenu, onNewSession, emptyGroup }: DockHostProps): JSX.Element {
  const { t } = useI18n();
  const [api, setApi] = useState<DockviewApi | null>(null);
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
  const content = { tabOf: (id: string) => tabs.get(id)?.tab, body, title, label, alert, onTabMenu, onNewSession, groupOf: (id: string) => tabs.get(id)?.group.id, focus: ws.focus,
    modelOf, emptyGroup, split: (id: string) => store.update(w => split(w, id)), cycleLink: (id: string) => store.update(w => cycleLink(w, id)) };

  // Every render: a title may have changed (a session renamed) as well as the tabs.
  useLayoutEffect(() => {
    if (!api) return;
    syncing.current = true;
    try {
      const table = drawn.current;
      const live = new Set(api.groups);
      for (const [id, dg] of table) if (!live.has(dg) || !groups.some(g => g.id === id)) table.delete(id);
      // A model group not in the table yet takes the dockview group its panels already sit in, if no other has it.
      for (const g of groups) {
        if (table.has(g.id)) continue;
        const dg = g.tabs.map(tab => api.getPanel(keyOf(tab))?.group).find(Boolean);
        if (dg && ![...table.values()].includes(dg)) table.set(g.id, dg);
      }
      // Panels gone from the model, or sitting in another group than their model group's, go (re-added below); the groups
      // they leave stay while they draw a model group (an empty one shows its proposals), the others go.
      for (const p of [...api.panels]) { const hit = tabs.get(p.id); if (!hit || table.get(hit.group.id) !== p.group) api.removePanel(p, { removeEmptyGroup: false }); }
      const kept = new Set(table.values());
      for (const dg of [...api.groups]) if (!kept.has(dg)) api.removeGroup(dg);
      let left: DockviewGroupPanel | undefined;
      for (const g of groups) {
        let dg = table.get(g.id);
        // An empty group not drawn yet: a dockview group without panels, placed as a new group's first panel would be.
        if (!dg && g.tabs.length === 0) {
          const first = api.groups[0];
          dg = left ? api.addGroup({ referenceGroup: left, direction: 'right' }) : first ? api.addGroup({ referenceGroup: first, direction: 'left' }) : api.addGroup();
          table.set(g.id, dg);
        }
        g.tabs.forEach((tab, i) => {
          const id = keyOf(tab);
          const name = title(tab);
          const p = api.getPanel(id);
          if (p) { if (p.title !== name) p.api.setTitle(name); return; }
          // At the model's index in its group (a panel added inactive would otherwise go before the front one); a group
          // not drawn yet opens right of its left neighbour, or left of the first group when it has none.
          const first = api.groups[0];
          const position = dg ? { referenceGroup: dg, index: i } : left ? { referenceGroup: left, direction: 'right' as const }
            : first ? { referenceGroup: first, direction: 'left' as const } : undefined;
          const added = api.addPanel({ id, component: 'tab', title: name, inactive: true, ...(position ? { position } : {}) });
          if (!dg) { dg = added.group; table.set(g.id, dg); }
        });
        if (dg && dg.minimumWidth !== GROUP_MIN_WIDTH) dg.api.setConstraints({ minimumWidth: GROUP_MIN_WIDTH });
        left = dg;
      }
      // Each group's front tab, then the focused group last: activating a panel also makes its group dockview's active one.
      for (const g of groups) {
        const front = g.tabs[g.active];
        const p = front ? api.getPanel(keyOf(front)) : undefined;
        if (p && p.group.activePanel !== p) p.api.setActive();
      }
      const focus = table.get(ws.focus);
      if (focus && api.activeGroup !== focus) focus.api.setActive();
    } finally { syncing.current = false; }
  });

  // Dockview → model. Unmounting (the switch turned off) closes nothing: a layout effect's cleanup runs before its
  // children's, so the listeners go before DockviewReact takes its panels down.
  useLayoutEffect(() => {
    if (!api) return;
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
      api.onDidRemovePanel(p => { if (!syncing.current) latest.current.update(w => close(w, p.id)); })
    ];
    return () => { for (const s of subs) s.dispose(); };
  }, [api]);
  const onReady = (e: DockviewReadyEvent) => setApi(e.api);
  const messages = useMemo(() => ({ closeTab: (name: string) => t.ide.closeTab(name) }), [t]);

  return (
    <Content.Provider value={content}>
      {/* R6: the box is as wide as its groups need; dockview's element fills it (and lays out on its resize), the scroller
          lets it overflow the editing area. */}
      <div className="ide-dock-scroll">
        <div className="ide-dock-sized" style={{ minWidth: `${groups.length * GROUP_MIN_WIDTH}px` }}>
          <DockviewReact className="ide-dockview" components={COMPONENTS} defaultTabComponent={PanelTab} watermarkComponent={GroupWatermark}
            leftHeaderActionsComponent={LinkSquare} rightHeaderActionsComponent={StripTools} onReady={onReady} theme={THEME}
            disableDnd disableFloatingGroups messages={messages} />
        </div>
      </div>
    </Content.Provider>
  );
}
