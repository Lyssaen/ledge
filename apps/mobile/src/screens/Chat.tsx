// « Demander à Ledge »: the phone's own thread with Ledge. The turns are the PC's; this screen only asks, stops and starts over.
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { useChat, useMobile, type MobileStore } from '../state/store';
import { Composer } from '../ui/chat/Composer';
import { TurnView } from '../ui/chat/TurnView';
import { LinkStatus, linkView } from '../ui/Header';
import { TabBar } from '../ui/TabBar';
import { requestsOf } from '../model/requests';

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
  // A refusal for load: the screen says so (the store has already forgotten it) and the question is back in the field.
  const [refused, setRefused] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const running = chat.live !== null;
  const offline = !state.fresh;

  useEffect(() => {
    if (chat.error?.code !== 'busy') return;
    setText(chat.error.text ?? '');
    setRefused(true);
    store.clearChatError();
  }, [chat.error, store]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [chat.turns.length, chat.live?.text, chat.live?.steps.length]);

  const send = () => {
    const q = text.trim();
    if (!q || running || offline) return;
    setRefused(false);
    store.ask(q);
    setText('');
  };
  const note = refused ? copy.chat.busy : offline ? copy.chat.offline : null;

  return (
    <>
      <header className="flex flex-none items-center gap-3 border-b border-line pt-3 pb-3">
        <div className="min-w-0 flex-1">
          <LinkStatus link={linkView(state)} />
          <h1 className="text-xl leading-[26px] font-bold tracking-[-0.4px]">{copy.chat.title}<span className="text-danger-fg">.</span></h1>
          <p className="text-xs text-muted">{copy.chat.subtitle(sessions.length, repos.size)}</p>
        </div>
        <button
          type="button" disabled={running} onClick={() => { setRefused(false); store.resetChat(); }}
          aria-label={copy.chat.reset} title={copy.chat.reset}
          className="grid size-11 flex-none place-items-center rounded-control disabled:opacity-40"
        >
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.38 2.62a2.12 2.12 0 1 1 3 3L12.36 14.64a2 2 0 0 1-.85.51l-2.87.84.84-2.87a2 2 0 0 1 .5-.85z" /></svg>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain py-4">
        {chat.turns.length === 0 && (
          <div className="flex flex-1 flex-col justify-end gap-2.5">
            <p className="mb-1.5 text-muted">{copy.chat.empty}</p>
            {suggestionsOf(sessions).map(s => (
              <button key={s} type="button" onClick={() => setText(s)} className="flex min-h-12 w-full items-center rounded-xl border border-line bg-surface px-3.5 text-left text-sm font-medium">{s}</button>
            ))}
          </div>
        )}
        {chat.turns.map(t => (
          <TurnView key={t.qid} turn={t} live={chat.live?.qid === t.qid ? chat.live : null} sessions={sessions.length} onStop={() => store.cancelAsk()} />
        ))}
        <div ref={end} />
      </main>
      {note && <p role="status" className="flex-none pb-2 text-[13px] text-attention">{note}</p>}
      <Composer value={text} onChange={setText} onSend={send} canSend={text.trim() !== '' && !running && !offline} />
      <TabBar count={requestsOf(sessions).length} active="chat" chat />
    </>
  );
}
