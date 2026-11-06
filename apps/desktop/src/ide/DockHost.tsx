import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { DockviewReact, type DockviewApi, type DockviewGroupPanel, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useI18n } from '../i18n/lang';
import { activate, close, find, keyOf, MAIN, type Group, type Tab, type Workspace } from '../workspace/model';
import type { WorkspaceStore } from '../workspace/store';
import { TabPlaceContext, type TabPlace } from '../workspace/tabPlace';
import type { TabBody } from './tabs';
import '../styles/ide.css';

export interface DockHostProps { ws: Workspace; store: WorkspaceStore; title(t: Tab): string; body: TabBody }

/** What a panel reads to draw its tab's content: the latest of Shell's, each render. */
const Content = createContext<{ tabOf(id: string): Tab | undefined; body: TabBody; groupOf(id: string): string | undefined; focus: string } | null>(null);

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
const COMPONENTS = { tab: Pane };
const Empty = () => null;
// Ledge's tokens, set on `.ide-dock` in ide.css.
const THEME: DockviewTheme = { name: 'ledge', className: 'ide-dock' };

/** The editing area: dockview drawing the main window's groups side by side, kept in step both ways. Model → dockview:
 *  one dockview group per model group (window MAIN, left to right), panels added, removed, retitled and activated to
 *  follow `ws`, the focused group made dockview's active one. Dockview → model: a tab chosen or a group clicked is
 *  `activate`d (which focuses its group), a tab closed is `close`d. A model group without tabs is not drawn: a dockview
 *  group lives only while it holds a panel. No drag and drop, no floating groups (lot 3). */
export function DockHost({ ws, store, title, body }: DockHostProps): JSX.Element {
  const { t } = useI18n();
  const [api, setApi] = useState<DockviewApi | null>(null);
  // Set while the model is being written into dockview: the events that writing raises are not the user's.
  const syncing = useRef(false);
  // Model group id → the dockview group drawing it.
  const drawn = useRef(new Map<string, DockviewGroupPanel>());
  const latest = useRef(store);
  latest.current = store;
  const groups = ws.groups.filter(g => g.window === MAIN && g.tabs.length > 0);
  const tabs = new Map<string, { tab: Tab; group: Group }>();
  for (const g of groups) for (const tab of g.tabs) tabs.set(keyOf(tab), { tab, group: g });
  const content = { tabOf: (id: string) => tabs.get(id)?.tab, body, groupOf: (id: string) => tabs.get(id)?.group.id, focus: ws.focus };

  // Every render: a title may have changed (a session renamed) as well as the tabs.
  useLayoutEffect(() => {
    if (!api) return;
    syncing.current = true;
    try {
      const table = drawn.current;
      const prune = () => { const live = new Set(api.groups); for (const [id, dg] of table) if (!live.has(dg) || !groups.some(g => g.id === id)) table.delete(id); };
      prune();
      // A model group not in the table yet takes the dockview group its panels already sit in, if no other has it.
      for (const g of groups) {
        if (table.has(g.id)) continue;
        const dg = g.tabs.map(tab => api.getPanel(keyOf(tab))?.group).find(Boolean);
        if (dg && ![...table.values()].includes(dg)) table.set(g.id, dg);
      }
      // Panels gone from the model, or sitting in another group than their model group's, go (re-added below).
      for (const p of [...api.panels]) { const hit = tabs.get(p.id); if (!hit || table.get(hit.group.id) !== p.group) api.removePanel(p); }
      prune();   // a dockview group emptied above went with its last panel
      let left: DockviewGroupPanel | undefined;
      for (const g of groups) {
        let dg = table.get(g.id);
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
      // A click in a group's content: the group is focused, on its front tab.
      api.onDidActiveGroupChange(dg => {
        const id = dg?.activePanel?.id;
        if (syncing.current || !id) return;
        latest.current.update(w => { const hit = find(w, id); return hit ? activate(w, hit.group.id, hit.index) : w; });
      }),
      api.onDidRemovePanel(p => { if (!syncing.current) latest.current.update(w => close(w, p.id)); })
    ];
    return () => { for (const s of subs) s.dispose(); };
  }, [api]);
  const onReady = (e: DockviewReadyEvent) => setApi(e.api);
  const messages = useMemo(() => ({ closeTab: (name: string) => t.ide.closeTab(name) }), [t]);

  return (
    <Content.Provider value={content}>
      <DockviewReact className="ide-dockview" components={COMPONENTS} watermarkComponent={Empty} onReady={onReady} theme={THEME}
        disableDnd disableFloatingGroups messages={messages} />
    </Content.Provider>
  );
}
