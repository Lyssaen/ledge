import { useState } from 'react';
import { CONTEXT_NEAR, type PhoneHarnessUsage, type PhoneSession, type PhoneTask } from '@ledge/protocol';
import { overWindows, resetLabel } from '../../model/usage';
import { Limits, TONE_TEXT } from './Limits';
import { copy } from '../../copy';
import { closedTasks, openDecisions, openTasks } from '../../model/tasks';
import { ageLabel, headline, requestsOf } from '../../model/requests';
import { href, navigate } from '../../router';
import type { MobileStore } from '../../state/store';
import { useNow } from '../../useNow';
import { buttonClass } from '../Button';
import { Tag } from '../Tag';
import { NoteProposal } from './NoteProposal';

const SMALL = buttonClass({ size: 'sm', className: 'min-w-[64px] flex-none' });
const YES = buttonClass({ variant: 'primary', size: 'sm', className: 'min-w-[64px] flex-none' });
const HEAD = 'mt-1 text-meta tracking-[.4px] text-muted';

function Dot({ tone }: { tone: 'attention' | 'ok' | 'danger' }) {
  return <span aria-hidden="true" className={`size-2 flex-none rounded-full ${tone === 'ok' ? 'bg-ok' : tone === 'danger' ? 'bg-approval' : 'bg-attention'}`} />;
}

/** A closed task of Ledge: « Voir » opens its owner's thread and puts the task away. */
function closedLine(t: PhoneTask): string {
  return t.state === 'done' ? copy.chat.point.finished : t.state === 'refused' ? copy.chat.point.refused : copy.chat.point.dropped;
}

/**
 * « Le point » (ledge home spec §2.4), built from the PC's state, not asked of Ledge: what waits for the user (a plain
 * authorisation answered in place, the rest opened; the decisions sessions put to the user, answered through the chat;
 * the closed tasks Ledge gave), and the tasks Ledge gave that are still open.
 * `onAnswer` puts a decision's answer in the making into the chat's field: the phone never answers by itself.
 */
export function LePoint({ store, sessions, tasks, syncedAt, fresh, threshold = CONTEXT_NEAR, onAnswer, usage = [], usageAlert = null }: { store: MobileStore; sessions: PhoneSession[]; tasks: Map<string, PhoneTask>; syncedAt: string | null; fresh: boolean; threshold?: number; onAnswer?: (t: PhoneTask) => void;
  /** This PC's harness limits (docs/mockups/ledge-harness-usage.html): « LIMITES », and each window reached in « À toi ». */
  usage?: readonly PhoneHarnessUsage[];
  /** The PC's usage alert threshold (`usage.state`'s `prefs.alert`); null: not known, only a reached window is said. */
  usageAlert?: number | null }) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const byId = new Map(sessions.map(s => [s.id, s]));
  const requests = requestsOf(sessions);
  const decisions = openDecisions(tasks.values());
  const closed = closedTasks(tasks.values());
  // Near their context limit (context handover spec §3.2): opened here, handed over from the PC.
  const near = sessions.filter(s => s.state !== 'exited' && !s.handover && s.context && s.context.used / s.context.window >= threshold);
  const open = openTasks(tasks.values()).slice(0, 5);
  const P = copy.chat.point;
  // A window past the PC's threshold (amber) or reached (red), in « À toi », as the PC's « À toi » says them.
  const full = overWindows(usage, usageAlert);
  const yours = requests.length + full.length + decisions.length + closed.length + near.length;
  const decide = (sessionId: string, key: string, decision: 'accept' | 'deny') => {
    const item = requests.find(r => r.sessionId === sessionId && r.key === key);
    if (!item) return;
    setBusy(`${sessionId}/${key}`);
    store.decide(sessionId, decision, { expect: { key: item.key, kind: item.kind, text: item.text } });
  };
  const see = (t: PhoneTask) => { void store.seeTask(t.id); navigate({ name: 'thread', sessionId: t.owner }); };
  return (
    <section aria-label={P.label} className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4">
      <h2 className="flex items-baseline gap-2 text-base font-bold">{P.title}{syncedAt && <span className="text-small font-normal text-muted">{P.ago(ageLabel(syncedAt, now))}</span>}</h2>
      {yours === 0 && <p className="text-body text-muted">{P.calm}</p>}
      {yours > 0 && (
        <div role="group" aria-label={P.yoursLabel} className="flex flex-col gap-2">
          <h3 className={HEAD}>{P.yours} · {yours}</h3>
          {requests.map(r => {
            const s = byId.get(r.sessionId);
            const inPlace = r.kind === 'permission' && r.risk !== 'high' && r.source !== 'rpc';
            const id = `${r.sessionId}/${r.key}`;
            return (
              <div key={id} className="flex items-center gap-2">
                <Dot tone="danger" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body">
                  <span className="font-medium">{r.botName}</span>
                  <span className="min-w-0 truncate font-mono">{headline(r)}</span>
                </span>
                {inPlace ? (
                  <>
                    <button type="button" className={YES} disabled={!fresh || busy === id} onClick={() => decide(r.sessionId, r.key, 'accept')}>{P.yes}</button>
                    <button type="button" className={SMALL} disabled={!fresh || busy === id} onClick={() => decide(r.sessionId, r.key, 'deny')}>{P.no}</button>
                  </>
                ) : <a href={href({ name: 'request', sessionId: r.sessionId, key: r.key })} className={SMALL}>{P.see}</a>}
              </div>
            );
          })}
          {full.map(({ harness, window: w, tone }) => {
            const which = w.kind === 'five_hour' ? P.five : w.kind === 'seven_day' ? P.week : P.model(w.model ?? '');
            return (
              <div key={`usage:${harness}:${w.kind}:${w.model ?? ''}`} data-usage-over={tone} className="flex items-center gap-2" aria-label={tone === 'red' ? P.reachedLabel(P.harnessShort[harness] ?? harness, which) : P.overLabel(P.harnessShort[harness] ?? harness, which, w.pct)}>
                <span aria-hidden="true" className={`flex size-5 flex-none items-center justify-center rounded-md ${tone === 'red' ? 'bg-danger-bg text-approval' : 'text-attention'}`} style={tone === 'red' ? undefined : { background: 'var(--status-warning-soft)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></svg>
                </span>
                <span className="min-w-0 flex-1 text-body">{P.harnessShort[harness] ?? harness} · {which} <b className={`font-medium ${TONE_TEXT[tone]}`}>{w.pct} %</b></span>
                {w.resetsAt && <span className="flex-none whitespace-nowrap text-small text-muted">↺ {resetLabel(w.resetsAt, now, true)}</span>}
              </div>
            );
          })}
          {decisions.map(t => t.brain ? <NoteProposal key={`decision:${t.id}`} task={{ ...t, brain: t.brain }} store={store} fresh={fresh} /> : (
            <div key={`decision:${t.id}`} className="flex items-start gap-2">
              <span className="mt-2 flex"><Dot tone="attention" /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Tag tone="attention" label={P.decision} />
                  <span className="font-medium">{t.giverName ?? P.someone}</span><span className="text-muted">{P.asks}</span>
                </span>
                <span className="break-words">{t.title}</span>
                {t.text && <span className="whitespace-pre-wrap break-words text-small text-muted">{t.text}</span>}
              </div>
              {onAnswer && <button type="button" className={SMALL} aria-label={P.answerLabel(t.title)} onClick={() => onAnswer(t)}>{P.answer}</button>}
            </div>
          ))}
          {closed.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <Dot tone={t.state === 'done' ? 'ok' : 'attention'} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body">
                <span className="font-medium">{t.ownerName}</span><span>{closedLine(t)}</span>
              </span>
              <button type="button" className={SMALL} onClick={() => see(t)}>{P.see}</button>
            </div>
          ))}
          {near.map(s => (
            <div key={`near:${s.id}`} className="flex items-center gap-2">
              <Dot tone="attention" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body" title={P.nearHint}>
                <span className="font-medium">{s.name}</span><span className="text-attention">· {P.near(Math.round((s.context!.used / s.context!.window) * 100))}</span>
              </span>
              <a href={href({ name: 'thread', sessionId: s.id })} className={SMALL}>{P.see}</a>
            </div>
          ))}
        </div>
      )}
      <Limits usage={usage} now={now} alert={usageAlert} />
      {open.length > 0 && (
        <div role="group" aria-label={P.givenLabel} className="flex flex-col gap-2">
          <h3 className={HEAD}>{P.given}</h3>
          {open.map(t => (
            <a key={t.id} href={href({ name: 'thread', sessionId: t.owner })} className="flex items-center gap-2 text-body">
              <code className="flex-none font-mono text-small text-muted">{t.id}</code>
              <span className="min-w-0 flex-1 truncate">{t.title} <span className="text-muted">→ {t.ownerName}</span></span>
              <span className={t.state === 'taken' ? 'text-info' : 'text-muted'}>{P.state[t.state]}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
