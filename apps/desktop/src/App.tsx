import { useEffect, useState } from 'react';
import { groupSessions } from '@ledge/fleet';
import { LangProvider, loadLang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { needsAttention, visibleSessions } from './fleet/attention';
import { useViewState } from './state/useViewState';
import { Heading } from './shell/Heading';
import { TeamView } from './team/TeamView';

function Shell() {
  const [state, dispatch] = useViewState();
  const { sessions, machines } = useFleet();
  // A machine is `ready` once it has delivered a fresh snapshot; the fleet publishes empty ones before that, so the daemon store's snapshot count would not do.
  const ready = machines.some(m => m.ready);
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

export function App() {
  const [lang] = useState(loadLang);
  return <LangProvider lang={lang}><Shell /></LangProvider>;
}
