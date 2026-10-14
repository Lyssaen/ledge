import { useRef, useState } from 'react';
import { tildePath } from '@ledge/client';
import { copy } from '../copy';
import { newOperationId } from '../model/operations';
import { outcomeFor } from '../model/requestOutcome';
import { ageLabel, headline, requestsOf, type InboxItem } from '../model/requests';
import { href } from '../router';
import { mobileStore, useMobile } from '../state/store';
import { Badge } from '../ui/Badge';
import { Command } from '../ui/Command';
import { BackHeader } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { LostBanner, Notice } from '../ui/Notice';
import { consequenceFor } from '../model/consequence';
import { DecisionFooter } from './DecisionFooter';
import { QuestionForm, answer } from './QuestionForm';
import { RiskConfirm } from './RiskConfirm';
import { Gone } from './Gone';
import { Result } from './Result';
import { useNow } from '../useNow';

/** Send one decision, now, on this link only. The store refuses a second one for the same request. */
function decide(item: InboxItem, decision: 'accept' | 'deny'): void {
  const operationId = newOperationId();
  mobileStore.submit(
    { operationId, sessionId: item.sessionId, pendingId: item.pendingId, pendingVersion: item.pendingVersion, kind: 'decide', decision, phase: 'sending', startedAt: new Date().toISOString() },
    { type: 'session.decide', id: item.sessionId, decision, pendingId: item.pendingId, pendingVersion: item.pendingVersion, operationId }
  );
}

const Loading = () => (
  <>
    <BackHeader title={copy.gone.header} backTo={href({ name: 'inbox' })} label={copy.detail.back} />
    <main className="min-h-0 flex-1 px-side pt-7 text-[13px] text-muted" role="status">{copy.loading}</main>
  </>
);

/** One request: read it, then decide it from the phone (or see what became of it). */
export function RequestDetail({ sessionId, pendingId, onReconnect }: { sessionId: string; pendingId: string; onReconnect: () => void }) {
  const { sessions, previews, link, syncedAt, ops } = useMobile();
  const now = useNow();
  const item = requestsOf(sessions).find(i => i.sessionId === sessionId && i.pendingId === pendingId);
  // The version the phone showed first: a decision always names it, and a newer one must be read again.
  const [seen, setSeen] = useState<number | null>(null);
  if (seen === null && item) setSeen(item.pendingVersion);
  const [choice, setChoice] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const last = useRef<InboxItem | undefined>(undefined);
  if (item) last.current = item;
  const outcome = outcomeFor({ sessionId, pendingId, ...(seen !== null ? { pendingVersion: seen } : {}) }, sessions, ops);

  if (outcome.kind === 'applied') {
    const shown = last.current;
    return <Result header={copy.result.header} title={outcome.decision === 'deny' ? copy.result.denied : outcome.answer !== undefined ? copy.result.answered : copy.result.allowed} body={copy.result.body} item={shown} final />;
  }
  // The item may vanish before its operation settles: the last version seen still says what was decided.
  const open = outcome.kind === 'sending' || outcome.kind === 'uncertain' || outcome.kind === 'unknown' || outcome.kind === 'rejected' || outcome.kind === 'failed';
  const shown = item ?? (open ? last.current : undefined);
  if (!shown) {
    // Never say "handled" before the PC has been heard from, nor while the link is down.
    if (link === 'connecting' || (syncedAt === null && link !== 'offline')) return <Loading />;
    return <Gone stale={link === 'offline' || outcome.kind !== 'handledElsewhere'} item={last.current} />;
  }
  const changed = item !== undefined && seen !== null && item.pendingVersion !== seen;
  const sameVersion = item !== undefined && item.pendingVersion === seen;
  const session = sessions.find(s => s.id === sessionId);
  const req = shown;
  const answerable = req.kind === 'question' && req.risk === 'low' && !req.readOnly && (req.options?.length ?? 0) > 0;
  const consequence = req.kind !== 'question' ? consequenceFor(req) : null;
  const lines = (previews[sessionId] ?? []).slice(-12);
  const offline = link === 'offline';
  return (
    <>
      <BackHeader title={copy.detail.heading[req.kind]} backTo={href({ name: 'inbox' })} label={copy.detail.back} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-side pb-[22px]">
        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-line bg-surface p-3.5">
          <MobileBot tool={req.tool} seed={req.botName} />
          <div className="min-w-0 flex-1">
            <strong className="block text-[13px] [overflow-wrap:anywhere]">{req.task}</strong>
            <p className="mt-0.5 text-[11px] text-muted">{req.botName} · {copy.tools[req.tool]}</p>
            <p className="mt-0.5 text-[11px] [overflow-wrap:anywhere] text-muted">{req.repo}{req.branch && <> · <code className={`font-mono text-[.9em] ${req.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{req.branch}</code></>}</p>
          </div>
        </div>
        <div className="mt-[22px] mb-3">
          <Badge kind={req.kind} risk={req.risk} />
          <h1 className="mt-2.5 text-[25px] leading-[1.25] font-semibold tracking-[-1px] [overflow-wrap:anywhere]">{req.kind === 'permission' ? copy.detail.commandTitle : headline(req)}</h1>
          {req.reason && <p className="mt-2.5 text-[13px] text-muted">{req.reason}</p>}
        </div>
        {req.kind !== 'question' && req.text && <Command text={req.text} />}
        {consequence && <Notice title={consequence.title} tone="danger"><p>{consequence.body}</p></Notice>}
        {req.kind === 'permission' && req.risk === 'low' && <Notice title={copy.detail.runsInProject}><p className="text-muted">{copy.detail.runsInProjectBody}</p></Notice>}
        {req.options && req.options.length > 0 && (answerable
          ? <QuestionForm options={req.options} value={choice} onChange={setChoice} disabled={outcome.kind === 'sending' || outcome.kind === 'uncertain'} />
          : <ul aria-label={copy.detail.options} className="my-3.5 flex list-none flex-col gap-2 p-0">
              {req.options.map(o => <li key={o} className="rounded-control border border-line bg-surface px-3 py-3 text-[13px] [overflow-wrap:anywhere]">{o}</li>)}
            </ul>
        )}
        <dl className="my-[18px] grid grid-cols-[74px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-xs">
          <dt className="text-muted">{copy.detail.folder}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{tildePath(session?.cwd ?? '')}</code></dd>
          {req.branch && <><dt className="text-muted">{copy.detail.branch}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{req.branch}</code></dd></>}
          {consequence?.destination && <><dt className="text-muted">{copy.detail.destination}</dt><dd className="m-0 [overflow-wrap:anywhere]"><code className="font-mono text-[.9em]">{consequence.destination}</code></dd></>}
          <dt className="text-muted">{copy.detail.asked}</dt><dd className="m-0">{copy.detail.ago(ageLabel(req.since, now))}</dd>
        </dl>
        {lines.length > 0 && (
          <details className="group mt-[18px] border-t border-line">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-xs [&::-webkit-details-marker]:hidden">{copy.detail.context}</summary>
            <pre className="pt-2 pb-4 font-mono text-xs leading-[1.7] break-words whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{lines.join('\n')}</pre>
          </details>
        )}
        {offline && outcome.kind !== 'uncertain' && <div className="mt-4"><LostBanner detail={copy.link.lostDetail} onReconnect={onReconnect} /></div>}
      </main>
      <DecisionFooter item={req} outcome={outcome} link={link} changed={changed} stillPending={item !== undefined && item.pendingVersion === seen} onReread={() => { setSeen(req.pendingVersion); setChoice(null); setConfirming(false); }} onDecide={d => decide(req, d)} onVerify={() => setConfirming(true)} choice={choice} onAnswer={() => { if (choice !== null) answer(req, choice); }} onCheck={() => { if (link === 'online') mobileStore.checkOperations(); else onReconnect(); }} />
      {confirming && item !== undefined && sameVersion && link === 'online' && <RiskConfirm item={item} onClose={() => setConfirming(false)} />}
    </>
  );
}
