import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type DockviewTheme, type IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { useI18n } from '../i18n/lang';
import { activate, close, find, focused, keyOf, type Tab, type Workspace } from '../workspace/model';
import type { WorkspaceStore } from '../workspace/store';
import type { TabBody } from './tabs';
import '../styles/ide.css';

export interface DockHostProps { ws: Workspace; store: WorkspaceStore; title(t: Tab): string; body: TabBody }

/** What a panel reads to draw its tab's content: the latest of Shell's, each render. */
const Content = createContext<{ tabOf(id: string): Tab | undefined; body: TabBody } | null>(null);

/** One panel = one tab of the model (`id = keyOf(tab)`). dockview draws only the visible one (`onlyWhenVisible`, its default). */
function Pane({ api }: IDockviewPanelProps): JSX.Element | null {
  const c = useContext(Content);
  const tab = c?.tabOf(api.id);
  return tab ? <div className="ide-pane">{c!.body(tab)}</div> : null;
}
const COMPONENTS = { tab: Pane };
const Empty = () => null;
// Ledge's tokens, set on `.ide-dock` in ide.css.
const THEME: DockviewTheme = { name: 'ledge', className: 'ide-dock' };

/** The editing area: dockview drawing the model's focused group, kept in step both ways. Model → dockview: panels added,
 *  removed, retitled and activated to follow `ws`. Dockview → model: a tab chosen is `activate`d, a tab closed is `close`d.
 *  Lot 1 has one group: no drag and drop, no floating groups (lot 3). */
export function DockHost({ ws, store, title, body }: DockHostProps): JSX.Element {
  const { t } = useI18n();
  const [api, setApi] = useState<DockviewApi | null>(null);
  // Set while the model is being written into dockview: the events that writing raises are not the user's.
  const syncing = useRef(false);
  const latest = useRef(store);
  latest.current = store;
  const group = focused(ws);
  const tabs = new Map(group.tabs.map(tab => [keyOf(tab), tab]));
  const content = { tabOf: (id: string) => tabs.get(id), body };

  // Every render: a title may have changed (a session renamed) as well as the tabs.
  useLayoutEffect(() => {
    if (!api) return;
    syncing.current = true;
    try {
      for (const p of [...api.panels]) if (!tabs.has(p.id)) api.removePanel(p);
      for (const [id, tab] of tabs) {
        const name = title(tab);
        const p = api.getPanel(id);
        if (!p) api.addPanel({ id, component: 'tab', title: name, inactive: true });
        else if (p.title !== name) p.api.setTitle(name);
      }
      const front = group.tabs[group.active];
      const p = front ? api.getPanel(keyOf(front)) : undefined;
      if (p && api.activePanel !== p) p.api.setActive();
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
