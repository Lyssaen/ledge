import { useState } from 'react';
import { copy } from '../copy';
import { ageLabel, filterItems, headline, requestsOf, type Filter, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile } from '../state/store';
import { useNow } from '../useNow';
import { Badge } from '../ui/Badge';
import { Header } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { LostBanner } from '../ui/Notice';
import { TabBar } from '../ui/TabBar';

const FILTERS: Filter[] = ['all', 'permission', 'question'];

export const clock = (iso: string | null): string => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

function Row({ item, now, offline }: { item: InboxItem; now: number; offline: boolean }) {
  return (
    <a href={href({ name: 'request', sessionId: item.sessionId, pendingId: item.pendingId })} className="block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-raised">
      <div className="flex items-center gap-2.5">
        <MobileBot tool={item.tool} seed={item.botName} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.botName} · {item.task}</span>
        <span className="text-[11px] text-muted">{ageLabel(item.since, now)}</span>
      </div>
      <h3 className="mt-[11px] mb-[3px] text-base leading-[1.4] font-semibold [overflow-wrap:anywhere]"><span className="line-clamp-3">{headline(item)}</span></h3>
      <div className="text-[11px] [overflow-wrap:anywhere] text-muted">{item.repo}{item.branch && <> · <code className={`font-mono text-[.9em] ${item.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{item.branch}</code></>}</div>
      <div className="mt-3 flex items-center justify-between gap-2.5 text-[11px]">
        <Badge kind={item.kind} risk={item.risk} />
        <span className="flex items-center gap-1 text-muted">{offline ? copy.inbox.lastKnown : copy.inbox.examine}
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </span>
      </div>
    </a>
  );
}

export function Inbox({ onReconnect }: { onReconnect: () => void }) {
  const { sessions, link, syncedAt } = useMobile();
  const [filter, setFilter] = useState<Filter>('all');
  const now = useNow();
  const all = requestsOf(sessions);
  const list = filterItems(all, filter);
  const offline = link === 'offline';
  const subtitle = offline ? copy.link.lastKnownAt(clock(syncedAt)) : copy.inbox.subtitle(all.length);
  return (
    <>
      <Header title={copy.inbox.title} subtitle={subtitle} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-side pb-[22px]">
        {offline && <div className="mb-3"><LostBanner detail={copy.link.lostBody} onReconnect={onReconnect} /></div>}
        <div role="group" aria-label={copy.inbox.filtersLabel} className="mb-1.5 flex gap-1">
          {FILTERS.map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-[10px] px-3 text-xs ${filter === f ? 'bg-raised text-fg' : 'text-muted'}`}>{copy.inbox.filters[f]}</button>
          ))}
        </div>
        <div className="flex items-center justify-between py-3 text-[11px] tracking-[.4px] text-muted"><span>{offline ? copy.inbox.lastKnown.toUpperCase() : copy.inbox.oldestFirst}</span><span>{list.length}</span></div>
        <div className="flex flex-col gap-3">{list.map(i => <Row key={`${i.sessionId}/${i.pendingId}`} item={i} now={now} offline={offline} />)}</div>
        {list.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            <h2 className="text-[21px] leading-[1.3] tracking-[-.5px]">{all.length ? copy.inbox.emptyFilter : copy.inbox.upToDate}</h2>
            <p className="max-w-[260px] text-[13px] text-muted">{all.length ? copy.inbox.emptyFilterHint : copy.inbox.upToDateHint}</p>
          </div>
        )}
        {offline && <p className="mt-4 text-xs text-muted">{copy.inbox.offlineNote}</p>}
      </main>
      <TabBar count={all.length} />
    </>
  );
}
