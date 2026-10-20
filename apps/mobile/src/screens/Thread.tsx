import { useEffect, useMemo, useRef, useState } from 'react';
import type { PhoneSession } from '@ledge/protocol';
import { parseReply } from '@ledge/ui/reply/parse';
import { copy } from '../copy';
import { headline } from '../model/requests';
import { composerState, messagesOf, MESSAGE_MAX, QUICK_REPLIES, TAKEN_WINDOW, threadItems, type Composer, type ThreadItem } from '../model/thread';
import { href } from '../router';
import { loadDraft, markCleared, saveDraft, wasCleared } from '../state/drafts';
import { isLive, type Op } from '../state/operations';
import { useMobile, type MobileStore } from '../state/store';
import { useNow } from '../useNow';
import { LinkStatus, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';
import { ReplyView } from '../ui/ReplyView';

const ICON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';

function AgentReply({ text }: { text: string }) {
  const doc = useMemo(() => parseReply(text), [text]);
  return <ReplyView doc={doc} />;
}

const Cut = ({ align }: { align: 'start' | 'end' }) => <div className={`text-[10px] text-muted ${align === 'end' ? 'text-right' : ''}`}>{copy.thread.cut}</div>;

function Bubble({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case 'me': return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[94%] rounded-2xl rounded-br-[4px] bg-[#292d30] p-3.5 text-[13px] [overflow-wrap:anywhere] whitespace-pre-wrap">{item.text}</div>
        {item.cut && <Cut align="end" />}
        {item.delivery && (
          <div role={item.delivery === 'sending' ? 'status' : undefined} className={`text-[10px] ${item.delivery === 'uncertain' ? 'text-attention' : item.delivery === 'sending' ? 'text-muted' : 'text-ok'}`}>
            {item.delivery === 'sending' ? copy.thread.delivery.sending : item.delivery === 'uncertain' ? copy.thread.delivery.uncertain : item.fresh ? copy.thread.delivery.takenNow : copy.thread.delivery.taken}
          </div>
        )}
      </div>
    );
    case 'agent': return (
      <div className="flex flex-col items-start gap-1">
        <article aria-label={copy.thread.agentLabel} className="max-w-[94%] rounded-2xl rounded-bl-[4px] border border-line bg-surface p-3.5 text-[13px] [overflow-wrap:anywhere]">
          <AgentReply text={item.text} />
        </article>
        {item.cut && <Cut align="start" />}
      </div>
    );
    case 'event': return <div className="text-center text-[10px] text-muted">{item.label}</div>;
    case 'awaiting': return (
      <Notice title={copy.thread.awaiting} tone="warning">
        <p className="[overflow-wrap:anywhere]">{headline(item.item)}</p>
        <a href={href({ name: 'request', sessionId: item.item.sessionId, key: item.item.key })} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium">
          {copy.thread.examine}
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </a>
      </Notice>
    );
  }
}

const TONE = { ok: 'text-ok', info: 'text-info', attention: 'text-attention', muted: 'text-muted' } as const;
const C = copy.thread.composer;

function failureOf(o: Op): { title: string; body: string } {
  if (o.phase === 'uncertain' || o.reason === 'not_taken') return { title: C.uncertainTitle, body: C.uncertain };
  const body = o.reason === 'busy' ? C.busy : o.reason === 'invalid' ? C.invalid(MESSAGE_MAX) : o.reason === 'read_only' ? C.readOnly : C.lost;
  return { title: C.failTitle, body };
}

function Footer({ session, composer, draft, onDraft, onSend, fresh, taken, checking, error, onReconnect }: {
  session: PhoneSession; composer: Composer; draft: string; onDraft: (t: string) => void; onSend: () => void; fresh: boolean;
  taken: boolean; checking: boolean; error: { title: string; body: string } | null; onReconnect?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(t);
  }, [busy]);
  const status = taken ? { tone: 'ok' as const, label: C.status.taken } : checking ? { tone: 'muted' as const, label: copy.decide.checking } : composer.status;
  const tooLong = draft.trim().length > MESSAGE_MAX;
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <footer className="flex-none border-t border-line bg-bg px-3.5 pt-2 pb-3 [@media(max-height:650px)]:pb-2">
      <div className={`flex items-center gap-1.5 px-0.5 pb-2 text-[11px] ${TONE[status.tone]}`}><i className="inline-block size-1.5 flex-none rounded-full bg-current" />{status.label}</div>
      {error && (
        <div className="mb-2.5">
          <Notice title={error.title} tone="warning" role="alert">
            <p>{error.body}</p>
            {!fresh && onReconnect && (
              <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
                {busy ? copy.link.reconnecting : C.reconnect}
              </button>
            )}
          </Notice>
        </div>
      )}
      {composer.enabled && (
        <div role="group" aria-label={C.quickLabel} className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
          {QUICK_REPLIES.map(q => (
            <button key={q} type="button" onClick={() => { onDraft(q); ref.current?.focus(); }} className="min-h-11 flex-none rounded-[10px] border border-line px-3 text-xs whitespace-nowrap">{q}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="draft" className="sr-only">{C.label(session.name)}</label>
        <textarea id="draft" ref={ref} rows={1} value={draft} disabled={!composer.enabled} placeholder={composer.placeholder} onChange={e => onDraft(e.target.value)}
          className="max-h-[120px] min-h-12 w-full min-w-0 resize-none rounded-control border border-line bg-surface p-3 text-base leading-[22px] text-fg placeholder:text-muted disabled:opacity-60" />
        <button type="button" disabled={!composer.enabled || !draft.trim() || tooLong} onClick={onSend} aria-label={C.send(session.name)} className="inline-flex size-12 flex-none items-center justify-center rounded-control bg-fg text-[#16181a] disabled:opacity-45">
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
        </button>
      </div>
      {tooLong && <p role="status" className="px-0.5 pt-1.5 text-[11px] text-attention">{C.tooLong(MESSAGE_MAX)}</p>}
    </footer>
  );
}

function BackTo({ label }: { label: string }) {
  return (
    <a href={href({ name: 'agents' })} aria-label={label} className="-ml-2 inline-flex size-11 flex-none items-center justify-center rounded-control">
      <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
    </a>
  );
}

/**
 * One agent's thread: what was said and decided, and a way to give an instruction while the agent is free.
 * Open, the session is watched (the PC pushes its new items) and marked read up to the last item shown.
 */
export function Thread({ store, sessionId, storage, onReconnect }: { store: MobileStore; sessionId: string; storage?: Storage; onReconnect?: () => void }) {
  const state = useMobile(store);
  const now = useNow();
  const session = state.sessions.get(sessionId);
  const thread = state.threads.get(sessionId);
  const { fresh, ops } = state;
  const [draft, setDraft] = useState(() => loadDraft(sessionId, storage));
  const [refused, setRefused] = useState(false);
  const changeDraft = (t: string) => { setDraft(t); saveDraft(sessionId, t, storage); setRefused(false); };

  // The thread is asked once on open; the store asks it again after every reconnection.
  useEffect(() => {
    store.openThread(sessionId);
    return () => store.watch(null);
  }, [store, sessionId]);
  // The PC forgets what a phone watched when the link drops: watched again once the state is fresh.
  useEffect(() => { if (fresh) store.watch(sessionId); }, [store, sessionId, fresh]);

  // The thread's last item, once the PC sent it: it clears the unread mark.
  const latest = thread?.status === 'ready' ? thread.items.at(-1)?.at : undefined;
  useEffect(() => { if (latest) store.read(sessionId, latest); }, [store, sessionId, latest]);

  const last = messagesOf(sessionId, ops).at(-1);
  // The draft goes only when the terminal took it, and only once.
  useEffect(() => {
    if (last?.phase !== 'applied' || wasCleared(last.op, storage)) return;
    markCleared(last.op, storage);
    if (draft.trim() === last.message.text) changeDraft('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.phase, last?.op]);

  // Once the agent shows it is busy after an instruction, that instruction no longer holds the composer shut.
  const [reacted, setReacted] = useState('');
  const sessionState = session?.state;
  useEffect(() => { if (last?.phase === 'applied' && sessionState && sessionState !== 'idle') setReacted(last.op); }, [sessionState, last?.phase, last?.op]);

  const scroller = useRef<HTMLElement>(null);
  const gone = thread?.status === 'gone';
  const items = session && !gone ? threadItems(thread?.items ?? [], session, ops, now, thread?.cut ?? []) : [];
  const end = items.at(-1)?.key;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [end, items.length]);

  if (!session || gone) {
    const waiting = !gone && !fresh && state.syncedAt === null;
    return (
      <>
        <header className="flex-none border-b border-line px-side pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            <BackTo label={copy.thread.back} />
            <span className="min-w-0 flex-1 truncate">{copy.thread.title}</span>
            <LinkStatus link={linkView(state)} />
          </div>
        </header>
        <main className="min-h-0 flex-1 px-side pt-7 text-[13px] text-muted" role="status">{waiting ? copy.thread.loading : copy.thread.unknown}</main>
      </>
    );
  }

  const open = last !== undefined && isLive(last.phase);
  const takenNow = last?.phase === 'applied' && reacted !== last.op && session.state === 'idle' && !session.pending && now - Date.parse(last.at) < TAKEN_WINDOW;
  const composer = composerState(session, fresh ? 'ready' : 'pc_offline', open || takenNow);
  const failed = last && (last.phase === 'rejected' || last.phase === 'failed' || last.phase === 'uncertain')
    && (last.phase === 'uncertain' || draft.trim() === last.message.text) ? failureOf(last) : null;
  const error = refused && !failed ? { title: C.failTitle, body: C.lost } : failed;
  const send = () => {
    const text = draft.trim();
    if (!text || !composer.enabled) return;
    setRefused(!store.reply(sessionId, text));
  };
  const ready = thread?.status === 'ready';

  return (
    <>
      <header className="flex-none border-b border-line px-side pt-2 pb-3">
        <div className="flex items-center gap-2.5">
          <BackTo label={copy.thread.back} />
          <MobileBot tool={session.tool} seed={session.id} state={session.state} frozen={!fresh} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] leading-[1.25] font-semibold tracking-[-.2px] [overflow-wrap:anywhere]">{session.topic ?? session.project}</h1>
            <p className="mt-[3px] text-[11px] text-muted">{session.name} · {copy.tools[session.tool]}</p>
          </div>
          <a href={href({ name: 'terminal', sessionId })} aria-label={copy.thread.terminal(session.name)} className="inline-flex size-11 flex-none items-center justify-center rounded-control border border-line">
            <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 6-6-6-6M12 19h8" /></svg>
          </a>
        </div>
        <p className="mt-2 ml-[46px] text-[11px] [overflow-wrap:anywhere] text-muted">{session.repo ?? session.project}{session.branch && <> · <code className={`font-mono text-[.9em] ${session.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{session.branch}</code></>}</p>
      </header>
      <main ref={scroller} aria-label={copy.thread.log(session.name)} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-side pt-5 pb-4">
        {thread?.more && <p className="text-center text-[11px] text-muted">{copy.thread.more}</p>}
        {!ready && items.length === 0 && <p className="text-center text-[11px] text-muted" role="status">{fresh ? copy.thread.loading : copy.thread.unavailable}</p>}
        {ready && items.length === 0 && <p className="text-center text-[11px] text-muted">{copy.thread.empty}</p>}
        {items.map(it => <Bubble key={it.key} item={it} />)}
      </main>
      <Footer session={session} composer={composer} draft={draft} onDraft={changeDraft} onSend={send} fresh={fresh} taken={takenNow} checking={last?.phase === 'uncertain' && fresh} error={error} onReconnect={onReconnect} />
    </>
  );
}
