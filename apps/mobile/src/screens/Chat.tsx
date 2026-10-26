// « Demander à Ledge »: the phone's own thread with Ledge. The turns are the PC's; this screen only asks, stops and starts over.
import { useEffect, useRef, useState } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
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

  useEffect(() => {
    const e = chat.error;
    if (e?.text === undefined) return;
    // Not a newer draft's loss: the question only comes back into an empty field.
    setText(prev => prev || e.text!);
    setRefused(e.code === 'busy' ? copy.chat.busy : e.code === 'offline' ? copy.chat.offline : copy.chat.failed);
    store.clearChatError();
  }, [chat.error, store]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [chat.turns.length, chat.live?.text, chat.live?.steps.length]);

  const send = () => {
    const q = text.trim();
    if ((!q && images.items.length === 0) || running || offline || !images.ready) return;
    setRefused(null);
    const ids = images.ids();
    images.clear();
    store.ask(q, ids);
    setText('');
  };
  const note = refused ?? (offline ? copy.chat.offline : null);

  return (
    <>
      <header className="flex flex-none items-center gap-3 border-b border-line pt-3 pb-3">
        <div aria-hidden="true" className="flex-none"><ResidentMascot size={36} theme="dark" frozen={offline} /></div>
        <div className="min-w-0 flex-1">
          <LinkStatus link={linkView(state)} />
          <h1 className="text-xl leading-[26px] font-bold tracking-[-0.4px]">{copy.chat.title}<span className="text-danger-fg">.</span></h1>
          <p className="text-xs text-muted">{teams ? copy.chat.operator(sessions.length, teams.length) : copy.chat.subtitle(sessions.length, repos.size)}</p>
        </div>
        <button
          type="button" disabled={running} onClick={() => { setRefused(null); store.resetChat(); }}
          aria-label={copy.chat.reset} title={copy.chat.reset}
          className="grid size-11 flex-none place-items-center rounded-control disabled:opacity-40"
        >
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.38 2.62a2.12 2.12 0 1 1 3 3L12.36 14.64a2 2 0 0 1-.85.51l-2.87.84.84-2.87a2 2 0 0 1 .5-.85z" /></svg>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-4">
        {chat.turns.length === 0 && teams && (
          <div className="flex flex-1 flex-col justify-end gap-3">
            <LePoint store={store} sessions={sessions} teams={teams} tasks={state.tasks} syncedAt={state.syncedAt} fresh={state.fresh} {...(state.device?.contextNear !== undefined ? { threshold: state.device.contextNear } : {})} />
            <div className="flex flex-wrap gap-2">
              {teamSuggestions(teams).map(s => (
                <button key={s} type="button" onClick={() => setText(s)} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium">{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.turns.length === 0 && !teams && (
          <div className="flex flex-1 flex-col justify-end gap-2.5">
            <p className="mb-1.5 text-muted">{copy.chat.empty}</p>
            {suggestionsOf(sessions).map(s => (
              <button key={s} type="button" onClick={() => setText(s)} className="flex min-h-12 w-full items-center rounded-xl border border-line bg-surface px-3.5 text-left text-sm font-medium">{s}</button>
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
