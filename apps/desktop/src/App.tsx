import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useLaunch } from './launch/useLaunch';
import { LaunchScreen } from './launch/LaunchScreen';
import { clearLaunch } from './launch/form';
import { onTrayAction } from './tauri/bridge';

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
  // The launch lives in the Shell, not in its screen: a start cancelled by closing the screen still owes an answer, skipped (spec §9.2).
  const [created, setCreated] = useState<string | null>(null);
  const onLaunched = useCallback((id: string) => { clearLaunch(); setCreated(id); }, []);
  const launch = useLaunch(fleet, machines, onLaunched);
  const launching = launch.flow.stage !== 'closed';
  // Read-only while the local daemon is down (spec §6): every machine, remote ones too, is reached through it.
  const canLaunch = !localDown;
  const opener = useRef<'heading' | 'empty'>('heading');
  const { open: openFlow } = launch;
  const openLaunch = useCallback((from: 'heading' | 'empty') => { opener.current = from; openFlow(); }, [openFlow]);
  // Tray « Nouvelle session » (main.rs shows the window first). Ignored while read-only; an open screen is left as it is
  // (`open` is a no-op unless closed). « Ne pas déranger » and the tray labels' language come with lot 7.
  const trayNew = useRef<() => void>(() => {});
  useEffect(() => { trayNew.current = () => { if (canLaunch) openLaunch('heading'); }; });
  useEffect(() => onTrayAction(action => { if (action === 'new') trayNew.current(); }), []);

  // The new session is selected once the fleet lists it: the attention filter goes off so it shows, the panel folds back,
  // and the cursor goes to the reply once its conversation is on screen (mockup launch.js).
  const replyFor = useRef<string | null>(null);
  const [replyTick, setReplyTick] = useState(0);
  useEffect(() => {
    if (!created || !sessions.some(s => s.id === created)) return;
    setCreated(null);
    dispatch({ type: 'attention', on: false });
    dispatch({ type: 'select', id: created });
    setPanel(p => (p.expanded ? { ...p, expanded: false } : p));
    replyFor.current = created;
    setReplyTick(n => n + 1);
  }, [created, sessions, dispatch, setPanel]);
  // Keyed on the created-session trigger and on what the pane shows, so it never steals focus on unrelated renders.
  const paneId = selected?.id ?? null;
  useEffect(() => {
    const id = replyFor.current;
    if (!id || paneId !== id || document.getElementById('conversation-pane')?.getAttribute('data-conversation') !== id) return;
    const reply = document.getElementById('conversation-reply');
    if (!reply) return;
    replyFor.current = null;
    reply.focus({ preventScroll: true });
  }, [replyTick, paneId, panel.expanded]);
  // Choosing another session before the new one's conversation shows drops the pending focus.
  const pick = (id: string) => { replyFor.current = null; dispatch({ type: 'select', id }); };

  // Closing without a new session (Back to sessions, Cancel) gives the focus back to the button that opened the screen.
  const wasLaunching = useRef(false);
  useEffect(() => {
    if (wasLaunching.current && !launching && !created) {
      (document.querySelector<HTMLElement>(`[data-open-launch="${opener.current}"]`) ?? document.querySelector<HTMLElement>('[data-open-launch]'))?.focus({ preventScroll: true });
    }
    wasLaunching.current = launching;
  }, [launching, created]);
  // Inside the launch screen the local-down notice is a status: only its own validation and failure messages are alerts there.
  const offline = <OfflineNotice machines={machines} onRetry={id => fleet.retry(id)} />;
  return (
    <main className="app" data-readonly={localDown ? 'true' : undefined}>
      <div className="content">
        {launching ? <LaunchScreen launch={launch} machines={machines} fleet={fleet} notices={<>{localDown && <LocalDownNotice role="status" />}{offline}</>} /> : <>
          <Heading state={state} dispatch={dispatch} attentionCount={sessions.filter(needsAttention).length} onNewSession={canLaunch ? () => openLaunch('heading') : undefined} />
          {localDown && <LocalDownNotice />}
          {offline}
          {(ready || localDown) && sessions.length === 0 && <EmptyWorkspace onNewSession={canLaunch ? () => openLaunch('empty') : undefined} />}
          {sessions.length > 0 && <SplitView selectedId={selected?.id ?? null} panel={panel} onPanel={setPanel}
            list={<>
              {state.view === 'room' && <RoomView sessions={visible} grouping={state.grouping} selected={state.selected} onSelect={pick} onGrouping={grouping => dispatch({ type: 'grouping', grouping })} />}
              {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={pick} attentionOnly={state.attentionOnly} />}
            </>}
            pane={selected ? <ConversationPane session={selected} client={fleetClient} api={conversations} expanded={panel.expanded} onExpand={on => setPanel(p => ({ ...p, expanded: on }))} /> : null} />}
        </>}
        <StatusBar sessions={sessions} machines={machines} />
      </div>
    </main>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState(loadLang);
  return <LangProvider lang={lang}><Shell client={client} /></LangProvider>;
}
