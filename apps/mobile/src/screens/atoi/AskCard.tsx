import { useState } from 'react';
import type { HumanAnswer, HumanAsk } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import { answerLabel, answerText, pillOf, whoOf, type AskEnd } from '../../model/atoi';
import { href } from '../../router';
import type { MobileStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { Card } from '../../ui/kit/Box';
import { kitButtonClass } from '../../ui/kit/Controls';
import { Pill } from '../../ui/kit/marks';
import { isApple } from '../device';
import { useDeviceCheck, type CheckProblem } from './check';
import { Leaving, Receipt } from './Receipt';
import { Spin } from './SessionCard';

/**
 * An option's button (refonte.css `.btn.opt`, 7aa3ec6e): the text, the spinner and « recommandé » on one line, the badge on the
 * right; the text wraps under itself, never under the badge.
 */
export const optClass = (primary: boolean) => kitButtonClass({
  variant: primary ? 'primary' : 'outline',
  className: 'h-auto min-h-11 w-full justify-start gap-2 px-3 py-2.5 text-left leading-[19px] whitespace-normal [overflow-wrap:anywhere]'
});

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

export interface AskCardProps {
  store: MobileStore;
  ask: HumanAsk;
  end: AskEnd;
  fresh: boolean;
  ghost: boolean;
  /** This device can sign an answer (Q63); `enroll`: it could, once its accepts are protected (Q64). */
  canConfirm: boolean;
  enroll: boolean;
  onGone: () => void;
  /** The ask in full (§2): its whole text, its source and « Détails »; in the list, three lines and « Tout lire ». */
  full?: boolean;
  selected?: boolean;
}

/**
 * What a rig asks the person, as a card (m1-a-toi.html §2, m1-reponses-rig.html): who, the summary, the text, then the answer
 * (a button per option, the recommended first; « Répondre autrement… »; « Répondre… » on a row parked on the person; « Vu » on a
 * piece of news). Every answer but « Vu » is confirmed with the device (Q63): without that, the card says where to answer (Q64).
 */
export function AskCard({ store, ask, end, fresh, ghost, canConfirm, enroll, onGone, full = false, selected = false }: AskCardProps) {
  const A = copy.asks;
  const R = copy.atoi.receipt;
  const check = useDeviceCheck(store);
  const pill = pillOf(ask);
  const who = whoOf(ask);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [turning, setTurning] = useState<string | null>(null);
  const [problem, setProblem] = useState<CheckProblem | 'notSent' | null>(null);
  const [details, setDetails] = useState(false);
  // The answer this card sent last: what « Réessayer » sends again (its own check included).
  const [last, setLast] = useState<{ key: string; answer: HumanAnswer } | null>(null);
  const open = href({ name: 'ask', id: ask.id });

  const go = async (key: string, answer: HumanAnswer) => {
    setTurning(key); setProblem(null); setLast({ key, answer });
    let assertion;
    if (answer.kind !== 'seen') {
      const signed = await check({ purpose: 'rig', qitem: ask.id, answer });
      if (typeof signed === 'string') { setTurning(null); setProblem(signed); return; }
      assertion = signed;
    }
    const op = store.answerAsk(ask.id, answer, assertion ? { assertion } : {});
    // From here the op says where the answer stands (`end`): the card is free for the next question, or for « Réessayer ».
    setTurning(null);
    if (op === null) { setProblem('notSent'); return; }
    if (answer.kind === 'words' || answer.kind === 'resolve') setComposing(false);
  };

  // ── What it became ──
  const what = R.what(who.name, A.pill[pill]);
  if (end.kind === 'sent') {
    const said = answerText(ask, end.answer);
    const r = end.answer.kind === 'seen'
      ? <Receipt tone="ok" title={R.seen} body={R.what(who.name, ask.summary)} />
      : <Receipt tone="ok" title={R.sentTo(who.name)} body={[who.role, said ? `« ${said.length > 60 ? `${said.slice(0, 60)}…` : said} »` : ''].filter(Boolean).join(' · ')} />;
    return <Leaving onGone={onGone}>{r}</Leaving>;
  }
  if (end.kind === 'already' || (ghost && end.kind !== 'failed' && end.kind !== 'uncertain')) {
    if (!fresh && ghost && end.kind !== 'already') { queueMicrotask(onGone); return null; }
    return <Leaving onGone={onGone}><Receipt tone="gone" title={A.already} body={R.what(who.name, ask.summary)} /></Leaving>;
  }
  const retry = (a: HumanAnswer) => { void go(last?.key ?? 'retry', a); };
  if (end.kind === 'uncertain') {
    // It may have arrived. An operation the PC never answered goes again as itself, so the PC replays its end; one the PC
    // answered « uncertain » (OpenRig's reply was lost) is answered again, which OpenRig records once and says so.
    return <Receipt tone="warn" title={copy.decide.uncertain} body={A.uncertain} action={{ label: A.retry, onClick: () => { if (!store.resendAsk(ask.id)) retry(end.answer); }, disabled: !fresh || turning !== null }} />;
  }
  if (end.kind === 'failed') {
    const why = end.error === 'openrig_stopped' ? A.stopped : end.error === 'unreachable' ? A.unreachable : end.message ?? end.error;
    return <Receipt tone="fail" title={A.notSent(why)} body={what} action={{ label: A.retry, onClick: () => retry(end.answer), disabled: !fresh || turning !== null }} />;
  }

  // ── The card ──
  const sending = end.kind === 'sending' || turning !== null;
  const live = fresh && !sending;
  const needsCheck = pill !== 'update';
  const answerable = live && (canConfirm || !needsCheck);
  const spin = (key: string) => (turning === key || (end.kind === 'sending' && last?.key === key) ? <Spin /> : null);
  const several = ask.questions.length > 1;
  const answered = ask.questions.filter(q => answerLabel(ask, q.id) !== null || (end.kind === 'recorded' && end.answer.kind === 'choice' && end.answer.questionId === q.id)).length;
  const body = ask.bodyTruncated && ask.body === ask.summary ? '' : ask.body;
  const urgent = ask.priority === 'routine' ? null : A.priority[ask.priority];
  const hint = (t: string, err = false) => <p className={`text-small [overflow-wrap:anywhere] ${err ? 'text-destructive' : 'text-muted'}`} role={err ? 'alert' : undefined}>{t}</p>;
  const apple = isApple();
  const sendLabel = needsCheck ? (apple ? A.sendCheck : A.sendDevice) : A.send;

  const options = (q: HumanAsk['questions'][number]) => {
    const chosen = answerLabel(ask, q.id) ?? (end.kind === 'recorded' && end.answer.kind === 'choice' && end.answer.questionId === q.id ? q.options.find(o => o.id === (end.answer as { optionId: string }).optionId)?.label ?? null : null);
    if (chosen !== null) return <span className="flex items-center gap-1.5 text-body"><Icon name="check" className="size-4 text-ok" />{chosen}</span>;
    // The recommended option first (§2), drawn as the primary button.
    const ordered = [...q.options].sort((a, b) => Number(b.recommended) - Number(a.recommended));
    return (
      <div className="flex flex-col gap-2">
        {ordered.map(o => {
          const key = `${q.id}:${o.id}`;
          return (
            <button key={o.id} type="button" disabled={!answerable || composing} onClick={() => { void go(key, { kind: 'choice', questionId: q.id, optionId: o.id }); }} className={optClass(o.recommended)}>
              {spin(key)}<span className="min-w-0">{o.label}</span>
              {o.recommended && <span className="ml-auto pl-2 text-xs whitespace-nowrap opacity-85">{A.recommended}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  const compose = (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={`ask-${ask.id}`}>{ask.kind === 'parked' ? A.placeholderParked(who.name) : A.placeholder}</label>
      <textarea
        id={`ask-${ask.id}`} rows={2} value={text} onChange={e => setText(e.target.value)} disabled={sending}
        placeholder={ask.kind === 'parked' ? A.placeholderParked(who.name) : A.placeholder}
        className="max-h-[140px] min-h-11 w-full resize-y rounded-[10px] border border-input bg-surface px-3 py-2.5 text-base leading-[22px] text-fg outline-none placeholder:text-muted focus:border-ring"
      />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!answerable || !text.trim()} onClick={() => { void go('words', ask.kind === 'parked' ? { kind: 'resolve', text: text.trim() } : { kind: 'words', text: text.trim() }); }} className={kitButtonClass({ variant: 'primary', className: 'min-w-0' })}>
          {spin('words') ?? (needsCheck ? <Icon name="face" className="size-[18px]" /> : null)}<span className="truncate">{sendLabel}</span>
        </button>
        <button type="button" disabled={sending} onClick={() => setComposing(false)} className={kitButtonClass({ className: 'min-w-0' })}>{A.cancel}</button>
      </div>
      {several && answered < ask.questions.length && hint(A.settlesAll)}
    </div>
  );

  const problemText = problem === 'cancelled' ? copy.confirm.cancelled : problem === 'prepareFailed' ? copy.confirm.prepareFailed : problem === 'failed' ? copy.confirm.failed : problem === 'notSent' ? copy.decide.failed
    : end.kind === 'refused' ? (end.reason === 'assertion_expired' ? copy.confirm.expired : end.reason === 'unavailable' ? A.notSent(A.unreachable) : copy.confirm.failed) : null;
  const checkLine = !needsCheck || ask.questions.length === 0 && !composing && pill !== 'parked' && pill !== 'question' ? null
    : !canConfirm
      ? <>
          {hint(A.needsDevice)}
          {enroll && <a href={href({ name: 'connection', section: 'link' })} className="self-start text-small font-medium underline underline-offset-2">{copy.enroll.link}</a>}
        </>
      : turning !== null && turning !== 'seen'
        ? hint(copy.confirm.asking)
        : <p className="flex items-center gap-1.5 text-small text-muted"><Icon name="face" className="size-4" />{apple ? A.confirmHint : A.confirmHintDevice}</p>;

  return (
    <Card tone={pill === 'update' ? 'plain' : 'rig'} selected={selected} label={copy.atoi.region(copy.atoi.kindName.rig, who.name, ask.from.rig ?? '')}>
      <a href={open} className="-m-1 flex min-w-0 items-center gap-[7px] rounded-md p-1 active:bg-raised">
        <b className="font-semibold whitespace-nowrap">{who.name}</b>
        {ask.from.rig && <span className="min-w-0 truncate text-small text-muted">{ask.from.rig}</span>}
        <span className="flex-1" />
        {urgent && <Pill tone="urgent">{urgent}</Pill>}
        <Pill tone={pill === 'parked' ? 'rig' : 'plain'}>{A.pill[pill]}</Pill>
        <time dateTime={ask.updatedAt} className="font-mono text-small whitespace-nowrap text-muted">{timeOf(ask.updatedAt)}</time>
      </a>
      <a href={open} className="block text-body font-semibold [overflow-wrap:anywhere]">{ask.summary}</a>
      {body && !composing && (full
        ? <p className="text-body whitespace-pre-wrap [overflow-wrap:anywhere] text-muted">{body}</p>
        : <a href={open} className="line-clamp-3 text-body [overflow-wrap:anywhere] text-muted">{body}</a>)}
      {!full && !composing && (ask.bodyTruncated || body.length > 180 || body.split('\n').length > 3) && <a href={open} className="-mt-1 self-start text-[13px] font-medium underline-offset-2 hover:underline">{A.readAll}</a>}
      {full && (ask.evidenceRef || ask.detail) && (
        <dl className="grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2 text-small">
          <dt className="text-muted">{copy.detail.asked}</dt><dd className="m-0">{timeOf(ask.createdAt)}</dd>
          {ask.evidenceRef && <><dt className="text-muted">{A.source}</dt><dd className="m-0 font-mono [overflow-wrap:anywhere]">{ask.evidenceRef}</dd></>}
        </dl>
      )}
      {full && ask.detail && (
        <>
          <button type="button" aria-expanded={details} onClick={() => setDetails(d => !d)} className="self-start text-[13px] font-medium">{details ? '⌄' : '›'} {A.details}</button>
          {details && <p className="text-small whitespace-pre-wrap [overflow-wrap:anywhere] text-muted">{ask.detail}</p>}
        </>
      )}
      {pill === 'update' ? (
        <div className="flex">
          <button type="button" disabled={!live} onClick={() => { void go('seen', { kind: 'seen' }); }} className={kitButtonClass({ size: 'sm' })}>{spin('seen')}{A.seen}</button>
        </div>
      ) : composing && !several ? compose
        : ask.questions.length === 0 ? (
          composing ? compose : <button type="button" disabled={!answerable} onClick={() => setComposing(true)} className={kitButtonClass({ className: 'self-start' })}>{ask.kind === 'parked' ? A.answerParked : A.writeAnswer}</button>
        ) : several ? (
          <>
            {ask.questions.map((q, i) => (
              <div key={q.id} className="flex flex-col gap-1.5">
                <span className="text-small text-muted [overflow-wrap:anywhere]">{i + 1}. {q.question}</span>
                {options(q)}
              </div>
            ))}
            <span className="text-small text-muted">{A.progress(answered, ask.questions.length)}</span>
            {composing ? compose : <button type="button" disabled={!answerable} onClick={() => setComposing(true)} className="self-start text-[13px] font-medium text-muted underline-offset-2 hover:underline disabled:opacity-45">{A.answerOther}</button>}
          </>
        ) : (
          <>
            {options(ask.questions[0]!)}
            <button type="button" disabled={!answerable} onClick={() => setComposing(true)} className="self-start text-[13px] font-medium text-muted underline-offset-2 hover:underline disabled:opacity-45">{A.answerOther}</button>
          </>
        )}
      {problemText && hint(problemText, true)}
      {!problemText && checkLine}
    </Card>
  );
}
