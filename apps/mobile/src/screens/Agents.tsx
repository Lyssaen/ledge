import { copy } from '../copy';
import { agentsOf, type AgentRow } from '../model/agents';
import { href } from '../router';
import { useMobile } from '../state/store';
import { Header } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { LostBanner } from '../ui/Notice';
import { StatusBadge } from '../ui/StatusBadge';
import { TabBar } from '../ui/TabBar';
import { requestsOf } from '../model/requests';

function Row({ row }: { row: AgentRow }) {
  return (
    <a href={href({ name: 'thread', sessionId: row.sessionId })} className="flex gap-3 border-b border-line py-4 hover:bg-raised/40">
      <div className="mt-[3px]"><MobileBot tool={row.tool} seed={row.botName} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{row.task}</h3>
          {row.unread && <span className="flex-none text-[10px] text-info">{copy.agents.unread}</span>}
        </div>
        <div className="my-[3px] text-[11px] [overflow-wrap:anywhere] text-muted">
          {row.botName}{row.branch && <> · <code className={`font-mono text-[.9em] ${row.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{row.branch}</code></>}
        </div>
        {row.last && <p className="mt-[5px] line-clamp-2 text-xs [overflow-wrap:anywhere] text-muted">{row.last}</p>}
        <div className="mt-2"><StatusBadge {...row.status} /></div>
      </div>
      <svg className="mt-1 size-5 flex-none self-center fill-none stroke-muted [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    </a>
  );
}

export function Agents({ onReconnect }: { onReconnect: () => void }) {
  const { sessions, link } = useMobile();
  const groups = agentsOf(sessions);
  const offline = link === 'offline';
  const subtitle = offline ? copy.agents.offline : copy.agents.subtitle(sessions.length, groups.length);
  return (
    <>
      <Header title={copy.agents.title} subtitle={subtitle} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-side pb-[22px]">
        {offline && <div className="mb-3"><LostBanner detail={copy.link.lostBody} onReconnect={onReconnect} /></div>}
        {groups.map(g => (
          <section key={g.label} aria-label={g.label}>
            <div className="py-3 text-[11px] tracking-[.4px] text-muted">{g.label}</div>
            {g.rows.map(r => <Row key={r.sessionId} row={r} />)}
          </section>
        ))}
        {groups.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            <h2 className="text-[21px] leading-[1.3] tracking-[-.5px]">{copy.agents.empty}</h2>
            <p className="max-w-[260px] text-[13px] text-muted">{copy.agents.emptyHint}</p>
          </div>
        )}
      </main>
      <TabBar count={requestsOf(sessions).length} active="agents" />
    </>
  );
}
