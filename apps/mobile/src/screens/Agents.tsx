import { CONTEXT_NEAR, type PhoneSession, type PhoneTeam } from '@ledge/protocol';
import { copy } from '../copy';
import { agentsOf, type AgentRow } from '../model/agents';
import { requestsOf } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { Header, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { OfflineBanner } from '../ui/Notice';
import { StatusBadge } from '../ui/StatusBadge';
import { TabBar } from '../ui/TabBar';
import { Flag, Progress, RolePill } from '../ui/teams/RolePill';
import { closedTasks, tablesOf, type Table } from '../model/teams';

function Row({ row, session, offline, threshold }: { row: AgentRow; session: PhoneSession | undefined; offline: boolean; threshold: number }) {
  return (
    <a href={href({ name: 'thread', sessionId: row.sessionId })} className="flex gap-3 border-b border-line py-4 hover:bg-raised/40">
      <div className="mt-[3px]"><MobileBot tool={row.tool} seed={row.sessionId} state={session?.state ?? 'idle'} frozen={offline} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{row.task}</h3>
          {row.unread && <span className="flex-none text-[10px] text-info">{copy.agents.unread}</span>}
        </div>
        <div className="my-[3px] text-[11px] [overflow-wrap:anywhere] text-muted">
          <span className="inline-flex flex-wrap items-center gap-1.5">{row.botName}{row.role && <RolePill role={row.role} />}</span>{row.branch && <> · <code className={`font-mono text-[.9em] ${row.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{row.branch}</code></>}
        </div>
        {row.last && <p className="mt-[5px] line-clamp-2 text-xs [overflow-wrap:anywhere] text-muted">{row.last}</p>}
        {session && (session.context || session.handover || session.relieves) && (
          <p className="mt-[5px] text-[11px] text-muted">
            {[session.context ? copy.agents.context(Math.round((session.context.used / session.context.window) * 100)) : null,
              session.handover ? (session.handover.state === 'done' && session.handover.toName ? copy.agents.relievedBy(session.handover.toName) : copy.agents.relief[session.handover.state]) : null,
              session.relieves ? copy.agents.relieves(session.relieves.name) : null].filter(Boolean).map((x, i) => (
              <span key={i} className={i === 0 && session.context && session.context.used / session.context.window >= threshold ? 'text-attention' : undefined}>{i > 0 ? ' · ' : ''}{x}</span>
            ))}
          </p>
        )}
        <div className="mt-2"><StatusBadge {...row.status} /></div>
      </div>
      <svg className="mt-1 size-5 flex-none self-center fill-none stroke-muted [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    </a>
  );
}

/** A table's heading: ⚑ a team with Ledge's progress, or « Reprendre » when it rests; the common table by its name. */
function TableHead({ table, store, offline }: { table: Table; store: MobileStore; offline: boolean }) {
  if (table.kind === 'common') return <div className="pt-3 pb-1 text-[11px] tracking-[.4px] text-muted">{copy.agents.common}</div>;
  const t: PhoneTeam = table.team;
  if (t.state === 'resting') return (
    <div className="flex items-center gap-2 pt-3 pb-1 text-[13px] text-muted">
      <Flag dim /><span className="flex-1"><span className="font-semibold">{t.name}</span> · {copy.agents.resting}</span>
      <button type="button" disabled={offline} onClick={() => void store.resumeTeam(t.id)} className="inline-flex h-10 items-center rounded-control border border-white/15 px-3 text-[13px] font-medium text-fg disabled:opacity-40">{copy.agents.resume}</button>
    </div>
  );
  return (
    <div className="flex items-center gap-2 pt-3 pb-1 text-[13px]">
      <Flag /><span className="font-semibold">{t.name}</span><span className="min-w-0 flex-1 truncate text-xs text-muted">{copy.agents.team}</span>
      {t.given > 0 && <Progress done={t.done} given={t.given} />}
    </div>
  );
}

/** Every session of the PC, by repository, each opening its thread. */
export function Agents({ store, onReconnect }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const sessions = [...state.sessions.values()];
  const groups = agentsOf(sessions);
  const offline = !state.fresh;
  // A PC that knows teams: each project's sessions by table (ledge home spec §2.4).
  const tables = state.teams ? tablesOf(sessions, state.teams) : null;
  const working = state.teams?.filter(t => t.state === 'active').length ?? 0;
  const subtitle = offline ? copy.agents.offline : copy.agents.subtitle(sessions.length, groups.length) + copy.agents.teamsWorking(working);
  return (
    <>
      <Header title={copy.agents.title} subtitle={subtitle} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3"><OfflineBanner onReconnect={onReconnect} /></div>}
        {tables?.map(g => {
          const teamed = g.tables.some(t => t.kind === 'team');
          return (
            <section key={g.key} aria-label={g.label}>
              <div className="py-3 text-[11px] tracking-[.4px] text-muted">{teamed ? copy.agents.tables(g.label, g.tables.length).toUpperCase() : g.label}</div>
              {g.tables.map(t => (
                <div key={t.kind === 'team' ? t.team.id : 'common'} role="group" aria-label={t.kind === 'team' ? copy.agents.teamLabel(t.team.name) : copy.agents.common} className={t.kind === 'team' && t.team.state === 'resting' ? 'opacity-70' : ''}>
                  {teamed && <TableHead table={t} store={store} offline={offline} />}
                  {t.rows.map(r => <Row key={r.sessionId} row={r} session={state.sessions.get(r.sessionId)} offline={offline} threshold={state.device?.contextNear ?? CONTEXT_NEAR} />)}
                </div>
              ))}
            </section>
          );
        })}
        {!tables && groups.map(g => (
          // Two groups can share a name (a repository and a project); a session belongs to one group only.
          <section key={g.rows[0]!.sessionId} aria-label={g.label}>
            <div className="py-3 text-[11px] tracking-[.4px] text-muted">{g.label}</div>
            {g.rows.map(r => <Row key={r.sessionId} row={r} session={state.sessions.get(r.sessionId)} offline={offline} threshold={state.device?.contextNear ?? CONTEXT_NEAR} />)}
          </section>
        ))}
        {(tables ?? groups).length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            <h2 className="text-[21px] leading-[1.3] tracking-[-.5px]">{copy.agents.empty}</h2>
            <p className="max-w-[260px] text-[13px] text-muted">{copy.agents.emptyHint}</p>
          </div>
        )}
      </main>
      <TabBar count={requestsOf(sessions).length + closedTasks(state.tasks.values()).length} active="agents" chat={!!state.device?.chat} />
    </>
  );
}
