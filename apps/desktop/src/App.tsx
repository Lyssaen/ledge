import { useEffect, useRef, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { groupSessions } from '@ledge/fleet';
import { LangProvider, loadLang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { needsAttention, visibleSessions } from './fleet/attention';
import { useViewState } from './state/useViewState';
import { Heading } from './shell/Heading';
import { TeamView } from './team/TeamView';

function Shell({ client }: { client?: DaemonClient }) {
  const [state, dispatch] = useViewState();
  const { sessions, machines, fleet } = useFleet(client);
  // Open once, for good: the daemon has sent its machine list (it follows the first snapshot; until then only local is known), some machine has delivered a snapshot and every machine has settled (ready, or unreachable after its
  // first attempt). The fleet publishes empty snapshots earlier, and local can be ready before a remote's first one, so
  // pruning sooner would drop a persisted remote selection. With every machine down nothing is known, so nothing is pruned.
  const opened = useRef(false);
  if (!opened.current && fleet.machinesSource() === 'daemon' && machines.some(m => m.ready) && machines.every(m => m.ready || m.status === 'unreachable')) opened.current = true;
  const ready = opened.current;
  const visible = visibleSessions(sessions, state.attentionOnly);
  const shown = groupSessions(visible).flatMap(g => g.sessions);
  // The ids the screen lists, in display order. Held back until a machine has delivered its first snapshot: before it `sessions` is [] and the
  // selection restored from storage would be wiped (spec §9.1).
  const key = shown.map(s => s.id).join('\n');
  useEffect(() => { if (ready) dispatch({ type: 'visible', ids: key ? key.split('\n') : [] }); }, [ready, key, dispatch]);
  return (
    <main className="app">
      <div className="content">
        <Heading state={state} dispatch={dispatch} attentionCount={sessions.filter(needsAttention).length} />
        {state.view === 'team' && <TeamView sessions={visible} selected={state.selected} onSelect={id => dispatch({ type: 'select', id })} attentionOnly={state.attentionOnly} />}
      </div>
    </main>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState(loadLang);
  return <LangProvider lang={lang}><Shell client={client} /></LangProvider>;
}
