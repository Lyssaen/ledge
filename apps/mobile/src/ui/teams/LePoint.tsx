import { useState } from 'react';
import { CONTEXT_NEAR, type PhoneSession, type PhoneTask, type PhoneTeam } from '@ledge/protocol';
import { copy } from '../../copy';
import { closedTasks, openTasks } from '../../model/teams';
import { ageLabel, headline, requestsOf } from '../../model/requests';
import { href, navigate } from '../../router';
import type { MobileStore } from '../../state/store';
import { useNow } from '../../useNow';
import { Flag, Progress, RolePill } from './RolePill';
import { buttonClass } from '../Button';

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
 * authorisation answered in place, the rest opened; the closed tasks Ledge gave), the teams with Ledge's progress, and
 * the tasks Ledge gave that are still open.
 */
export function LePoint({ store, sessions, teams, tasks, syncedAt, fresh, threshold = CONTEXT_NEAR }: { store: MobileStore; sessions: PhoneSession[]; teams: PhoneTeam[]; tasks: Map<string, PhoneTask>; syncedAt: string | null; fresh: boolean; threshold?: number }) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const byId = new Map(sessions.map(s => [s.id, s]));
  const requests = requestsOf(sessions);
  const closed = closedTasks(tasks.values());
  // Near their context limit (context handover spec §3.2): opened here, handed over from the PC.
  const near = sessions.filter(s => s.state !== 'exited' && !s.handover && s.context && s.context.used / s.context.window >= threshold);
  const open = openTasks(tasks.values()).slice(0, 5);
  const P = copy.chat.point;
  const yours = requests.length + closed.length + near.length;
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
                  <span className="font-medium">{r.botName}</span>{s?.role && <RolePill role={s.role} />}
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
          {closed.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <Dot tone={t.state === 'done' ? 'ok' : 'attention'} />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body">
                <span className="font-medium">{t.ownerName}</span>{t.ownerRole && <RolePill role={t.ownerRole} />}<span>{closedLine(t)}</span>
              </span>
              <button type="button" className={SMALL} onClick={() => see(t)}>{P.see}</button>
            </div>
          ))}
          {near.map(s => (
            <div key={`near:${s.id}`} className="flex items-center gap-2">
              <Dot tone="attention" />
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-body" title={P.nearHint}>
                <span className="font-medium">{s.name}</span>{s.role && <RolePill role={s.role} />}<span className="text-attention">· {P.near(Math.round((s.context!.used / s.context!.window) * 100))}</span>
              </span>
              <a href={href({ name: 'thread', sessionId: s.id })} className={SMALL}>{P.see}</a>
            </div>
          ))}
        </div>
      )}
      {teams.length > 0 && (
        <div role="group" aria-label={P.teamsLabel} className="flex flex-col gap-2">
          <h3 className={HEAD}>{P.teams}</h3>
          {teams.map(t => t.state === 'active' ? (
            <div key={t.id} className="flex items-center gap-2 text-body">
              <Flag /><span className="font-medium">{t.name}</span><span className="flex-1 text-muted">{P.seats(t.seats.length)}</span>
              {t.given > 0 && <Progress done={t.done} given={t.given} />}
            </div>
          ) : (
            <div key={t.id} className="flex items-center gap-2 text-body text-muted">
              <Flag dim /><span className="flex-1"><span className="font-medium">{t.name}</span> · {P.resting}</span>
              <button type="button" className={SMALL} disabled={!fresh} onClick={() => void store.resumeTeam(t.id)}>{P.resume}</button>
            </div>
          ))}
        </div>
      )}
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
