import { CONTEXT_NEAR, type PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { agentsOf, loneSessions, rigsIn, type AgentRow } from '../model/agents';
import { closingHere, endedAtLabel } from '../model/sessionEnd';
import { useNow } from '../useNow';
import { requestsOf } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { Header, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { OfflineBanner } from '../ui/Notice';
import { Tag } from '../ui/Tag';
import { TabBar } from '../ui/TabBar';
import { Icon } from '../ui/icons';

/**
 * One session. A close of this phone under way reads « Fermeture… » over the session's own state; an ended one says when. Closing
 * and resuming are done from the session's page, where what the agent was doing shows: a row is only a link.
 */
function Row({ row, session, offline, threshold, plan, closing, now }: { row: AgentRow; session: PhoneSession | undefined; offline: boolean; threshold: number; plan?: boolean; closing: boolean; now: number }) {
  return (
    <a href={href({ name: 'thread', sessionId: row.sessionId })} className="flex gap-3 border-b border-line py-4 hover:bg-raised/40 active:bg-raised/60">
      <div className="mt-[3px]"><MobileBot tool={row.tool} seed={row.sessionId} state={session?.state ?? 'idle'} frozen={offline} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-body font-semibold [overflow-wrap:anywhere]">{row.task}</h3>
          {row.unread && <span className="flex-none text-meta text-info">{copy.agents.unread}</span>}
        </div>
        <div className="my-[3px] text-meta [overflow-wrap:anywhere] text-muted">
          <span className="inline-flex flex-wrap items-center gap-1.5">{row.botName}</span>{row.branch && <> · <code className={`font-mono text-[.9em] ${row.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{row.branch}</code></>}
        </div>
        {row.last && <p className="mt-[5px] line-clamp-2 text-small [overflow-wrap:anywhere] text-muted">{row.last}</p>}
        {session && (session.context || session.handover || session.relieves) && (
          <p className="mt-[5px] text-meta text-muted">
            {[session.context ? copy.agents.context(Math.round((session.context.used / session.context.window) * 100)) : null,
              session.handover ? (session.handover.state === 'done' && session.handover.toName ? copy.agents.relievedBy(session.handover.toName) : copy.agents.relief[session.handover.state]) : null,
              session.relieves ? copy.agents.relieves(session.relieves.name) : null].filter(Boolean).map((x, i) => (
              <span key={i} className={i === 0 && session.context && session.context.used / session.context.window >= threshold ? 'text-attention' : undefined}>{i > 0 ? ' · ' : ''}{x}</span>
            ))}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2.5">
          <Tag {...(closing ? { tone: 'attention' as const, label: copy.chat.closing } : row.status)} />
          {!closing && row.endedAt && <span className="text-meta text-muted">{endedAtLabel(row.endedAt, now)}</span>}
          {plan && row.progress && (
            <span role="img" aria-label={copy.checklist.progress(row.progress.done, row.progress.total)} className="inline-flex items-center gap-1.5 text-meta text-muted">
              <Icon name="plan" className="size-[13px]" stroke={1.8} />
              <span className="font-mono text-fg">{row.progress.done}/{row.progress.total}</span>
              <span className="h-1 w-10 overflow-hidden rounded-[2px] bg-raised"><span className="block h-full bg-ok" style={{ width: `${row.progress.total ? (row.progress.done / row.progress.total) * 100 : 0}%` }} /></span>
            </span>
          )}
        </div>
        {plan && row.progress?.current && (
          <p className="mt-[5px] truncate text-[12px] leading-[18px] text-muted"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-info align-[1px]" />{row.progress.current}</p>
        )}
      </div>
      <span className="self-center text-muted"><Icon name="chevron" /></span>
    </a>
  );
}

/** Every session of the PC, by repository, each opening its thread. */
export function Agents({ store, onReconnect }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const now = useNow();
  const allSessions = [...state.sessions.values()];
  const sessions = state.openrig ? loneSessions(allSessions) : allSessions;
  const groups = agentsOf(state.openrig ? sessions.map(s => ({ ...s, repo: undefined })) : sessions);
  const rigs = [...state.rigs.values()];
  if (state.openrig) {
    for (const project of state.projects) if (!groups.some(g => g.label === project.name)) groups.push({ label: project.name, rows: [] });
    for (const rig of rigs) if (rig.project && !groups.some(g => g.label === rig.project)) groups.push({ label: rig.project, rows: [] });
  }
  const closing = new Set(sessions.filter(s => closingHere(s, state.ops, now)).map(s => s.id));
  const offline = !state.fresh;
  const subtitle = offline ? copy.agents.offline : state.openrig ? `${sessions.length} sessions seules · ${groups.length} projets sur ce PC` : copy.agents.subtitle(sessions.length, groups.length);
  return (
    <>
      <Header title={state.openrig ? copy.nav.projects : copy.agents.title} subtitle={subtitle} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3"><OfflineBanner onReconnect={onReconnect} /></div>}
        {groups.map(g => (
          // Two groups can share a name (a repository and a project); a session belongs to one group only.
          <section key={g.rows[0]?.sessionId ?? `rigs:${g.label}`} aria-label={g.label}>
            <div className="py-3 text-meta tracking-[.4px] text-muted">{g.label}</div>
            {state.openrig && rigsIn(g.label, rigs).length > 0 && <a href={href({ name: 'rigs' })} className="block py-2 text-small text-muted">{rigsIn(g.label, rigs).length} rigs travaillent aussi ici : {rigsIn(g.label, rigs).map(r => r.name).join(', ')} · Rigs ›</a>}
            {g.rows.map(r => <Row key={r.sessionId} row={r} session={state.sessions.get(r.sessionId)} offline={offline} threshold={state.device?.contextNear ?? CONTEXT_NEAR} plan={!!state.daemon?.checklist} closing={closing.has(r.sessionId)} now={now} />)}
          </section>
        ))}
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            <h2 className="text-heading leading-[1.3] tracking-[-.5px]">{copy.agents.empty}</h2>
            <p className="max-w-[260px] text-body text-muted">{copy.agents.emptyHint}</p>
          </div>
        )}
      </main>
      <TabBar openrig={state.openrig} count={requestsOf(sessions).length + (state.openrig ? [...state.escalations.values()].filter(e => e.state === 'pending').length : 0)} active={state.openrig ? 'projects' : 'agents'} chat={!!state.device?.chat} />
    </>
  );
}
