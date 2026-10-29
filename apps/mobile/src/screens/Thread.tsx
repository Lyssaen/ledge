import { useEffect, useMemo, useRef, useState } from 'react';
import { parseReply } from '@ledge/ui/reply/parse';
import { copy } from '../copy';
import { headline } from '../model/requests';
import { composerState, messagesOf, TAKEN_WINDOW, threadItems, type ThreadItem } from '../model/thread';
import { href } from '../router';
import { loadDraft, markCleared, saveDraft, wasCleared } from '../state/drafts';
import { isLive } from '../state/operations';
import { useMobile, type MobileStore } from '../state/store';
import { useNow } from '../useNow';
import { BackLink, LinkStatus, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';
import { ReplyView } from '../ui/ReplyView';
import { PhoneThumbs } from '../ui/PhoneThumbs';
import { useAttachments } from '../ui/useAttachments';
import { Checklist } from './Checklist';
import { Reply, replyFailure, replyProblem } from './Reply';
import { SessionModelChip, SessionModelNote, available as modelSwitchable } from './SessionModel';
import { buttonClass, iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';


function AgentReply({ text }: { text: string }) {
  const doc = useMemo(() => parseReply(text), [text]);
  return <ReplyView doc={doc} />;
}

const Cut = ({ align }: { align: 'start' | 'end' }) => <div className={`text-meta text-muted ${align === 'end' ? 'text-right' : ''}`}>{copy.thread.cut}</div>;

function Bubble({ item, store }: { item: ThreadItem; store: MobileStore }) {
  switch (item.kind) {
    case 'me': {
      // The PC's prompt carries refs; this phone's own instruction knows the ones it stored.
      const refs = item.images ?? (item.attachments ?? []).flatMap(id => store.knownImage(id) ?? []);
      return (
      <div className="flex flex-col items-end gap-1">
        {item.text && <div className="max-w-[94%] rounded-2xl rounded-br-[4px] bg-raised p-3.5 text-body [overflow-wrap:anywhere] whitespace-pre-wrap">{item.text}</div>}
        <PhoneThumbs store={store} refs={refs} align="end" />
        {item.cut && <Cut align="end" />}
        {item.delivery && (
          <div role={item.delivery === 'sending' ? 'status' : undefined} className={`text-meta ${item.delivery === 'uncertain' ? 'text-attention' : item.delivery === 'sending' ? 'text-muted' : 'text-ok'}`}>
            {item.delivery === 'sending' ? copy.thread.delivery.sending : item.delivery === 'uncertain' ? copy.thread.delivery.uncertain : item.fresh ? copy.thread.delivery.takenNow : copy.thread.delivery.taken}
          </div>
        )}
      </div>
      );
    }
    case 'agent': return (
      <div className="flex flex-col items-start gap-1">
        <article aria-label={copy.thread.agentLabel} className="max-w-[94%] rounded-2xl rounded-bl-[4px] border border-line bg-surface p-3.5 text-body [overflow-wrap:anywhere]">
          <AgentReply text={item.text} />
        </article>
        {item.cut && <Cut align="start" />}
      </div>
    );
    case 'event': return <div className="text-center text-meta text-muted">{item.label}</div>;
    case 'awaiting': return (
      <Notice title={copy.thread.awaiting} tone={item.item.kind === 'question' ? 'warning' : 'approval'}>
        <p className="[overflow-wrap:anywhere]">{headline(item.item)}</p>
        <a href={href({ name: 'request', sessionId: item.item.sessionId, key: item.item.key })} className={buttonClass({ block: true, className: 'mt-3' })}>
          {copy.thread.examine}
          <Icon name="arrowRight" />
        </a>
      </Notice>
    );
  }
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
  // Chips are not persisted: only the draft text is.
  const images = useAttachments(store);
  // What a send took out of the field, by op id: it comes back if the PC does not take the reply.
  const takenAtSend = useRef(new Map<string, ReturnType<typeof images.clear>>());
  useEffect(() => {
    for (const [op, taken] of takenAtSend.current) {
      const phase = ops[op]?.phase;
      if (phase === 'applied') takenAtSend.current.delete(op);
      else if (phase === 'rejected' || phase === 'failed' || phase === 'uncertain') { takenAtSend.current.delete(op); images.putBack(taken); }
    }
  });
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
        <header className="flex-none border-b border-line pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            <BackLink fallback={{ name: 'agents' }} label={copy.thread.back} />
            <span className="min-w-0 flex-1 truncate">{copy.thread.title}</span>
            <LinkStatus link={linkView(state)} />
          </div>
        </header>
        <main className="min-h-0 flex-1 pt-7 text-body text-muted" role="status">{waiting ? copy.thread.loading : copy.thread.unknown}</main>
      </>
    );
  }

  const open = last !== undefined && isLive(last.phase);
  const takenNow = last?.phase === 'applied' && reacted !== last.op && session.state === 'idle' && !session.pending && now - Date.parse(last.at) < TAKEN_WINDOW;
  const composer = composerState(session, fresh ? 'ready' : 'pc_offline', open || takenNow);
  const failed = last && (last.phase === 'rejected' || last.phase === 'failed' || last.phase === 'uncertain')
    && (last.phase === 'uncertain' || draft.trim() === last.message.text) ? replyFailure(last) : null;
  const error = refused && !failed ? { title: copy.thread.composer.failTitle, body: copy.thread.composer.lost } : failed;
  // A dialog waits: images would not be taken with an answer.
  const dialog = !!session.pending || session.state === 'waiting_input' || session.state === 'waiting_permission';
  const send = () => {
    const text = draft.trim();
    if ((!text && images.items.length === 0) || !composer.enabled || replyProblem(draft) || !images.ready || (images.items.length > 0 && dialog)) return;
    const ids = images.ids();
    const taken = images.clear();
    const sent = store.reply(sessionId, text, ids.length ? { attachments: ids } : {});
    if (!sent && taken.length) images.putBack(taken);
    else if (sent && taken.length) takenAtSend.current.set(sent, taken);
    setRefused(!sent);
  };
  const ready = thread?.status === 'ready';
  // The repository and branch: a line of their own, or after the name on a phone on its side.
  const where = <>{session.repo ?? session.project}{session.branch && <> · <code className={`font-mono text-[.9em] ${session.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{session.branch}</code></>}</>;

  return (
    <>
      <header className="flex-none border-b border-line pt-2 pb-3 phone-side:pt-1 phone-side:pb-2">
        <div className="flex items-center gap-2.5">
          <BackLink fallback={{ name: 'agents' }} label={copy.thread.back} />
          <MobileBot tool={session.tool} seed={session.id} state={session.state} frozen={!fresh} />
          <div className="min-w-0 flex-1">
            <h1 className="text-title leading-[1.25] font-semibold tracking-[-.2px] [overflow-wrap:anywhere] phone-side:truncate phone-side:text-base">{session.topic ?? session.project}</h1>
            <p className="mt-[3px] text-meta text-muted phone-side:truncate">{session.name} · {copy.tools[session.tool]}<span className="hidden phone-side:inline"> · {where}</span></p>
          </div>
          <a href={href({ name: 'terminal', sessionId })} aria-label={copy.thread.terminal(session.name)} className={iconButtonClass({ variant: 'outline' })}>
            <Icon name="terminal" />
          </a>
        </div>
        <p className="mt-2 ml-[46px] text-meta [overflow-wrap:anywhere] text-muted phone-side:hidden">{where}</p>
      </header>
      <main ref={scroller} aria-label={copy.thread.log(session.name)} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain pt-5 pb-4 phone-side:pt-3 phone-side:pb-3">
        {state.daemon?.checklist && state.checklists.get(sessionId) && <Checklist checklist={state.checklists.get(sessionId)!} current={session?.checklist?.current} />}
        {thread?.more && <p className="text-center text-meta text-muted">{copy.thread.more}</p>}
        {!ready && items.length === 0 && <p className="text-center text-meta text-muted" role="status">{fresh ? copy.thread.loading : copy.thread.unavailable}</p>}
        {ready && items.length === 0 && <p className="text-center text-meta text-muted">{copy.thread.empty}</p>}
        {items.map(it => <Bubble key={it.key} item={it} store={store} />)}
      </main>
      <Reply name={session.name} composer={composer} draft={draft} onDraft={changeDraft} onSend={send} fresh={fresh} taken={takenNow} checking={last?.phase === 'uncertain' && fresh} error={error} onReconnect={onReconnect} images={images} dialog={dialog}
        {...(modelSwitchable(state.daemon, session) ? { lead: <SessionModelChip store={store} session={session} />, leadNote: <SessionModelNote store={store} session={session} /> } : {})} />
    </>
  );
}
