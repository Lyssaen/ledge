// « Demander à Ledge »: the phone's own thread with Ledge. The turns are the PC's; this screen only asks, stops and starts over.
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { useChat, useMobile, type MobileStore } from '../state/store';
import { Composer } from '../ui/chat/Composer';
import { TurnView } from '../ui/chat/TurnView';
import { LinkStatus, linkView } from '../ui/Header';
import { TabBar } from '../ui/TabBar';
import { requestsOf } from '../model/requests';
import { closedTasks } from '../model/teams';
import { useAttachments } from '../ui/useAttachments';
import { LePoint } from '../ui/teams/LePoint';
import type { PhoneTeam } from '@ledge/protocol';
import { chipClass, iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Mascot } from '../ui/MobileBot';

/** With teams, the operator's: « Monte une équipe… » and where the first active team is at. */
function teamSuggestions(teams: PhoneTeam[]): string[] {
  const first = teams.find(t => t.state === 'active');
  return [copy.chat.suggestions.team, ...(first ? [copy.chat.suggestions.teamWhere(first.name)] : [])];
}

/** The suggestions: the first needs nothing, the others a real session and a real repo of the snapshot. */
function suggestionsOf(sessions: { name: string; repo?: string }[]): string[] {
  const name = sessions.find(s => s.name)?.name;
  const repo = sessions.find(s => s.repo)?.repo;
  return [
    copy.chat.suggestions.waiting,
    ...(name ? [copy.chat.suggestions.session(name)] : []),
    ...(repo ? [copy.chat.suggestions.repo(repo)] : [])
  ];
}

export function Chat({ store }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const chat = useChat(store);
  const sessions = [...state.sessions.values()];
  const repos = new Set(sessions.map(s => s.repo).filter(Boolean));
  const [text, setText] = useState('');
  const images = useAttachments(store);
  // A refusal for load: the screen says so (the store has already forgotten it) and the question is back in the field.
  const [refused, setRefused] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const running = chat.live !== null;
  const offline = !state.fresh;
  // A PC that knows teams: Ledge is the operator, and the thread opens on « Le point » (ledge home spec §2.4).
  const teams = state.teams;

  const takenAtSend = useRef<ReturnType<typeof images.clear>>([]);
  useEffect(() => {
    const e = chat.error;
    if (e?.text === undefined) return;
    // Not a newer draft's loss: the question only comes back into an empty field.
    setText(prev => prev || e.text!);
    if (takenAtSend.current.length) { images.putBack(takenAtSend.current); takenAtSend.current = []; }
    setRefused(e.code === 'busy' ? copy.chat.busy : e.code === 'offline' ? copy.chat.offline : copy.chat.failed);
    store.clearChatError();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.error, store]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [chat.turns.length, chat.live?.text, chat.live?.steps.length]);

  const send = () => {
    const q = text.trim();
    if ((!q && images.items.length === 0) || running || offline || !images.ready) return;
    setRefused(null);
    const ids = images.ids();
    const taken = images.clear();
    takenAtSend.current = taken;
    store.ask(q, ids);
    setText('');
  };
  const note = refused ?? (offline ? copy.chat.offline : null);

  return (
    <>
      <header className="flex flex-none items-center gap-3 border-b border-line pt-3 pb-3">
        <div aria-hidden="true" className="flex-none"><Mascot size={36} frozen={offline} /></div>
        <div className="min-w-0 flex-1">
          <LinkStatus link={linkView(state)} />
          <h1 className="text-xl leading-[26px] font-bold tracking-[-0.4px]">{copy.chat.title}<span className="text-primary">.</span></h1>
          <p className="text-xs text-muted">{teams ? copy.chat.operator(sessions.length, teams.length) : copy.chat.subtitle(sessions.length, repos.size)}</p>
        </div>
        <button
          type="button" disabled={running} onClick={() => { setRefused(null); store.resetChat(); }}
          aria-label={copy.chat.reset} title={copy.chat.reset}
          className={iconButtonClass()}
        >
          <Icon name="edit" stroke={1.5} />
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-4">
        {chat.turns.length === 0 && teams && (
          <div className="flex flex-1 flex-col justify-end gap-3">
            <LePoint store={store} sessions={sessions} teams={teams} tasks={state.tasks} syncedAt={state.syncedAt} fresh={state.fresh} {...(state.device?.contextNear !== undefined ? { threshold: state.device.contextNear } : {})} />
            <div className="flex flex-wrap gap-2">
              {teamSuggestions(teams).map(s => (
                <button key={s} type="button" onClick={() => setText(s)} className={chipClass()}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.turns.length === 0 && !teams && (
          <div className="flex flex-1 flex-col justify-end gap-2.5">
            <p className="mb-1.5 text-muted">{copy.chat.empty}</p>
            {suggestionsOf(sessions).map(s => (
              <button key={s} type="button" onClick={() => setText(s)} className={`${chipClass()} self-start py-2 text-left`}>{s}</button>
            ))}
          </div>
        )}
        {chat.turns.map(t => (
          <TurnView key={t.qid} store={store} turn={t} list={sessions.map(x => ({ id: x.id, name: x.name, repo: x.repo, exited: x.state === 'exited' }))} canConfirm={!!state.device?.confirm} live={chat.live?.qid === t.qid ? chat.live : null} sessions={sessions.length} onStop={() => store.cancelAsk()} />
        ))}
        <div ref={end} />
      </main>
      {note && <p role="status" className="flex-none pb-2 text-[13px] text-attention">{note}</p>}
      <Composer value={text} onChange={setText} onSend={send} canSend={(text.trim() !== '' || images.items.length > 0) && images.ready && !running && !offline} images={images} attachDisabled={running || offline} />
      <TabBar count={requestsOf(sessions).length + closedTasks(state.tasks.values()).length} active="chat" chat />
    </>
  );
}
