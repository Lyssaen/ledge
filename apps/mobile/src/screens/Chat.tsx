// The Ledge tab (m3-chat.html): the phone's own thread with Ledge. The turns are the PC's; this screen asks, stops, asks again
// and starts over.
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { href } from '../router';
import { useChat, useConversations, useMobile, type MobileStore } from '../state/store';
import { Composer } from '../ui/chat/Composer';
import { TurnView } from '../ui/chat/TurnView';
import { HostPill, LinkStrip } from '../shell/Shell';
import { useAttachments } from '../ui/useAttachments';
import { LePoint } from '../ui/chat/LePoint';
import type { PhoneSession, PhoneTask } from '@ledge/protocol';
import { Icon } from '../ui/icons';
import { Mascot } from '../ui/MobileBot';
import { useWide } from '../ui/layout';
import type { ChatConversationSummary } from '@ledge/protocol';
import { ConversationsSheet, titleOf } from '../ui/chat/Conversations';
import { AnswerRequests, IN_ANSWER_MAX, requestId, SettledLines, sourceIds } from '../ui/chat/InAnswer';
import { requestsOf } from '../model/requests';
import { DetailHeader, kitButtonClass } from '../ui/kit/Controls';
import { iconButtonClass } from '../ui/Button';

/** OpenRig's own rig: its name is not a rig the user asks about. */
const KERNEL = 'kernel';

/**
 * The empty thread's questions (Q32, design-ux 355eade2): who waits, « Résumer la nuit » before noon, then one name from the
 * snapshot, the first rig's or else the first session's. Four at most with « Nouvelle session ».
 */
export function suggestionsOf(sessions: readonly Pick<PhoneSession, 'name' | 'rig'>[], now: Date): string[] {
  const rig = sessions.find(s => s.rig && s.rig.name !== KERNEL)?.rig?.name;
  const name = sessions.find(s => s.name && !s.rig)?.name;
  return [
    copy.chat.suggestions.waiting,
    ...(now.getHours() < 12 ? [copy.chat.suggestions.summarize] : []),
    ...(rig ? [copy.chat.suggestions.rig(rig)] : name ? [copy.chat.suggestions.session(name)] : [])
  ];
}

const HEAD_BUTTON = 'grid size-11 flex-none place-items-center rounded-lg text-muted active:bg-raised disabled:opacity-40';

export function Chat({ store }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const wide = useWide();
  const chat = useChat(store);
  const sessions = [...state.sessions.values()];
  const [text, setText] = useState('');
  const images = useAttachments(store);
  // A question the PC did not take (busy) or that could not leave: shown at the thread's foot, its text back in the field.
  const [refused, setRefused] = useState<{ question: string; note: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const running = chat.live !== null;
  const offline = !state.fresh;
  const conversations = useConversations(store);
  const kept = !!state.daemon?.conversations;
  const [sheet, setSheet] = useState(false);
  // A past conversation open in the tab's place, read-only (§6).
  const [past, setPast] = useState<ChatConversationSummary | null>(null);
  const shownUnder = useRef(new Map<string, Map<string, string>>());

  // « Répondre » on a decision: the start of the question in the field, the caret after it, for the user to finish.
  const field = useRef<HTMLTextAreaElement>(null);
  const [prepared, setPrepared] = useState(0);
  useEffect(() => {
    const el = field.current;
    if (!prepared || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [prepared]);
  const answer = (t: PhoneTask) => {
    setRefused(null);
    setText(copy.chat.point.answerDraft(t.title, t.id, t.giverName ?? copy.chat.point.someone));
    setPrepared(n => n + 1);
  };

  const takenAtSend = useRef<ReturnType<typeof images.clear>>([]);
  useEffect(() => {
    const e = chat.error;
    if (e?.text === undefined) return;
    // Not a newer draft's loss: the question only comes back into an empty field.
    setText(prev => prev || e.text!);
    if (takenAtSend.current.length) { images.putBack(takenAtSend.current); takenAtSend.current = []; }
    // Offline, the composer says why; the others under the question, in the thread (m3-chat.html §3).
    setRefused(e.code === 'offline' ? null : { question: e.text, note: e.code === 'busy' ? copy.chat.busy : copy.chat.failed });
    store.clearChatError();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.error, store]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [chat.turns.length, chat.live?.text, chat.live?.steps.length, refused]);

  const ask = (q: string, ids: string[] = []) => { setRefused(null); store.ask(q, ids); };
  const send = () => {
    const q = text.trim();
    if ((!q && images.items.length === 0) || running || offline || !images.ready) return;
    const ids = images.ids();
    takenAtSend.current = images.clear();
    ask(q, ids);
    setText('');
  };
  const list = sessions.map(x => ({ id: x.id, name: x.name, repo: x.repo, exited: x.state === 'exited', state: x.state, helpers: x.helpers }));
  const reset = () => { setRefused(null); store.resetChat(); };
  // Q30: the requests waiting now in the latest answer's sources; what each answer showed, for « Réglée depuis » once gone.
  const unique = new Map<string, string>();
  const twice = new Set<string>();
  for (const x of sessions) { if (!x.name) continue; if (unique.has(x.name)) twice.add(x.name); else unique.set(x.name, x.id); }
  for (const n of twice) unique.delete(n);
  const waiting = requestsOf(sessions);
  const waitingIds = new Set(waiting.map(requestId));
  const last = chat.turns.at(-1);
  const latest = !running && last?.answer !== undefined ? last : undefined;
  const latestItems = latest ? (() => { const ids = sourceIds(latest.steps, unique); return waiting.filter(i => ids.has(i.sessionId)); })() : [];
  if (latest) {
    const mine = shownUnder.current.get(latest.qid) ?? new Map<string, string>();
    for (const i of latestItems.slice(0, IN_ANSWER_MAX)) mine.set(requestId(i), i.botName);
    shownUnder.current.set(latest.qid, mine);
  }
  const inAnswerOf = (qid: string) => qid === latest?.qid
    ? <AnswerRequests store={store} items={latestItems} />
    : <SettledLines names={[...new Set([...(shownUnder.current.get(qid) ?? [])].filter(([id]) => !waitingIds.has(id)).map(([, n]) => n))]} />;
  const limitsOf = (at: string) => ({ at, usage: state.usage ?? [], alert: state.usageAlert, fresh: state.fresh });
  const openSheet = () => { store.askConversations(); setSheet(true); };

  if (past) {
    const shown = conversations.open[past.id];
    return (
      <>
        <DetailHeader name={titleOf(past, new Date())}
          back={<button type="button" aria-label={copy.nav.backTo.chat} title={copy.nav.backTo.chat} onClick={() => setPast(null)} className={iconButtonClass({ className: 'text-muted' })}><Icon name="back" /></button>} />
        <p className="bleed flex flex-none items-center gap-2 border-b border-line bg-raised px-3.5 py-2 text-small text-muted"><Icon name="clock" className="size-4 flex-none" />{copy.chat.history.pastBanner}</p>
        <main data-tab-scroll="" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain py-3 text-[14px]">
          {shown && 'turns' in shown && shown.turns.map(t => {
            const read = shown.limits.find(r => r.qid === t.qid);
            return <TurnView key={t.qid} store={store} turn={t} list={list} canConfirm={false} live={null} sessions={sessions.length} readOnly limits={read && limitsOf(read.at)} />;
          })}
        </main>
        <div className="flex-none pt-1.5 pb-3"><button type="button" onClick={() => setPast(null)} className={kitButtonClass({ variant: 'primary', className: 'w-full' })}>{copy.chat.history.backToday}</button></div>
      </>
    );
  }

  return (
    <>
      {/* The tab's own head (§1): Ledge and the host, then Nouvelle conversation and, on a phone, Réglages. */}
      <header className="bleed flex h-14 flex-none items-center gap-1 border-b border-line pr-1 pl-3.5">
        <span className="mr-1 flex items-center gap-2 text-[17px] font-semibold">
          <span aria-hidden="true" className="flex size-7 flex-none"><Mascot size={28} frozen={offline} /></span>
          <h1>{copy.chat.title}</h1>
        </span>
        <HostPill />
        <span className="flex-1" />
        <button type="button" onClick={openSheet} aria-haspopup="dialog" aria-label={kept ? copy.chat.history.title : copy.chat.history.today} title={kept ? copy.chat.history.title : copy.chat.history.today} className={HEAD_BUTTON}>
          <Icon name="clock" />
        </button>
        {/* Off while Ledge answers: the answer would be put away half done. */}
        <button type="button" disabled={running} onClick={reset} aria-label={copy.chat.reset} title={copy.chat.reset} className={HEAD_BUTTON}>
          <Icon name="edit" />
        </button>
        {!wide && <a href={href({ name: 'connection' })} aria-label={copy.nav.settings} title={copy.nav.settings} className={HEAD_BUTTON}><Icon name="gear" /></a>}
      </header>
      <main data-tab-scroll="" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain py-3 text-[14px]">
        <LinkStrip />
        {/* The thread opens on « Le point » (ledge home spec §2.4), the suggestions under it; none offline (§3). */}
        {chat.turns.length === 0 && !refused && (
          <div className="flex flex-1 flex-col justify-end gap-2.5">
            <LePoint store={store} sessions={sessions} tasks={state.tasks} syncedAt={state.syncedAt} fresh={state.fresh} onAnswer={answer} {...(state.device?.contextNear !== undefined ? { threshold: state.device.contextNear } : {})} usage={state.usage ?? []} usageAlert={state.usageAlert} />
            {!offline && (
              <div className="flex flex-wrap gap-1.5">
                {/* A question goes at once (Q32); « Nouvelle session » is an action, dashed. */}
                {suggestionsOf(sessions, new Date()).map(s => (
                  <button key={s} type="button" onClick={() => ask(s)} className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-input bg-surface px-3 text-[13px] text-fg">{s}</button>
                ))}
                {state.daemon?.launch && (
                  <a href={href({ name: 'launch' })} className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-dashed border-input px-3 text-[13px] text-muted">
                    <Icon name="plus" className="size-3.5" />{copy.chat.suggestions.newSession}
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {chat.turns.map(t => (
          <div key={t.qid} id={`turn-${t.qid}`} className="contents">
          <TurnView store={store} turn={t} list={list} canConfirm={!!state.device?.confirm} live={chat.live?.qid === t.qid ? chat.live : null} sessions={sessions.length}
            {...(!running && !offline ? { onAskAgain: (q: string) => ask(q) } : {})} limits={chat.limits[t.qid] !== undefined ? limitsOf(chat.limits[t.qid]!) : undefined} inAnswer={inAnswerOf(t.qid)} />
          </div>
        ))}
        {refused && (
          <div className="flex flex-col gap-1.5">
            {refused.question && <div className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-[12px_12px_4px_12px] bg-raised px-3 py-2">{refused.question}</div>}
            <p role="status" className="text-[13.5px] text-attention">{refused.note}</p>
          </div>
        )}
        <div ref={end} />
      </main>
      <Composer value={text} onChange={setText} onSend={send} canSend={(text.trim() !== '' || images.items.length > 0) && images.ready && !running && !offline}
        images={images} running={running} offline={offline} onStop={() => store.cancelAsk()} fieldRef={field} />
      {offline && <p role="status" className="flex-none pb-2 text-[13px] text-attention">{copy.chat.offline}</p>}
      {sheet && (
        <ConversationsSheet conversations={conversations} kept={kept} turns={chat.turns} running={running} now={new Date()}
          onClose={() => setSheet(false)} onReset={() => { setSheet(false); reset(); }}
          onOpen={c => { setSheet(false); store.openConversation(c.id); setPast(c); }}
          onScrollTo={qid => { setSheet(false); document.getElementById(`turn-${qid}`)?.firstElementChild?.scrollIntoView?.({ block: 'start' }); }} />
      )}
    </>
  );
}
