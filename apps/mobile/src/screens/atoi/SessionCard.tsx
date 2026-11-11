import { useRef, useState } from 'react';
import type { PhoneSession } from '@ledge/protocol';
import { copy } from '../../copy';
import { alwaysLabel, alwaysScope, type CardMode } from '../../model/atoi';
import { consequenceFor } from '../../model/consequence';
import { checkFreeAnswer, OTHER_MAX } from '../../model/freeAnswer';
import type { Outcome } from '../../model/requestOutcome';
import { ageLabel, headline, type InboxItem } from '../../model/requests';
import { clock } from '../Inbox';
import { href } from '../../router';
import type { MobileStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { Card } from '../../ui/kit/Box';
import { kitButtonClass, RequestCode } from '../../ui/kit/Controls';
import { Dot, Pill, RuntimeTag } from '../../ui/kit/marks';
import { isApple } from '../device';
import { useDeviceCheck, type CheckProblem } from './check';
import { Leaving, Receipt } from './Receipt';
import { useShortcuts } from '../../ui/keys';
import { useWide } from '../../ui/layout';

/** What was tapped last on this card: the button that turns while it goes, and what « Réessayer » sends again. */
type Sent = { kind: 'decide'; decision: 'accept' | 'deny' | 'always' } | { kind: 'reply'; text: string; label: string };

/** Longer than this, or on more lines, a command or a question is clamped to three lines with « Tout lire » (§11). */
const LONG = 150;
const isLong = (t: string) => t.length > LONG || t.split('\n').length > 3;

export const Spin = () => <svg className="size-4 flex-none motion-safe:animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>;

export interface SessionCardProps {
  store: MobileStore;
  item: InboxItem;
  session: PhoneSession | undefined;
  mode: CardMode;
  outcome: Outcome;
  /** The PC's state now: offline, the card is read, nothing is sent. */
  fresh: boolean;
  /** Gone from the PC's list: only its receipt can show. */
  ghost: boolean;
  /** The request was replaced while on screen (same session, other content): read again before deciding (§6). */
  changed: boolean;
  onReread: () => void;
  /** This device can sign the PC's challenge (a passkey here, and the PC asks it); `enroll`: it could, once protected. */
  canConfirm: boolean;
  enroll: boolean;
  /** The receipt left (5 s), or there is nothing to show. */
  onGone: () => void;
  onCheck?: (() => void) | undefined;
  /** The one opened beside the list (a wide screen). */
  selected?: boolean;
  /** At the foot of its session's thread (m2-sessions.html §3): the head says what is asked, not who asks. */
  inThread?: boolean;
  /** A wide screen's thread (m2-sessions.html §10): Y allows, N refuses, and the head says so in the age's place. */
  keys?: boolean;
}

/**
 * A session's request as a card of « À toi » (m1-a-toi.html §1, §3 to §6, §11): who asks and where, what is asked, the answers
 * that decide it here, then, once decided, a one-line receipt in its place. A tap on its head or its text opens it in full.
 */
export function SessionCard(p: SessionCardProps) {
  const { store, item, mode, outcome, fresh, ghost, changed, canConfirm, enroll, onGone, selected = false, inThread = false, keys = false } = p;
  const [sent, setSent] = useState<Sent | null>(null);
  const [refused, setRefused] = useState(false);
  const [otherOpen, setOtherOpen] = useState(mode.kind === 'question' && mode.options.length === 0 && mode.other);
  const [draft, setDraft] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<CheckProblem | null>(null);
  const check = useDeviceCheck(store);
  // In a wide screen's thread the three answers share one line (m2-sessions.html §10); on a phone « Toujours » goes under them (§3).
  const wide = useWide();
  const oneRow = inThread && wide;
  const R = copy.atoi.receipt;
  const bot = item.botName;
  const kindWord = copy.atoi.pill[item.kind];
  const open = href({ name: 'request', sessionId: item.sessionId, key: item.key });
  // Y / N, while the card shows its two buttons enabled (set below, once the card knows it).
  const shortcut = useRef<((key: string) => boolean) | null>(null);
  const keyed = keys && mode.kind === 'permission';
  useShortcuts(keyed, k => shortcut.current?.(k) ?? false);
  // A receipt in the card's place takes no key.
  shortcut.current = null;

  // ── What it became ──
  if (outcome.kind === 'applied') {
    const thread = { label: R.thread, href: href({ name: 'thread', sessionId: item.sessionId }) };
    const r = outcome.answer !== undefined
      ? <Receipt tone="ok" title={R.answered(outcome.answer.length > 40 ? `${outcome.answer.slice(0, 40)}…` : outcome.answer, bot)} />
      : outcome.decision === 'deny'
        ? <Receipt tone="denied" title={R.denied(bot)} body={R.deniedBody} action={thread} />
        : <Receipt tone="ok" title={R.allowed(bot)} body={R.allowedBody} action={thread} />;
    return <Leaving onGone={onGone}>{r}</Leaving>;
  }
  if (outcome.kind === 'uncertain') {
    return <Receipt tone="warn" title={copy.decide.uncertain} body={R.uncertainBody} {...(p.onCheck ? { action: { label: R.check, onClick: p.onCheck } } : {})} />;
  }
  if (outcome.kind === 'handledElsewhere' || (ghost && outcome.kind === 'idle')) {
    // Offline, nothing is said handled: the last known state only lost it.
    if (!fresh) { onGoneSoon(onGone); return null; }
    const last = p.session?.lastAnswer;
    const recorded = last && last.key === item.key;
    const where = !recorded ? null : last.by.kind === 'pc' ? copy.thread.event.fromPc : last.by.id === store.getState().device?.id ? copy.thread.event.fromHere : copy.thread.event.fromDevice(last.by.name);
    const typed = draft.trim() !== '';
    const body = !recorded ? R.gone(bot, typed) : last.decision ? R.decidedAt(bot, last.decision, clock(last.at)) : R.answeredAt(bot, clock(last.at), typed);
    return <Leaving onGone={onGone}><Receipt tone="gone" title={where ? copy.gone.titleOn(where) : copy.gone.titleElsewhere} body={body} /></Leaving>;
  }
  const failed = refused || outcome.kind === 'failed' || (outcome.kind === 'rejected' && !['not_taken', 'stale', 'confirm_required', 'assertion_expired', 'assertion_invalid', 'free_text', 'invalid', 'untypable', 'read_only', 'no_prompt', 'nothing_to_decide'].includes(outcome.reason));
  if (failed && !ghost) {
    const again = sent;
    return <Receipt tone="fail" title={copy.decide.failed} body={R.what(bot, kindWord)}
      action={again && fresh ? { label: R.retry, onClick: () => { setRefused(false); send(again); } } : { label: copy.inbox.examine, href: open }} />;
  }
  if (ghost) { onGoneSoon(onGone); return null; }

  // ── The card ──
  const sending = outcome.kind === 'sending';
  const live = fresh && !changed && !sending && !checking;
  // The request this card shows, named in every answer: a newer one that took its place on the PC is never decided by this tap.
  const expect = { key: item.key, kind: item.kind, text: item.text };
  const send = (s: Sent) => {
    setSent(s); setProblem(null);
    const op = s.kind === 'decide' ? store.decide(item.sessionId, s.decision, { expect }) : store.reply(item.sessionId, s.text, { expect });
    setRefused(op === null);
  };
  const confirmAccept = async () => {
    if (!live) return;
    setChecking(true); setProblem(null);
    const signed = await check({ purpose: 'decide', id: item.sessionId, expect });
    setChecking(false);
    if (typeof signed === 'string') { setProblem(signed); return; }
    // The gesture took a while: only the request it was signed for may be accepted with it.
    if (store.getState().sessions.get(item.sessionId)?.pending?.key !== item.key) return;
    setSent({ kind: 'decide', decision: 'accept' });
    setRefused(store.decide(item.sessionId, 'accept', { assertion: signed, expect }) === null);
  };
  shortcut.current = keyed && live ? k => {
    const key = k.toLowerCase();
    if (key === 'y') { send({ kind: 'decide', decision: 'accept' }); return true; }
    if (key === 'n') { send({ kind: 'decide', decision: 'deny' }); return true; }
    return false;
  } : null;
  const turning = (s: Sent) => sending && sent !== null && JSON.stringify(sent) === JSON.stringify(s);
  const free = checkFreeAnswer(draft);
  const sendFree = () => { if (live && free.problem === null) send({ kind: 'reply', text: free.text, label: free.text }); };

  const rejectedWhy = outcome.kind === 'rejected'
    ? outcome.reason === 'not_taken' ? copy.decide.notTaken
      : outcome.reason === 'free_text' ? copy.decide.otherUnsupported
        : outcome.reason === 'invalid' ? (item.kind === 'question' ? copy.decide.otherInvalid : copy.decide.failed)
          : outcome.reason === 'untypable' ? copy.question.untypable
            : outcome.reason === 'read_only' ? copy.decide.readOnly
              : outcome.reason === 'no_prompt' || outcome.reason === 'nothing_to_decide' ? copy.decide.noPrompt
                : outcome.reason === 'assertion_expired' ? copy.confirm.expired
                  : outcome.reason === 'assertion_invalid' ? copy.confirm.failed
                    : null
    : null;
  const high = mode.kind === 'high';
  const consequence = high ? consequenceFor(item) : null;
  const text = item.kind === 'permission' ? (item.body ?? item.text) : headline(item);
  const where = [item.repo, item.branch].filter(Boolean).join(' · ');
  const btn = (variant: 'primary' | 'outline' = 'outline', extra = '') => kitButtonClass({ variant, className: `min-w-0 ${extra}` });

  const head = inThread ? (
    <a href={open} className="-m-1 flex min-w-0 items-center gap-[7px] rounded-md p-1 active:bg-raised">
      <Dot state={item.kind === 'question' ? 'ask' : item.kind === 'permission' ? 'perm' : 'work'} />
      <b className="min-w-0 truncate font-semibold">{item.kind === 'permission' ? copy.atoi.line.permission : kindWord}</b>
      <span className="flex-1" />
      <span className="font-mono text-small whitespace-nowrap text-muted">{keyed ? copy.atoi.keys : ageLabel(item.since, Date.now())}</span>
      {high && <Pill tone="risk">{copy.risk.badge}</Pill>}
    </a>
  ) : (
    <a href={open} className="-m-1 flex min-w-0 items-center gap-[7px] rounded-md p-1 active:bg-raised">
      <RuntimeTag tool={item.tool} />
      <b className="font-semibold whitespace-nowrap">{bot}</b>
      {where && <span className="min-w-0 truncate text-small text-muted">{where}</span>}
      <span className="flex-1" />
      <span className="font-mono text-small whitespace-nowrap text-muted">{ageLabel(item.since, Date.now())}</span>
      {high ? <Pill tone="risk">{copy.risk.badge}</Pill> : <Pill tone={item.kind === 'question' ? 'ask' : item.kind === 'permission' ? 'perm' : 'plain'}>{kindWord}</Pill>}
    </a>
  );
  const long = isLong(text);
  const body = item.kind === 'permission'
    ? <a href={open} className="block"><RequestCode>{long ? text.split('\n').slice(0, 3).join('\n').slice(0, LONG) + '…' : text}</RequestCode></a>
    : <a href={open} className={`block text-body [overflow-wrap:anywhere] ${item.kind === 'question' ? '' : 'font-semibold'} ${long ? 'line-clamp-3' : ''}`}>{text}</a>;

  const hint = (t: string, err = false) => <p className={`text-small [overflow-wrap:anywhere] ${err ? 'text-destructive' : 'text-muted'}`} role={err ? 'alert' : undefined}>{t}</p>;
  const problemText = problem === 'cancelled' ? copy.confirm.cancelled : problem === 'prepareFailed' ? copy.confirm.prepareFailed : problem === 'failed' ? copy.confirm.failed : null;

  const controls = (() => {
    switch (mode.kind) {
      case 'examine':
        return <a href={open} className={kitButtonClass({ size: 'sm', className: 'self-start' })}>{copy.inbox.examine}<Icon name="chevron" className="size-4" /></a>;
      case 'readOnly':
        return hint(copy.decide.readOnly);
      case 'answerOnPc':
        return hint(copy.decide.answerOnPc);
      case 'permission':
        return oneRow ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'accept' })} className={btn('primary', 'min-w-[140px]')}>{turning({ kind: 'decide', decision: 'accept' }) && <Spin />}{copy.atoi.allow}</button>
            <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'deny' })} className={btn('outline', 'min-w-[120px]')}>{turning({ kind: 'decide', decision: 'deny' }) && <Spin />}{copy.atoi.deny}</button>
            {mode.always && <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'always' })} className={kitButtonClass({ variant: 'ghost' })}>{turning({ kind: 'decide', decision: 'always' }) && <Spin />}{alwaysLabel(alwaysScope(item))}</button>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'accept' })} className={btn('primary')}>{turning({ kind: 'decide', decision: 'accept' }) && <Spin />}{copy.atoi.allow}</button>
              <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'deny' })} className={btn()}>{turning({ kind: 'decide', decision: 'deny' }) && <Spin />}{copy.atoi.deny}</button>
            </div>
            {mode.always && <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'always' })} className={kitButtonClass({ variant: 'ghost', className: '-mt-1 self-stretch' })}>{turning({ kind: 'decide', decision: 'always' }) && <Spin />}{alwaysLabel(alwaysScope(item))}</button>}
          </>
        );
      case 'high':
        return canConfirm ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={!live} onClick={() => { void confirmAccept(); }} className={btn('primary')}>
                {checking || turning({ kind: 'decide', decision: 'accept' }) ? <Spin /> : <Icon name="face" className="size-[18px]" />}
                <span className="truncate">{checking ? copy.confirm.checking : isApple() ? copy.confirm.goApple : copy.confirm.go}</span>
              </button>
              <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'deny' })} className={btn()}>{turning({ kind: 'decide', decision: 'deny' }) && <Spin />}{copy.atoi.deny}</button>
            </div>
            {checking && hint(copy.confirm.askingNote)}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled className={btn()}>{copy.decide.onPc}</button>
              <button type="button" disabled={!live} onClick={() => send({ kind: 'decide', decision: 'deny' })} className={btn()}>{turning({ kind: 'decide', decision: 'deny' }) && <Spin />}{copy.atoi.deny}</button>
            </div>
            {hint(copy.decide.onPcHint)}
            {enroll && <a href={href({ name: 'connection', section: 'link' })} className="self-start text-small font-medium underline underline-offset-2">{copy.enroll.link}</a>}
          </>
        );
      case 'question': {
        const fieldId = `free-${item.sessionId}`;
        const showProblem = free.problem !== null && free.problem !== 'empty';
        return (
          <>
            {mode.options.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mode.options.map((o, i) => {
                  const s: Sent = { kind: 'reply', text: String(i + 1), label: o };
                  return <button key={`${i}:${o}`} type="button" disabled={!live} onClick={() => send(s)} className={kitButtonClass({ className: 'h-auto min-h-11 max-w-full py-2 text-left whitespace-normal [overflow-wrap:anywhere]' })}>{turning(s) && <Spin />}{o}</button>;
                })}
              </div>
            )}
            {mode.other && !otherOpen && mode.options.length > 0 && (
              <button type="button" disabled={!live} onClick={() => setOtherOpen(true)} className="self-start text-[13px] font-medium text-muted underline-offset-2 hover:underline disabled:opacity-45">{copy.atoi.other}</button>
            )}
            {mode.other && otherOpen && (
              <div className="flex flex-col gap-1.5">
                <div className={`flex items-center gap-2 rounded-[10px] border bg-surface py-[5px] pr-[5px] pl-3 focus-within:border-ring ${showProblem ? 'border-destructive' : 'border-input'}`}>
                  <label htmlFor={fieldId} className="sr-only">{copy.question.fieldLabel(bot)}</label>
                  <input
                    id={fieldId} value={draft} onChange={e => setDraft(e.target.value)} placeholder={copy.question.placeholder} autoComplete="off" enterKeyHint="send"
                    aria-invalid={showProblem} disabled={!fresh || changed}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); sendFree(); } }}
                    className="h-[34px] min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-muted"
                  />
                  <button type="button" aria-label={copy.decide.send} title={copy.decide.send} disabled={!live || free.problem !== null} onClick={sendFree} className="grid size-9 flex-none place-items-center rounded-lg bg-primary text-primary-fg disabled:opacity-40">
                    {sent?.kind === 'reply' && sending && sent.text === free.text ? <Spin /> : <Icon name="send" className="size-[18px]" />}
                  </button>
                </div>
                {showProblem
                  ? hint(free.problem === 'long' ? copy.question.long(OTHER_MAX) : free.problem === 'digit' ? copy.question.digit : copy.question.untypable, true)
                  : hint(copy.atoi.sendHint(bot))}
              </div>
            )}
            {!mode.other && mode.options.length > 0 && hint(copy.decide.otherUnsupported)}
          </>
        );
      }
    }
  })();

  const kindName = high ? copy.atoi.kindName.permission : copy.atoi.kindName[item.kind];
  return (
    <Card tone={item.kind === 'question' ? 'ask' : item.kind === 'permission' ? 'perm' : 'plain'} selected={selected} label={copy.atoi.region(kindName, bot, item.repo)}>
      {head}
      {rejectedWhy && hint(rejectedWhy, true)}
      {changed && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-attention/45 px-2.5 py-2 text-small">
          <Icon name="alert" className="mt-px size-4 text-attention" />{copy.decide.changed}
        </div>
      )}
      {body}
      {long && <a href={open} className="-mt-1 self-start text-[13px] font-medium underline-offset-2 hover:underline">{copy.atoi.readAll}</a>}
      {consequence && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-small">
          <Icon name="alert" className="mt-px size-4 text-destructive" />
          <div className="flex flex-col"><b className="font-semibold">{consequence.title}</b><span className="text-muted">{consequence.body}</span></div>
        </div>
      )}
      {changed && <button type="button" onClick={p.onReread} className={kitButtonClass()}>{copy.decide.reread}</button>}
      {problemText && hint(problemText, true)}
      {controls}
      {sending && hint(copy.decide.sending)}
    </Card>
  );
}

/** A card with nothing to show lets its place go after this render. */
function onGoneSoon(onGone: () => void) { queueMicrotask(onGone); }
