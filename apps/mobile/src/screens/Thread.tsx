import { useEffect, useRef, useState } from 'react';
import type { Session } from '@ledge/protocol';
import { copy } from '../copy';
import { newOperationId } from '../model/operations';
import { composerState, messagesOf, QUICK_REPLIES, MESSAGE_MAX, threadItems, type Composer, type ThreadItem } from '../model/thread';
import { headline } from '../model/requests';
import { href } from '../router';
import { loadDraft, saveDraft } from '../state/drafts';
import { mobileStore, useMobile, type Link } from '../state/store';
import { LinkStatus } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';
import { ReplyView } from '../ui/ReplyView';
import { useNow } from '../useNow';

const ICON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';
/** Instructions whose draft was already cleared: a text typed again later is a new draft. */
const cleared = new Set<string>();
/** How long a taken instruction keeps the composer closed while the agent has not yet shown it is working. */
const TAKEN_WINDOW = 20_000;

function Bubble({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case 'me': return (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[94%] rounded-2xl rounded-br-[4px] bg-[#292d30] p-3.5 text-[13px] [overflow-wrap:anywhere] whitespace-pre-wrap">{item.text}</div>
        {item.delivery && (
          <div role={item.delivery === 'sending' ? 'status' : undefined} className={`text-[10px] ${item.delivery === 'uncertain' ? 'text-attention' : item.delivery === 'sending' ? 'text-muted' : 'text-ok'}`}>
            {item.delivery === 'sending' ? copy.thread.delivery.sending : item.delivery === 'uncertain' ? copy.thread.delivery.uncertain : item.fresh ? copy.thread.delivery.takenNow : copy.thread.delivery.taken}
          </div>
        )}
      </div>
    );
    case 'agent': return (
      <article aria-label={copy.thread.agentLabel} className="max-w-[94%] rounded-2xl rounded-bl-[4px] border border-line bg-surface p-3.5 text-[13px] [overflow-wrap:anywhere]">
        <ReplyView doc={item.doc} />
      </article>
    );
    case 'event': return <div className="text-center text-[10px] text-muted">{item.label}</div>;
    case 'awaiting': return (
      <Notice title={copy.thread.awaiting} tone="warning">
        <p className="[overflow-wrap:anywhere]">{headline(item.item)}</p>
        <a href={href({ name: 'request', sessionId: item.item.sessionId, pendingId: item.item.pendingId })} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium">
          {copy.thread.examine}
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </a>
      </Notice>
    );
  }
}

const TONE = { ok: 'text-ok', info: 'text-info', attention: 'text-attention', muted: 'text-muted' } as const;

function failureOf(phase: string, reason: string | undefined): { title: string; body: string } {
  if (phase === 'uncertain' || reason === 'not_taken') return { title: copy.thread.composer.uncertainTitle, body: copy.thread.composer.uncertain };
  const c = copy.thread.composer;
  const body = reason === 'agent_busy' ? c.busy : reason === 'invalid' ? c.invalid : reason === 'read_only' ? c.readOnly : reason === 'forbidden' ? c.forbidden : c.lost;
  return { title: c.failTitle, body };
}

function Footer({ session, composer, draft, onDraft, onSend, link, taken, error, onReconnect }: {
  session: Session; composer: Composer; draft: string; onDraft: (t: string) => void; onSend: () => void; link: Link;
  taken: boolean; error: { title: string; body: string } | null; onReconnect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(t);
  }, [busy]);
  const status = taken ? { tone: 'ok' as const, label: copy.thread.composer.status.taken } : composer.status;
  const tooLong = draft.trim().length > MESSAGE_MAX;
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <footer className="flex-none border-t border-line bg-bg px-3.5 pt-2 pb-3 [@media(max-height:650px)]:pb-2">
      <div className={`flex items-center gap-1.5 px-0.5 pb-2 text-[11px] ${TONE[status.tone]}`}><i className="inline-block size-1.5 flex-none rounded-full bg-current" />{status.label}</div>
      {error && (
        <div className="mb-2.5">
          <Notice title={error.title} tone="warning" role="alert">
            <p>{error.body}</p>
            {link !== 'online' && (
              <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-2 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
                {busy ? copy.link.reconnecting : copy.thread.composer.reconnect}
              </button>
            )}
          </Notice>
        </div>
      )}
      {composer.enabled && (
        <div role="group" aria-label={copy.thread.composer.quickLabel} className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
          {QUICK_REPLIES.map(q => (
            <button key={q} type="button" onClick={() => { onDraft(q); ref.current?.focus(); }} className="min-h-11 flex-none rounded-[10px] border border-line px-3 text-xs whitespace-nowrap">{q}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor="draft" className="sr-only">{copy.thread.composer.label(session.name)}</label>
        <textarea id="draft" ref={ref} rows={1} value={draft} disabled={!composer.enabled} placeholder={composer.placeholder} onChange={e => onDraft(e.target.value)}
          className="max-h-[120px] min-h-12 w-full min-w-0 resize-none rounded-control border border-line bg-surface p-3 text-base leading-[22px] text-fg placeholder:text-muted disabled:opacity-60" />
        <button type="button" disabled={!composer.enabled || !draft.trim() || tooLong} onClick={onSend} aria-label={copy.thread.composer.send(session.name)} className="inline-flex size-12 flex-none items-center justify-center rounded-control bg-fg text-[#16181a] disabled:opacity-45">
          <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
        </button>
      </div>
      {tooLong && <p role="status" className="px-0.5 pt-1.5 text-[11px] text-attention">{copy.thread.composer.tooLong(MESSAGE_MAX)}</p>}
    </footer>
  );
}

/** One agent's thread: what was said and decided, and a way to give an instruction while the agent is free. */
export function Thread({ sessionId, onReconnect }: { sessionId: string; onReconnect: () => void }) {
  const { sessions, turns, ops, link, syncedAt } = useMobile();
  const now = useNow();
  const session = sessions.find(s => s.id === sessionId);
  const mine = turns[sessionId];
  const [draft, setDraft] = useState(() => loadDraft(sessionId));
  const changeDraft = (t: string) => { setDraft(t); saveDraft(sessionId, t); };

  // The thread is asked for on open, after every reconnection and whenever the session changes: no turn is pushed.
  useEffect(() => {
    if (link === 'online' && session) mobileStore.send({ type: 'session.history', id: sessionId });
  }, [sessionId, link, session]);

  // The latest turn shown, once: it clears the unread mark.
  const lastRead = useRef('');
  const latest = mine?.reduce<string>((a, t) => Date.parse(t.at) > Date.parse(a || '1970-01-01T00:00:00Z') ? t.at : a, '') ?? '';
  useEffect(() => {
    if (link !== 'online' || !latest || latest === lastRead.current) return;
    if (mobileStore.send({ type: 'session.read', id: sessionId, at: latest })) lastRead.current = latest;
  }, [sessionId, link, latest]);

  const sent = messagesOf(sessionId, ops);
  const last = sent[sent.length - 1];
  // The draft goes only when the terminal took it, and only once.
  useEffect(() => {
    if (last?.phase !== 'applied' || cleared.has(last.operationId)) return;
    cleared.add(last.operationId);
    if (draft.trim() === last.text) changeDraft('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.phase, last?.operationId]);

  const scroller = useRef<HTMLElement>(null);
  const items = session ? threadItems(mine ?? [], session, ops) : [];
  const end = items[items.length - 1]?.key;
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [end, items.length]);

  if (!session) {
    return (
      <>
        <header className="flex-none border-b border-line px-side pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            <a href={href({ name: 'agents' })} aria-label={copy.thread.back} className="-ml-2 inline-flex size-11 flex-none items-center justify-center rounded-control"><svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></a>
            <span className="min-w-0 flex-1 truncate">{copy.thread.title}</span>
            <LinkStatus />
          </div>
        </header>
        <main className="min-h-0 flex-1 px-side pt-7 text-[13px] text-muted" role="status">{link === 'connecting' || (syncedAt === null && link !== 'offline') ? copy.thread.loading : copy.thread.unknown}</main>
      </>
    );
  }

  const open = last?.phase === 'sending' || last?.phase === 'received' || last?.phase === 'uncertain';
  const takenNow = last?.phase === 'applied' && session.state === 'idle' && !session.pending && now - Date.parse(last.startedAt) < TAKEN_WINDOW;
  const composer = composerState(session, link, open || takenNow);
  const failed = last && (last.phase === 'rejected' || last.phase === 'failed' || last.phase === 'unknown' || last.phase === 'uncertain')
    && (last.phase === 'uncertain' || draft.trim() !== '') ? failureOf(last.phase, last.reason) : null;
  const send = () => {
    const text = draft.trim();
    if (!text || !composer.enabled) return;
    const operationId = newOperationId();
    mobileStore.submit({ operationId, sessionId, kind: 'message', text, phase: 'sending', startedAt: new Date().toISOString() }, { type: 'session.reply', id: sessionId, text, operationId });
  };

  return (
    <>
      <header className="flex-none border-b border-line px-side pt-2 pb-3">
        <div className="flex items-center gap-2.5">
          <a href={href({ name: 'agents' })} aria-label={copy.thread.back} className="-ml-2 inline-flex size-11 flex-none items-center justify-center rounded-control"><svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></a>
          <MobileBot tool={session.tool} seed={session.name} />
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
        {mine === undefined && items.length === 0 && <p className="text-center text-[11px] text-muted" role="status">{link === 'online' ? copy.thread.loading : copy.thread.empty}</p>}
        {mine !== undefined && items.length === 0 && <p className="text-center text-[11px] text-muted">{copy.thread.empty}</p>}
        {items.map(it => <Bubble key={it.key} item={it} />)}
      </main>
      <Footer session={session} composer={composer} draft={draft} onDraft={changeDraft} onSend={send} link={link} taken={takenNow} error={failed} onReconnect={onReconnect} />
    </>
  );
}
