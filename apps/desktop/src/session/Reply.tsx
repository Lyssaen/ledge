import { useEffect, useRef, useState, type ClipboardEvent, type JSX, type KeyboardEvent, type MutableRefObject } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { NOTE_MAX, offers, type Helper, type Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import type { Decisions } from '../fleet/decisions';
import { AttachmentChips } from '@ledge/ui/images';
import { useAttachments } from '../images/useAttachments';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import type { ScreenKeyHandler } from '../nav/screenKeys';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';
import { isNative } from '../term/mode';
import type { SessionMemory } from './memory';
import { SessionModel } from './SessionModel';
import { alwaysScope, isFreeRow, PendingCard, sortOf, type PendingActions } from './PendingCard';

export interface ReplyProps {
  /** The parent on a subagent's page. */
  session: Session; helper: Helper | null;
  /** Who asks: the agent, or the subagent the request comes from. */
  asker: string;
  /** « depuis 12 min » for the request. */
  since: string;
  decisions: Decisions; memory: SessionMemory; memoKey: string;
  notify(text: string): void; dispatch(a: NavAction): void;
  /** Arrived from the List's « Répondre »: the field takes the focus once. */
  focusOnArrival: boolean;
  /** The page's screen keys hand R, Y / N and 1…9 to this. */
  keys: MutableRefObject<ScreenKeyHandler | null>;
  /** The pinned plan's « Lire le plan ». */
  onReadPlan(): void;
  /** For the model chip (#58 lot 2); left out, no chip. */
  client?: DaemonClient;
}

/** The reply area under the thread (session.tsx `replyArea`): the pinned request, then the field, or a note saying why
 *  there is none (offline, read only, a subagent's page). The draft lives in the shell's memory, written at each keystroke. */
export function Reply({ session, helper, asker, since, decisions, memory, memoKey: key, notify, dispatch, focusOnArrival, keys, onReadPlan, client }: ReplyProps): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.pending;
  const tr = t.session.reply;
  const offline = session.offline === true;
  const readOnly = session.source === 'hook_only';
  // Offline, no request; on a subagent's page, only the one it asks (its parent's own is not its business).
  const p = offline ? undefined : session.pending;
  const pending = p && (helper ? p.helperId === helper.id : true) ? p : undefined;
  const sort = pending ? sortOf(pending) : null;
  const canAct = !offline && !readOnly && !helper;
  const busy = decisions.busy(session.id);

  const [draft, setDraftState] = useState(() => memory.get(key).draft);
  const setDraft = (v: string) => { setDraftState(v); memory.set(key, { draft: v }); };
  const input = useRef<HTMLTextAreaElement>(null);
  // Images pasted or dropped on the field: stored on the daemon as they come, sent by id with the reply.
  const images = useAttachments(client, { put: { id: session.id } });
  const withImages = images.items.length > 0;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focusOnArrival) input.current?.focus(); }, []); // once, on arrival

  // What an interrupt that takes back OMP's queue returns: the instructions that were waiting, back in the draft (never re-sent).
  useEffect(() => client?.onMessage(m => {
    if (m.type !== 'session.queue.restored' || m.id !== session.id || !mounted.current) return;
    // The images come back as chips, to be sent again with the text.
    const entries = m.entries ?? m.texts.map(text => ({ text, attachments: undefined }));
    const ids = entries.flatMap(e => e.attachments ?? []);
    if (ids.length || m.imagesDropped) images.restore(ids, m.imagesDropped);
    const back = m.texts.join('\n\n'); if (!back) return;
    const cur = memory.get(key).draft;
    setDraft(cur ? `${cur}\n\n${back}` : back);
  }), [client, session.id, key]);

  const text = draft.trim();
  // A permission, a diff or a plan takes the text as a refusal's note: only where the harness carries one, at most NOTE_MAX.
  const isNote = sort === 'approval' || sort === 'plan';
  const noteless = isNote && !offers(session.tool, pending!.kind, 'note');
  const tooLong = isNote && text.length > NOTE_MAX;
  // A question with options on a harness without free answers (the daemon refuses free text there): the digits only.
  const optionsOnly = sort === 'question' && (pending!.options?.length ?? 0) > 0 && session.tool !== 'claude';
  // OMP's `ask`: its card answers every question at once; the field would answer one blind.
  const askCard = sort === 'question' && !!pending?.questions;
  const shut = noteless || optionsOnly || askCard;
  // OMP is driven over its protocol: what is typed while it works is queued for the turn's end, or redirects the turn now, and
  // « Interrompre » is its own command (spec 2026-10-20 §3.2).
  const native = isNative(session) && !offline;
  const working = native && session.state === 'working' && !pending;
  const stoppable = native && (session.state === 'working' || session.state === 'waiting_input' || session.state === 'waiting_permission');
  // « Arrêter » asked: said in the field until OMP's work stops, then once as a toast (mockup omp-sessions, Interrompre A).
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!stopping || stoppable) return;
    setStopping(false);
    notify(tr.stopped(session.name));
  }, [stopping, stoppable]);
  /** Stops OMP and takes back what waited in its queue, into the draft (abort_and_restore_queue): nothing is left stranded there. */
  const stop = () => {
    if (!client || !stoppable || stopping) return;
    setStopping(true);
    client.send({ type: 'session.interrupt', id: session.id, restoreQueue: true });
  };

  /** A refused send gives its text back, if nothing was written since (the memory holds the draft even once the page closed). */
  const restore = (back: string) => {
    if (memory.get(key).draft !== '') return;
    memory.set(key, { draft: back });
    if (mounted.current) setDraftState(back);
  };
  /** The images go with a reply, never with a decision's note, and not while a dialog waits (the daemon would refuse them). */
  const imagesOk = images.ready && !(withImages && pending);
  /** Sends the text and the ready images; a refusal gives both back (the chips too). */
  const sendReply = (steerNow: boolean) => {
    const attachments = images.ids();
    const taken = images.items.length ? images.clear() : [];
    const back = (t: string) => { restore(t); if (taken.length) images.putBack(taken); };
    if (decisions.reply(session, text, back, { ...(steerNow ? { steer: true } : {}), attachments })) { setDraft(''); return true; }
    if (taken.length) images.putBack(taken);
    return false;
  };
  const steer = () => {
    if ((!text && !withImages) || !canAct || shut || !working || !imagesOk) return;
    sendReply(true);
  };
  const submit = () => {
    if ((!text && !withImages) || !canAct || shut || tooLong || !imagesOk) return;
    if (isNote) { if (decisions.decide(session, 'deny', text, restore)) setDraft(''); }
    else sendReply(false);
  };
  // A plan goes back with what to revise; where the harness takes no note, a plain deny (the field is shut).
  const askRevision = (message: string) => {
    if (noteless) decisions.decide(session, 'deny');
    else { input.current?.focus(); notify(message); }
  };

  const actions: PendingActions | null = pending && canAct ? {
    busy,
    always: sort !== 'question' && offers(session.tool, pending.kind, 'always'),
    alwaysScope: alwaysScope(session.tool, pending),
    decide: d => { decisions.decide(session, d); },
    keepPlanning: () => { if (text && !noteless) submit(); else askRevision(tp.revise); },
    choose: i => { decisions.reply(session, String(i + 1)); },
    ...(sort === 'question' && !shut ? { writeOwn: () => { input.current?.focus(); } } : {}),
    ...(pending.questions ? { answer: (answers: ReadonlyArray<{ id: string; selected: string[]; text?: string }>, cancel?: boolean) => { decisions.answer(session, answers, cancel); } } : {})
  } : null;

  // R, Y / N and 1…9 (never while typing: useKeys); none offline, read only or on a subagent's page.
  const onScreenKey: ScreenKeyHandler = e => {
    if (!canAct || e.key === 'Escape') return false;
    const k = e.key.toLowerCase();
    if (k === 'r') {
      if (!input.current || input.current.disabled) return false;
      input.current.focus();
      return true;
    }
    if (!pending) return false;
    // A held key repeats: once the first press lands, the next request would take the repeats. Only a new press decides.
    if (e.repeat && (k === 'y' || k === 'n' || /^[1-9]$/.test(k))) return false;
    if (sort === 'approval' && (k === 'y' || k === 'n')) { decisions.decide(session, k === 'y' ? 'accept' : 'deny'); return true; }
    if (sort === 'plan' && (k === 'y' || k === 'n')) {
      if (k === 'y') decisions.decide(session, 'accept'); else askRevision(tp.reviseKey);
      return true;
    }
    const option = /^[1-9]$/.test(k) ? pending.options?.[Number(k) - 1] : undefined;
    if (sort === 'question' && option !== undefined && !isFreeRow(option)) { decisions.reply(session, k); return true; }
    return false;
  };
  useEffect(() => { keys.current = onScreenKey; });
  useEffect(() => () => { keys.current = null; }, [keys]);

  /** Pasted image files become chips; a text paste is left alone. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (!client || files.length === 0) return;
    e.preventDefault(); images.add(files);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // While OMP works, Ctrl / ⌘ Enter redirects the turn now; Enter alone queues the text for the turn's end.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && working && (text || withImages)) { e.preventDefault(); steer(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    // Escape stops OMP at work when nothing is typed; otherwise it leaves the field and keeps the draft (navigation never sees it).
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (stoppable && !text && client) stop(); else e.currentTarget.blur();
    }
  };

  const name = session.name;
  const placeholder = working ? tr.placeholder.queued(name) : sort === 'plan' ? tr.placeholder.plan : sort === 'approval' ? tr.placeholder.approval : sort === 'question' ? tr.placeholder.question(name)
    : session.state === 'exited' || session.state === 'idle' ? tr.placeholder.done(name) : tr.placeholder.idle(name);
  const hint = stopping ? tr.stopping
    : withImages && pending ? t.images.dialog
    : working && text ? <><Kbd>↵</Kbd> {tr.whenQueued} · <Kbd>Ctrl ↵</Kbd> {tr.whenNow}</>
    : stoppable && client && !askCard ? <><Kbd>{tr.escKey}</Kbd> {tr.stopKey}</>
    : askCard ? tr.askCard : optionsOnly ? tr.optionsOnly : noteless ? tr.noNote : tooLong ? tr.tooLong(NOTE_MAX)
    : sort === 'approval' && text ? tr.denyHint : sort === 'plan' && text ? tr.planHint : <><Kbd>R</Kbd> {tr.write}</>;

  return (
    <div className="reply-area session-reply">
      {pending && <PendingCard pending={pending} asker={asker} since={since} actions={actions} relay={helper ? session.name : null} onReadPlan={onReadPlan} />}
      {offline ? (
        <div className="reply-note offline">
          <Icon d={SHELL_ICONS.offline} size={15} />
          <span><strong>{tr.offline(machineOf(session))}</strong>{tr.offlineBody}</span>
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'settings', section: 'machines' })}>{tr.seeMachine}</Button>
        </div>
      ) : readOnly ? (
        <div className="reply-note"><span>{tr.readOnly}</span></div>
      ) : helper ? (
        <div className="reply-note">
          <SessionBot session={session} size={22} />
          <span>{tr.viaParent(helper.kind, session.name)}</span>
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'open', id: session.id })}>{tr.openParent(session.name)}</Button>
        </div>
      ) : (
        <>
        {native && (session.queue?.length ?? 0) > 0 && (
          <div className="reply-queue" role="region" aria-label={tr.queueLabel}>
            <div className="reply-queue-head">
              <Icon d={SHELL_ICONS.clock} size={14} />
              <strong>{tr.queueTitle(session.queue!.length)}</strong><span className="muted">· {tr.queueOrder}</span>
              {client && <Button variant="ghost" size="sm" type="button" onClick={stop} title={tr.restoreTitle}>{tr.queueTakeBack}</Button>}
            </div>
            <ul>{session.queue!.map((q, i) => (
              <li key={i} title={q.text}><span className={cls('queue-tag', q.mode === 'steer' && 'now')}>{q.mode === 'steer' ? tr.queueNow : tr.queueLater}</span><span className="queue-text">{q.text}</span></li>
            ))}</ul>
          </div>
        )}
        <form className={cls(pending && 'with-pending', (session.queue?.length ?? 0) > 0 && native && 'under-queue')} onSubmit={e => { e.preventDefault(); submit(); }}
          onDragOver={client ? e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); } : undefined}
          onDrop={client ? e => { if (e.dataTransfer.files.length === 0) return; e.preventDefault(); images.add([...e.dataTransfer.files]); } : undefined}>
          {withImages && <div className="reply-chips"><AttachmentChips items={images.items} onRemove={images.remove} size={{ w: 72, h: 54 }} removeLabel={t.images.remove} lang={t.time.locale.startsWith('fr') ? 'fr' : 'en'} /></div>}
          <textarea ref={input} rows={1} aria-label={tr.label} placeholder={placeholder} value={draft} disabled={shut}
            maxLength={isNote ? NOTE_MAX : undefined} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />
          {images.error && <span className="reply-hint reply-images-error" role="alert">{images.error}</span>}
          {client && <SessionModel client={client} session={session} notify={notify} />}
          <span className="reply-hint">{hint}</span>
          {stoppable && client && !text && !askCard
            ? <Button variant="primary" size="icon" type="button" className="reply-stop" onClick={stop} disabled={stopping} aria-label={stopping ? tr.stopping : tr.stop(session.name)} title={tr.stopTitle}
                style={{ width: 32, height: 32 }}>{stopping ? <span className="reply-stop-spin" aria-hidden="true" /> : <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" /></svg>}</Button>
            : <Button variant="primary" size="icon" type="submit" aria-label={sort === 'approval' ? tr.denyWith : working ? tr.queue : tr.send}
                disabled={(!text && !withImages) || shut || tooLong || busy || !imagesOk} style={{ width: 32, height: 32 }}><Icon d={ICONS.send.d} /></Button>}
        </form>
        </>
      )}
    </div>
  );
}
