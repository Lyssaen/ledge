import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { consequenceFor, lowRiskNoticeFor } from '../model/consequence';
import { checkFreeAnswer } from '../model/freeAnswer';
import { outcomeFor } from '../model/requestOutcome';
import { ageLabel, headline, requestsOf, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { useBusy } from '../useBusy';
import { useNow } from '../useNow';
import { Badge } from '../ui/Badge';
import { Command } from '../ui/Command';
import { BackHeader, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { Notice } from '../ui/Notice';
import { usePlatform } from './device';
import { DecisionFooter } from './DecisionFooter';
import { Gone } from './Gone';
import { MultiQuestionForm, QuestionForm } from './QuestionForm';
import { Result } from './Result';

function Lost({ onReconnect }: { onReconnect?: (() => void) | undefined }) {
  const [busy, setBusy] = useBusy();
  return (
    <Notice title={copy.link.lostTitle} tone="warning" role="status">
      <p>{copy.link.lostDetail}</p>
      {onReconnect && (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-surface px-4 py-2.5 text-[13px] font-medium disabled:opacity-45">
          {busy ? copy.link.reconnecting : copy.link.reconnect}
        </button>
      )}
    </Notice>
  );
}

const resultTitle = (o: { decision?: string; answer?: string }) =>
  o.decision === 'deny' ? copy.result.denied : o.answer !== undefined ? copy.result.answered : copy.result.allowed;

/**
 * One request (boards Request, Permission, Question): read it, then decide it from the phone, or see what became of
 * it. A shortened request is asked whole. When the PC says the one decided was replaced (`stale`), the new one is
 * shown, to be read before deciding.
 */
export function RequestDetail({ store, sessionId, requestKey, onReconnect }: { store: MobileStore; sessionId: string; requestKey: string; onReconnect?: () => void }) {
  const state = useMobile(store);
  const now = useNow();
  const { fresh, ops, capabilities } = state;
  const [key, setKey] = useState(requestKey);
  const [changed, setChanged] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [otherText, setOtherText] = useState('');
  // OMP: the position of the option tapped, waiting for the device's confirmation; the choices of an `ask`, kept with the questions they answer.
  const [picked, setPicked] = useState<number | null>(null);
  const [chosen, setChosen] = useState<{ sig: string; v: string[][] }>({ sig: '', v: [] });
  const platform = usePlatform();
  // The last tap sent nothing (the store refused the write): said in the footer until the next tap.
  const [refused, setRefused] = useState(false);
  // The address this screen wrote itself (a request replaced in place) comes back as `requestKey`: nothing to reset.
  const keyRef = useRef(key);
  keyRef.current = key;
  useEffect(() => {
    if (requestKey === keyRef.current) return;
    setKey(requestKey); setChanged(false); setChoice(null); setOtherText(''); setPicked(null); setRefused(false);
  }, [requestKey]);

  const sessions = [...state.sessions.values()];
  const item = requestsOf(sessions).find(i => i.sessionId === sessionId && i.key === key);
  const last = useRef<InboxItem | undefined>(undefined);
  if (item) last.current = item;
  const outcome = outcomeFor({ sessionId, key }, sessions, ops);

  // A shortened request is asked whole once the PC can answer; the store keeps the whole body after.
  const cut = item?.cut === true;
  useEffect(() => { if (cut && fresh) store.loadPending(sessionId); }, [store, sessionId, key, cut, fresh]);

  // The request decided was replaced: show the new one, which must be read before deciding.
  const next = state.sessions.get(sessionId)?.pending?.key;
  useEffect(() => {
    if (outcome.kind !== 'changed' || !next) return;
    setKey(next);
    setChanged(true);
    setChoice(null);
    setOtherText('');
    setPicked(null);
    try { globalThis.history?.replaceState(null, '', href({ name: 'request', sessionId, key: next })); } catch { /* the page keeps its address */ }
  }, [outcome.kind, next, sessionId]);

  const link = linkView(state);
  const back = href({ name: 'inbox' });

  if (outcome.kind === 'applied') return <Result store={store} title={resultTitle(outcome)} body={copy.result.body} item={last.current} final />;
  // The request may vanish before its operation settles: the last version seen still says what was decided.
  const open = outcome.kind === 'sending' || outcome.kind === 'uncertain' || outcome.kind === 'rejected' || outcome.kind === 'failed' || outcome.kind === 'changed';
  const req = item ?? (open ? last.current : undefined);
  if (!req) {
    // Never say « handled » before the PC was heard from, nor from a state that is not the PC's now.
    if (!fresh && state.syncedAt === null) {
      return (
        <>
          <BackHeader title={copy.gone.header} backTo={back} label={copy.detail.back} link={link} />
          <main className="min-h-0 flex-1 pt-7 text-[13px] text-muted" role="status">{copy.loading}</main>
        </>
      );
    }
    return <Gone store={store} stale={!fresh} item={last.current} />;
  }

  const isQuestion = req.kind === 'question';
  const options = req.options ?? [];
  const caps = capabilities?.[req.tool];
  const canOther = isQuestion && caps?.freeTextAnswer === true;
  // OMP (capabilities say so): an ask of several questions is answered together; a dialog with options by tapping one. Else as before.
  const askQuestions = isQuestion && caps?.questions === true && req.requestId !== undefined && req.questions?.length ? req.questions : undefined;
  const optionMode = !askQuestions && caps?.decide === false && options.length > 0;
  const answerable = !askQuestions && !optionMode && isQuestion && (options.length > 0 || canOther);
  // The PC asks the device's check for any reply to an OMP dialog that is not low; a phone that cannot give it leaves it to the PC.
  const canConfirm = state.device?.confirm === true && platform;
  const guarded = req.risk !== 'low';
  const sig = JSON.stringify((askQuestions ?? []).map(q => [q.id, q.options.map(o => o.label)]));
  const selected = chosen.sig === sig ? chosen.v : [];
  const missing = (askQuestions ?? []).filter((_, i) => !selected[i]?.length).length;
  const toggle = (qi: number, label: string) => {
    const q = askQuestions?.[qi];
    if (!q) return;
    const v = (askQuestions ?? []).map((_, i) => selected[i] ?? []);
    const cur = v[qi] ?? [];
    v[qi] = q.multi ? (cur.includes(label) ? cur.filter(l => l !== label) : [...cur, label]) : [label];
    setChosen({ sig, v });
    setRefused(false);
  };
  const expect = { key: req.key, kind: req.kind, text: req.text };
  const sendAnswers = (cancel: boolean) => {
    if (!askQuestions || req.requestId === undefined) return;
    const answers = cancel ? [] : askQuestions.map((q, i) => ({ id: q.id, selected: selected[i] ?? [] }));
    setRefused(!store.answer(sessionId, req.requestId, answers, { expect, ...(cancel ? { cancel: true } : {}) }));
  };
  const optionsLive = fresh && !changed && item !== undefined && outcome.kind !== 'sending' && outcome.kind !== 'uncertain' && (canConfirm || !guarded);
  // An option is answered by its 1-based position: a label could be a digit read as another option, or appear twice.
  const tapOption = (i: number) => {
    if (guarded) { setPicked(i); setRefused(false); } else setRefused(!store.reply(sessionId, String(i + 1)));
  };
  const optionList = (
    <ul aria-label={copy.answers.legend} className="my-3.5 flex list-none flex-col gap-2 p-0">
      {options.map((o, i) => (
        <li key={`${i}:${o}`}>
          <button type="button" disabled={!optionsLive} aria-pressed={picked === i} onClick={() => tapOption(i)}
            className="flex min-h-12 w-full flex-col items-start justify-center rounded-control border border-line bg-surface px-3 py-3 text-left text-[13px] [overflow-wrap:anywhere] disabled:opacity-45 aria-pressed:border-fg/40 aria-pressed:bg-raised">
            {o}
            {req.optionDetails?.[i] && <small className="mt-0.5 text-[11px] text-muted">{req.optionDetails[i]}</small>}
          </button>
        </li>
      ))}
    </ul>
  );
  const free = checkFreeAnswer(otherText);
  const choosingOther = canOther && (options.length === 0 || choice === options.length);
  const consequence = isQuestion ? null : consequenceFor(req);
  const lowNotice = lowRiskNoticeFor(req);
  const lines = (state.previews.get(sessionId) ?? []).slice(-12);
  const busy = outcome.kind === 'sending' || outcome.kind === 'uncertain';

  const send = () => {
    if (choosingOther) { if (free.problem === null) setRefused(!store.reply(sessionId, free.text)); }
    else if (choice !== null && choice < options.length) setRefused(!store.reply(sessionId, String(choice + 1)));
  };

  return (
    <>
      <BackHeader title={copy.detail.heading[req.kind]} backTo={back} label={copy.detail.back} link={link} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface p-3.5">
          <MobileBot tool={req.tool} seed={req.sessionId} state={state.sessions.get(sessionId)?.state ?? 'idle'} frozen={!fresh} />
          <div className="min-w-0 flex-1">
            <strong className="block text-[13px] [overflow-wrap:anywhere]">{req.task}</strong>
            <p className="mt-0.5 text-[11px] text-muted">{req.botName} · {copy.tools[req.tool]}</p>
            <p className="mt-0.5 text-[11px] [overflow-wrap:anywhere] text-muted">{req.repo}{req.branch && <> · <code className={`font-mono text-[.9em] ${req.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{req.branch}</code></>}</p>
          </div>
        </div>
        <div className="mt-[22px] mb-3">
          <Badge kind={req.kind} risk={req.risk} />
          <h1 className="mt-2.5 text-[25px] leading-[1.25] font-semibold tracking-[-1px] [overflow-wrap:anywhere]">{req.kind === 'permission' ? copy.detail.commandTitle : headline(req)}</h1>
        </div>
        {isQuestion ? (
          <>
            {askQuestions && <MultiQuestionForm questions={askQuestions} selected={selected} onToggle={toggle} disabled={busy} />}
            {optionMode && optionList}
            {answerable && (
              <QuestionForm options={options} value={choice} onChange={c => { setChoice(c); setRefused(false); }} botName={req.botName} disabled={busy}
                other={canOther ? { text: otherText, onText: t => { setOtherText(t); setRefused(false); }, problem: free.problem } : undefined}
                onSubmit={fresh && !changed && !busy && item !== undefined ? send : undefined} />
            )}
            {!canOther && !optionMode && !askQuestions && options.length > 0 && <p className="mb-3.5 text-xs text-muted">{copy.decide.otherUnsupported}</p>}
          </>
        ) : (
          <>
            <Command text={req.body ?? req.text} />
            {optionMode && optionList}
            {!optionMode && options.length > 0 && (
              <ul aria-label={copy.detail.options} className="my-3.5 flex list-none flex-col gap-2 p-0">
                {options.map(o => <li key={o} className="rounded-control border border-line bg-surface px-3 py-3 text-[13px] [overflow-wrap:anywhere]">{o}</li>)}
              </ul>
            )}
            {consequence && <Notice title={consequence.title} tone="danger"><p>{consequence.body}</p></Notice>}
            {lowNotice && <Notice title={lowNotice.title}><p className="text-muted">{lowNotice.body}</p></Notice>}
            <dl className="my-[18px] grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-xs">
              {req.branch && <><dt className="text-muted">{copy.detail.branch}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{req.branch}</code></dd></>}
              {consequence?.destination && <><dt className="text-muted">{copy.detail.destination}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{consequence.destination}</code></dd></>}
              <dt className="text-muted">{copy.detail.asked}</dt><dd className="m-0">{copy.detail.ago(ageLabel(req.since, now))}</dd>
            </dl>
            {lines.length > 0 && (
              <details className="group mt-[18px] border-t border-line">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-xs [&::-webkit-details-marker]:hidden">
                  {copy.detail.context}
                  <svg className="size-4 flex-none fill-none stroke-current text-muted [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 6-6-6-6M12 19h8" /></svg>
                </summary>
                <pre className="pt-2 pb-4 font-mono text-xs leading-[1.7] break-words whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{lines.join('\n')}</pre>
              </details>
            )}
          </>
        )}
        {!fresh && outcome.kind !== 'uncertain' && <div className="mt-4"><Lost onReconnect={onReconnect} /></div>}
      </main>
      <DecisionFooter
        item={req} outcome={outcome} fresh={fresh} changed={changed} stillPending={item !== undefined}
        onReread={() => { setChanged(false); setChoice(null); setPicked(null); setRefused(false); }} onDecide={d => setRefused(!store.decide(sessionId, d))}
        answerable={answerable} choice={choosingOther ? options.length : choice} onAnswer={send}
        answerBlocked={choosingOther ? free.problem !== null : choice === null || choice >= options.length}
        onCheck={onReconnect} refused={refused} store={store} deviceConfirm={state.device?.confirm === true}
        optionReply={optionMode ? { canConfirm: guarded ? canConfirm : true, picked: guarded ? picked : null, onBack: () => setPicked(null), onReply: a => picked === null ? null : store.reply(sessionId, String(picked + 1), { assertion: a }) } : undefined}
        multi={askQuestions ? { missing, onSend: () => sendAnswers(false), onCancel: () => sendAnswers(true) } : undefined}
      />
    </>
  );
}
