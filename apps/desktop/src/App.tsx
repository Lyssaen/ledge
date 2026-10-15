import { useEffect, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { groupSessions } from '@ledge/fleet';
import { LangProvider, loadLang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { needsAttention, visibleSessions } from './fleet/attention';
import { useViewState } from './state/useViewState';
import { Heading } from './shell/Heading';
import { TeamView } from './team/TeamView';
import { RoomView } from './room/RoomView';
import { tables } from './grouping/groups';
import { OfflineNotice, LocalDownNotice } from './shell/OfflineNotice';
import { StatusBar } from './shell/StatusBar';
import { EmptyWorkspace } from './shell/EmptyWorkspace';
import { useI18n } from './i18n/lang';
import { SplitView } from './conversation/SplitView';
import { ConversationPane } from './conversation/ConversationPane';
import { useStored } from './state/useStored';
import { loadPanel, savePanel } from './state/panel';
import { useConversations } from './conversation/useConversations';

function Shell({ client }: { client?: DaemonClient }) {
  const [state, dispatch] = useViewState();
  const { sessions, machines, fleet, localDown, client: fleetClient } = useFleet(client);
  const { t } = useI18n();
  // Open once, for good: the daemon has sent its machine list (it follows the first snapshot; until then only local is known), some machine has delivered a snapshot and every machine has settled (ready, or unreachable after its
  // first attempt). The fleet publishes empty snapshots earlier, and local can be ready before a remote's first one, so
  // pruning sooner would drop a persisted remote selection. With every machine down nothing is known, so nothing is pruned.
  const opened = useRef(false);
  if (!opened.current && fleet.machinesSource() === 'daemon' && machines.some(m => m.ready) && machines.every(m => m.ready || m.status === 'unreachable')) opened.current = true;
  const ready = opened.current;
  const visible = visibleSessions(sessions, state.attentionOnly);
  const shown = state.view === 'room' ? tables(visible, state.grouping, t).flatMap(g => g.sessions) : groupSessions(visible).flatMap(g => g.sessions);
  // The ids the screen lists, in display order. Held back until a machine has delivered its first snapshot: before it `sessions` is [] and the
  // selection restored from storage would be wiped (spec §9.1).
  // While the local daemon is down its sessions are frozen (offline) and the view is read-only: nothing is pruned.
  const key = shown.map(s => s.id).join('\n');
  useEffect(() => { if (ready && !localDown) dispatch({ type: 'visible', ids: key ? key.split('\n') : [] }); }, [ready, localDown, key, dispatch]);
  const [panel, setPanel] = useStored(loadPanel, savePanel);
  // Bound to the conversation pane. `ready` is the Shell's `opened` (first snapshot received), never a bare connection.
  const conversations = useConversations(fleetClient, sessions, machines, ready);
  // The resident (`ledge`) gets its own panel in a later lot; a lost selection is replaced by the first visible session (lot 3 reducer).
  const selected = state.selected && state.selected !== 'ledge' ? sessions.find(s => s.id === state.selected) ?? null : null;
  // « Agrandir » folds back when the view or the attention filter changes (mockup conversation.js).
  const scope = `${state.view}|${state.attentionOnly}`;
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setPanel(p => (p.expanded ? { ...p, expanded: false } : p));
  }, [scope, setPanel]);
  return (
    <main className="app" data-readonly={localDown ? 'true' : undefined}>
      <div className="content">
        <Heading state={state} dispatch={dispatch} attentionCount={sessions.filter(needsAttention).length} />
        {localDown && <LocalDownNotice />}
        <OfflineNotice machines={machines} onRetry={id => fleet.retry(id)} />
        {(ready || localDown) && sessions.length === 0 && <EmptyWorkspace />}
        {sessions.length > 0 && <SplitView selectedId={selected?.id ?? null} panel={panel} onPanel={setPanel}
          list={<>
            {state.view === 'room' && <RoomView sessions={visible} grouping={state.grouping} selected={state.selected} onSelect={id => dispatch({ type: 'select', id })} onGrouping={grouping => dispatch({ type: 'grouping', grouping })} />}
            {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={id => dispatch({ type: 'select', id })} attentionOnly={state.attentionOnly} />}
          </>}
          pane={selected ? <ConversationPane session={selected} client={fleetClient} api={conversations} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
        <StatusBar sessions={sessions} machines={machines} />
      </div>
    </main>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState(loadLang);
  return <LangProvider lang={lang}><Shell client={client} /></LangProvider>;
}
