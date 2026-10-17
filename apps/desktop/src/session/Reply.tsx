import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MutableRefObject } from 'react';
import { NOTE_MAX, offers, type Helper, type Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import type { Decisions } from '../fleet/decisions';
import { useI18n } from '../i18n/lang';
import { machineOf } from '../nav/agents';
import type { ScreenKeyHandler } from '../nav/screenKeys';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot } from '../shell/SessionBot';
import type { SessionMemory } from './memory';
import { alwaysScope, PendingCard, sortOf, type PendingActions } from './PendingCard';

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
}

/** The reply area under the thread (session.tsx `replyArea`): the pinned request, then the field, or a note saying why
 *  there is none (offline, read only, a subagent's page). The draft lives in the shell's memory, written at each keystroke. */
export function Reply({ session, helper, asker, since, decisions, memory, memoKey: key, notify, dispatch, focusOnArrival, keys }: ReplyProps): JSX.Element {
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
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focusOnArrival) input.current?.focus(); }, []); // once, on arrival

  const text = draft.trim();
  // A permission, a diff or a plan takes the text as a refusal's note: only where the harness carries one, at most NOTE_MAX.
  const isNote = sort === 'approval' || sort === 'plan';
  const noteless = isNote && !offers(session.tool, pending!.kind, 'note');
  const tooLong = isNote && text.length > NOTE_MAX;
  // A question with options on a harness without free answers (the daemon refuses free text there): the digits only.
  const optionsOnly = sort === 'question' && (pending!.options?.length ?? 0) > 0 && session.tool !== 'claude';
  const shut = noteless || optionsOnly;

  /** A refused send gives its text back, if nothing was written since (the memory holds the draft even once the page closed). */
  const restore = (back: string) => {
    if (memory.get(key).draft !== '') return;
    memory.set(key, { draft: back });
    if (mounted.current) setDraftState(back);
  };
  const submit = () => {
    if (!text || !canAct || shut || tooLong) return;
    const sent = isNote ? decisions.decide(session, 'deny', text, restore) : decisions.reply(session, text, restore);
    if (sent) setDraft('');
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
    choose: i => { decisions.reply(session, String(i + 1)); }
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
    if (sort === 'question' && /^[1-9]$/.test(k) && pending.options?.[Number(k) - 1] !== undefined) { decisions.reply(session, k); return true; }
    return false;
  };
  useEffect(() => { keys.current = onScreenKey; });
  useEffect(() => () => { keys.current = null; }, [keys]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    // Escape leaves the field and keeps the draft; the page stays (navigation never sees it).
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); }
  };

  const name = session.name;
  const placeholder = sort === 'plan' ? tr.placeholder.plan : sort === 'approval' ? tr.placeholder.approval : sort === 'question' ? tr.placeholder.question(name)
    : session.state === 'exited' || session.state === 'idle' ? tr.placeholder.done(name) : tr.placeholder.idle(name);
  const hint = optionsOnly ? tr.optionsOnly : noteless ? tr.noNote : tooLong ? tr.tooLong(NOTE_MAX)
    : sort === 'approval' && text ? tr.denyHint : sort === 'plan' && text ? tr.planHint : <><Kbd>R</Kbd> {tr.write}</>;

  return (
    <div className="reply-area session-reply">
      {pending && <PendingCard pending={pending} asker={asker} since={since} actions={actions} relay={helper ? session.name : null} />}
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
        <form className={cls(pending && 'with-pending')} onSubmit={e => { e.preventDefault(); submit(); }}>
          <textarea ref={input} rows={1} aria-label={tr.label} placeholder={placeholder} value={draft} disabled={shut}
            maxLength={isNote ? NOTE_MAX : undefined} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} />
          <span className="reply-hint">{hint}</span>
          <Button variant="primary" size="icon" type="submit" aria-label={sort === 'approval' ? tr.denyWith : tr.send}
            disabled={!text || shut || tooLong || busy} style={{ width: 32, height: 32 }}><Icon d={ICONS.send.d} /></Button>
        </form>
      )}
    </div>
  );
}
