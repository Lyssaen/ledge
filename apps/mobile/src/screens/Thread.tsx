import { CONTEXT_NEAR, type PhoneSession } from '@ledge/protocol';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseReply } from '@ledge/ui/reply/parse';
import { copy } from '../copy';
import { headline } from '../model/requests';
import { composerState, messagesOf, TAKEN_WINDOW, threadItems, toolNames, type ThreadItem, type ToolLine } from '../model/thread';
import { cardMode } from '../model/atoi';
import { outcomeFor } from '../model/requestOutcome';
import type { InboxItem } from '../model/requests';
import { dotOf } from '../model/sessions';
import { DetailHeader } from '../ui/kit/Controls';
import { SessionCard } from './atoi/SessionCard';
import { usePlatform } from './device';
import { modelOff, SessionMore } from './SessionMore';
import { href } from '../router';
import { loadDraft, markCleared, saveDraft, takeFocus, wasCleared } from '../state/drafts';
import { isLive } from '../state/operations';
import { useMobile, type MobileStore } from '../state/store';
import { useNow } from '../useNow';
import { footLimit, indicators, tokenCount } from '../model/usage';
import { useWide } from '../ui/layout';
import { physicalKeyboard } from '../ui/MessageField';
import { windowLabel } from '../ui/chat/Limits';
import { BackLink, LinkStatus, linkView } from '../ui/Header';
import { Notice } from '../ui/Notice';
import { ReplyView } from '../ui/ReplyView';
import { RigItem } from '../ui/RigThread';
import { TaskCard } from '../ui/TaskCard';
import { PhoneThumbs } from '../ui/PhoneThumbs';
import { useAttachments } from '../ui/useAttachments';
import { Checklist } from './Checklist';
import { Reply, replyFailure, replyProblem } from './Reply';
import { ChangeSheet, SessionModelChip, SessionModelNote, available as modelSwitchable } from './SessionModel';
import { EndErrorNotice, EndFooter, EndSheet } from './SessionClose';
import { closeHeld, endedAtLabel, endingOf, lastEndOp, resumeHeld } from '../model/sessionEnd';
import { buttonClass, iconButtonClass } from '../ui/Button';
import { Icon } from '../ui/icons';


function AgentReply({ text }: { text: string }) {
  const doc = useMemo(() => parseReply(text), [text]);
  return <ReplyView doc={doc} />;
}

const Cut = ({ align }: { align: 'start' | 'end' }) => <div className={`text-meta text-muted ${align === 'end' ? 'text-right' : ''}`}>{copy.thread.cut}</div>;

const MARK: Record<ToolLine['status'], { glyph: string; tone: string }> = {
  success: { glyph: '✓', tone: 'text-ok' }, running: { glyph: '●', tone: 'text-info' }, failed: { glyph: '✕', tone: 'text-danger-fg' }, unknown: { glyph: '·', tone: 'text-muted' }
};

/** The tools run in a row, folded (m2-sessions.html §3): « 4 outils · Read, Write, Edit, Bash »; open, one line each, the one running in blue. */
function Tools({ tools }: { tools: ToolLine[] }) {
  const [open, setOpen] = useState(false);
  const S = copy.sessions;
  return (
    <div className="rounded-lg border border-line font-mono text-small leading-4 text-muted">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex h-[34px] w-full items-center gap-1.5 px-2.5 text-left font-sans text-[12.5px]">
        <Icon name="chevron" className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 truncate">{open ? S.tools(tools.length) : S.toolsNamed(tools.length, toolNames(tools).join(', '))}</span>
      </button>
      {open && (
        <ul className="pb-2">
          {tools.map(t => (
            <li key={t.id} className="flex gap-1.5 px-2.5 py-[3px]">
              <span aria-label={S.toolStatus[t.status]} role="img" className={MARK[t.status].tone}>{MARK[t.status].glyph}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]"><b className="font-medium text-fg">{t.name}</b> {t.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The request waiting, as « À toi »'s card at the thread's foot (§3, Q19): decided here, « Toujours » where the agent offers it. */
function ThreadRequest({ store, item, onReconnect, keys }: { store: MobileStore; item: InboxItem; onReconnect?: (() => void) | undefined; keys: boolean }) {
  const state = useMobile(store);
  const platform = usePlatform();
  const session = state.sessions.get(item.sessionId);
  return (
    <SessionCard
      store={store} item={item} session={session} inThread keys={keys}
      mode={cardMode(item, state.capabilities?.[item.tool], session?.readOnly === true)}
      outcome={outcomeFor(item, [...state.sessions.values()], state.ops)} fresh={state.fresh} ghost={false}
      changed={false} onReread={() => {}} canConfirm={state.device?.confirm === true && platform} enroll={platform && state.device?.confirm !== true}
      onGone={() => {}} onCheck={onReconnect}
    />
  );
}

/** `inPanel`: in the Atelier's panel, a request opens there, to be decided without leaving the Atelier. */
function Bubble({ item, store, storage, inPanel = false, onReconnect, keys = false }: { item: ThreadItem; store: MobileStore; storage?: Storage | undefined; inPanel?: boolean; onReconnect?: (() => void) | undefined; /** A wide screen: Y / N decide the request at the foot. */ keys?: boolean }) {
  switch (item.kind) {
    case 'tools': return <Tools tools={item.tools} />;
    case 'time': return <div className="text-center font-mono text-meta text-muted">{item.label}</div>;
    case 'rig-message': case 'rig-task': case 'rig-notice': case 'rig-fold': case 'rig-unreadable': case 'rig-raw': return <RigItem e={item} storage={storage} store={store} />;
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
    case 'task': return <TaskCard task={item.task} cut={item.cut} />;
    case 'capture': {
      const first = item.images[0];
      return (
        <div className="flex flex-col items-start gap-1">
          <div className="text-meta text-muted"><span aria-hidden>✓</span> <span>{item.label}</span>{first && <> <span className="font-mono">{first.width}×{first.height}</span></>}</div>
          <PhoneThumbs store={store} refs={item.images} align="start" />
        </div>
      );
    }
    case 'event': return <div className="text-center text-meta text-muted">{item.label}</div>;
    case 'awaiting': return !inPanel ? <ThreadRequest store={store} item={item.item} onReconnect={onReconnect} keys={keys} /> : (
      <Notice title={inPanel ? copy.atelier.awaiting : copy.thread.awaiting} tone={item.item.kind === 'question' ? 'warning' : 'approval'}>
        <p className="[overflow-wrap:anywhere]">{headline(item.item)}</p>
        <a href={href(inPanel ? { name: 'atelier', sessionId: item.item.sessionId, requestKey: item.item.key } : { name: 'request', sessionId: item.item.sessionId, key: item.item.key })} className={buttonClass({ block: true, className: 'mt-3' })}>
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
/** A thread opened in the Atelier's panel (docs/mockups/ledge-ipad-atelier.html, choice A): no « Retour », but « Plein écran » and ×. */
export interface ThreadPanel { onClose(): void }

/** The panel's own buttons: « Plein écran » leads to the thread's screen, × closes the panel. */
function PanelButtons({ sessionId, panel }: { sessionId: string; panel: ThreadPanel }) {
  return (
    <>
      <a href={href({ name: 'thread', sessionId })} aria-label={copy.atelier.fullScreen} title={copy.atelier.fullScreen} className={iconButtonClass({ variant: 'outline' })}><Icon name="external" /></a>
      <button type="button" onClick={panel.onClose} aria-label={copy.atelier.closePanel} title={copy.atelier.closeTitle} className={iconButtonClass({})}><Icon name="close" /></button>
    </>
  );
}

export function Thread({ store, sessionId, storage, onReconnect, panel }: { store: MobileStore; sessionId: string; storage?: Storage; onReconnect?: () => void; panel?: ThreadPanel }) {
  const state = useMobile(store);
  const now = useNow();
  const wide = useWide();
  const session = state.sessions.get(sessionId);
  const thread = state.threads.get(sessionId);
  const { fresh, ops } = state;
  const [draft, setDraft] = useState(() => loadDraft(sessionId, storage));
  // « Répondre » on an OpenRig message brought the person here: the composer takes the focus, after its prefix.
  const [focusOnOpen] = useState(() => takeFocus(sessionId));
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
  // The close or resume sheet; once it sent its operation, the footer that follows it takes the focus.
  const [sheet, setSheet] = useState<'close' | 'resume' | null>(null);
  // « Plus d'actions » (§5), and « Modèle et effort » opened from it or from the foot.
  const [more, setMore] = useState(false);
  const [model, setModel] = useState(false);
  const [sent, setSent] = useState(false);
  // The close or resume whose error was put away: by the next gesture, or by the session changing state.
  const [cleared, setCleared] = useState<string | null>(null);
  const endOp = lastEndOp(sessionId, ops)?.op ?? null;
  const stateNow = useRef(session?.state);
  useEffect(() => {
    if (stateNow.current !== session?.state && stateNow.current !== undefined) setCleared(endOp);
    stateNow.current = session?.state;
  }, [session?.state, endOp]);

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
  const items = session && !gone ? threadItems(thread?.items ?? [], session, ops, now, thread?.cut ?? [], state.sessions, state.device?.id ?? null) : [];
  const end = items.at(-1)?.key;
  // The thread opens at its foot, or where « Terminal » left it (Comportements). It follows what comes while the person reads
  // the foot; scrolled up, nothing moves, and a request arriving is told by « Demande en bas ».
  const atFoot = useRef(true);
  const [below, setBelow] = useState(false);
  const toFoot = () => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; atFoot.current = true; setBelow(false); };
  const shown = useRef(false);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || items.length === 0) return;
    if (!shown.current) {
      shown.current = true;
      const kept = keptScroll.get(sessionId);
      keptScroll.delete(sessionId);
      if (kept !== undefined) { el.scrollTop = kept; atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOOT_SLACK; return; }
    }
    if (atFoot.current) toFoot();
    else if (items.at(-1)?.kind === 'awaiting') setBelow(true);
  // The thread's items too: a reply that grows in place, or a tool joining its folded group, keeps its key and the count.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, items.length, thread?.items]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOOT_SLACK;
    if (atFoot.current) setBelow(false);
  };

  if (!session || gone) {
    const waiting = !gone && !fresh && state.syncedAt === null;
    return (
      <>
        <header className="flex-none border-b border-line pt-2 pb-3">
          <div className="flex items-center gap-2.5">
            {!panel && <BackLink fallback={{ name: 'sessions' }} label={copy.thread.back} />}
            <span className="min-w-0 flex-1 truncate">{copy.thread.title}</span>
            <LinkStatus link={linkView(state)} />
            {panel && <button type="button" onClick={panel.onClose} aria-label={copy.atelier.closePanel} title={copy.atelier.closeTitle} className={iconButtonClass({})}><Icon name="close" /></button>}
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
    setCleared(endOp);
    const ids = images.ids();
    const taken = images.clear();
    const sent = store.reply(sessionId, text, ids.length ? { attachments: ids } : {});
    if (!sent && taken.length) images.putBack(taken);
    else if (sent && taken.length) takenAtSend.current.set(sent, taken);
    setRefused(!sent);
  };
  const ready = thread?.status === 'ready';
  const boot = state.daemon?.boot ?? null;
  const ending = endingOf(session, ops, now, { fresh, boot });
  // A close under way, or one whose outcome is unknown and that goes again by itself once the link is back: a second is refused.
  const shut = closeHeld(session, ops, boot, now);
  // What the PC can do from a phone, for a session Ledge launched: an older PC shows neither Close nor Resume.
  const closable = !!state.daemon?.sessionClose && !session.readOnly;
  const endError = ending.kind === 'open' && ending.error && ending.error.op !== cleared ? ending.error : null;
  const openSheet = (mode: 'close' | 'resume') => { setCleared(endOp); setSent(false); setSheet(mode); };
  // An OMP seat launched by OpenRig has no thread Ledge reads: in the panel, its terminal instead (as on Desktop).
  const omp = !!panel && session.tool === 'omp';
  const dot = dotOf(session);
  const endedAt = session.state === 'exited' && session.exitedAt ? copy.sessions.line.ended(endedAtLabel(session.exitedAt, now)) : undefined;
  // A wide screen's head also says where the session works (§10): its project and its branch.
  const where = wide ? [session.project, session.branch].filter(Boolean).join(' · ') || undefined : undefined;

  return (
    <>
      <DetailHeader
        back={panel ? <span className="w-2.5" /> : <BackLink fallback={{ name: 'sessions' }} label={copy.thread.back} />}
        tool={session.tool} name={session.name} dot={dot} pulse={dot === 'work' && fresh} sub={endedAt ?? where}
        more={<>
          {panel ? <PanelButtons sessionId={sessionId} panel={panel} /> : <ViewToggle sessionId={sessionId} current="thread" onLeave={() => { if (scroller.current) keptScroll.set(sessionId, scroller.current.scrollTop); }} />}
          <button type="button" aria-haspopup="dialog" aria-label={copy.sessions.moreOf(session.name)} title={copy.sessions.more} onClick={() => setMore(true)} className={iconButtonClass({ className: more ? 'bg-raised text-fg' : 'text-muted' })}>
            <Icon name="more" />
          </button>
        </>}
      />
      {omp ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-heading">{copy.atelier.ompNoThread}</h2>
          <p className="max-w-[320px] text-body text-muted">{copy.atelier.ompBody}</p>
          <a href={href({ name: 'terminal', sessionId })} className={buttonClass({ variant: 'primary' })}><Icon name="terminal" />{copy.atelier.ompTerminal}</a>
        </main>
      ) : <>
      <main ref={scroller} onScroll={onScroll} aria-label={copy.thread.log(session.name)} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain pt-5 pb-4 phone-side:pt-3 phone-side:pb-3">
        {state.daemon?.checklist && state.checklists.get(sessionId) && <Checklist checklist={state.checklists.get(sessionId)!} current={session?.checklist?.current} />}
        {thread?.more && <p className="text-center text-meta text-muted">{copy.thread.more}</p>}
        {!ready && items.length === 0 && <p className="text-center text-meta text-muted" role="status">{fresh ? copy.thread.loading : copy.thread.unavailable}</p>}
        {ready && items.length === 0 && <p className="text-center text-meta text-muted">{copy.thread.empty}</p>}
        {items.map(it => <Bubble key={it.key} item={it} store={store} storage={storage} inPanel={!!panel} onReconnect={onReconnect} keys={wide && !panel} />)}
      </main>
      {below && (
        <div className="relative h-0">
          <button type="button" onClick={toFoot} className="absolute bottom-3 left-1/2 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-fg shadow-sm">
            <Icon name="down" className="size-4" />{copy.sessions.requestBelow}
          </button>
        </div>
      )}
      {ending.kind === 'open'
        ? <Reply name={session.name} focusAtEnd={focusOnOpen} composer={wide && physicalKeyboard() ? { ...composer, placeholder: `${composer.placeholder} · ${copy.sessions.keysHint}` } : composer} draft={draft} onDraft={changeDraft} onSend={send} fresh={fresh} taken={takenNow} checking={last?.phase === 'uncertain' && fresh} error={error} onReconnect={onReconnect} images={images} dialog={dialog}
          {...(state.daemon?.commands && session.tool === 'claude' && !session.readOnly ? { slash: { tool: copy.tools[session.tool], listing: state.commands[sessionId], ask: () => store.requestCommands(sessionId) } } : {})}
          alert={endError && <EndErrorNotice error={endError} fresh={fresh} onRetry={() => openSheet('close')} onReconnect={onReconnect} />}
          {...(modelSwitchable(state.daemon, session) ? { lead: <SessionModelChip store={store} session={session} />, leadNote: <SessionModelNote store={store} session={session} /> } : {})} />
        : <EndFooter key={ending.kind} ending={ending.kind === 'ended' && ending.error?.op === cleared ? { ...ending, error: null } : ending} name={session.name} canResume={closable} resumeHeld={resumeHeld(session, ops, boot, now)} readOnly={!!session.readOnly} fresh={fresh} focus={sent} onResume={() => openSheet('resume')} onReconnect={onReconnect} />}
      <SessionFoot store={store} session={session} wide={wide} threshold={state.device?.contextNear ?? CONTEXT_NEAR} onModel={() => setModel(true)} />
      </>}
      {more && <SessionMore store={store} session={session} closable={closable && !omp} closing={shut} onClose={() => setMore(false)}
        onModel={() => { setMore(false); setModel(true); }} onCloseSession={() => { setMore(false); openSheet('close'); }} />}
      {model && modelSwitchable(state.daemon, session) && <ChangeSheet store={store} session={session} onClose={() => setModel(false)} />}
      {sheet && <EndSheet store={store} session={session} mode={sheet} onClose={() => setSheet(null)} onSent={() => { setSent(true); setSheet(null); }} onReconnect={onReconnect} />}
    </>
  );
}

/** Where the thread was left for its terminal, by session: the toggle back finds it there (Comportements). */
const keptScroll = new Map<string, number>();
/** How close to its foot the thread counts as read to the end. */
const FOOT_SLACK = 48;

/** « Fil · Terminal » in a session's head (§3): the two views of one session, each its own screen. */
export function ViewToggle({ sessionId, current, onLeave }: { sessionId: string; current: 'thread' | 'terminal'; /** Before going to the other view: it keeps this one's place. */ onLeave?: () => void }) {
  const V = copy.sessions.view;
  const tab = 'grid h-9 place-items-center px-3.5 text-[13px] font-medium text-muted aria-[current=page]:bg-raised aria-[current=page]:text-fg';
  return (
    <nav aria-label={V.label} className="flex flex-none overflow-hidden rounded-lg border border-input">
      <a href={href({ name: 'thread', sessionId })} onClick={current === 'thread' ? undefined : onLeave} aria-current={current === 'thread' ? 'page' : undefined} className={tab}>{V.thread}</a>
      <a href={href({ name: 'terminal', sessionId })} onClick={current === 'terminal' ? undefined : onLeave} aria-current={current === 'terminal' ? 'page' : undefined} className={tab}>{V.terminal}</a>
    </nav>
  );
}

/**
 * The session's foot (§3, §4): its model (a tap opens « Modèle et effort » when the phone can change it), its context in percent,
 * amber past « Contexte max », and its branch, or its folder without Git. No MR/PR before M5. What is not known is not there.
 */
function SessionFoot({ store, session, wide, threshold, onModel }: { store: MobileStore; session: PhoneSession; wide: boolean; threshold: number; onModel: () => void }) {
  const { daemon, fresh, usage, usageAlert } = useMobile(store);
  const now = useNow();
  const i = indicators(session, now, threshold);
  const S = copy.sessions;
  const can = modelOff(daemon, session) === null;
  // A wide screen's foot adds what the PC knows (Q27): the context in tokens, the project, the tool's limit on the right.
  const limit = wide ? footLimit(session.tool, usage, usageAlert, now, fresh) : null;
  return (
    <footer aria-label={S.foot(session.name)} className="bleed flex h-10 flex-none items-center gap-2.5 border-t border-line bg-sidebar px-3 text-small whitespace-nowrap text-muted">
      {i.model && (can
        ? <button type="button" disabled={!fresh} aria-haspopup="dialog" aria-label={copy.model.chip(i.model)} onClick={onModel} className="inline-flex h-8 items-center gap-1 text-fg disabled:opacity-60">{i.model}<Icon name="down" className="size-3.5" /></button>
        : <span className="text-fg">{i.model}</span>)}
      {i.context && (
        <span role="img" aria-label={S.contextLabel(i.context.pct)} className={`inline-flex items-center gap-1.5 ${i.context.near ? 'text-attention' : ''}`}>
          <span className="relative block h-1 w-8 overflow-hidden rounded-sm bg-raised"><span className="absolute inset-y-0 left-0 bg-current" style={{ width: `${i.context.pct}%` }} /></span>
          {i.context.pct} %
        </span>
      )}
      {wide && session.context && <span>· {tokenCount(session.context.used)} / {tokenCount(session.context.window)}</span>}
      {(i.model || i.context) && <span className="h-3 w-px flex-none bg-line" />}
      {session.branch
        ? <span className={`min-w-0 truncate font-mono text-[11px] ${wide ? '' : 'flex-1'}`}>{session.branch}</span>
        : <span aria-label={S.folder(session.project)} className={`inline-flex min-w-0 items-center gap-1 ${wide ? '' : 'flex-1'}`}><Icon name="folder" className="size-3.5" /><span className="truncate">{session.project}</span></span>}
      {wide && session.branch && <span className="min-w-0 truncate">{session.project}</span>}
      {wide && <span className="flex-1" />}
      {limit && (
        <span className="flex-none">
          {copy.chat.point.harnessShort[limit.harness] ?? limit.harness} {windowLabel(limit.window)}{' '}
          <b className={`font-semibold ${limit.tone === 'red' ? 'text-approval' : limit.tone === 'amber' ? 'text-attention' : 'text-fg'}`}>{limit.window.pct} %</b>
        </span>
      )}
    </footer>
  );
}
