import { useState, type ReactNode } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import type { PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { ageLabel, filterItems, headline, requestsOf, type Filter, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { useNow } from '../useNow';
import { Badge } from '../ui/Badge';
import { Header, linkView } from '../ui/Header';
import { MobileBot } from '../ui/MobileBot';
import { OfflineBanner } from '../ui/Notice';
import { TabBar } from '../ui/TabBar';

const FILTERS: Filter[] = ['all', 'permission', 'question'];
const CHEVRON = 'size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]';

export const clock = (iso: string | null): string => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

function Row({ item, session, now, offline }: { item: InboxItem; session: PhoneSession | undefined; now: number; offline: boolean }) {
  return (
    <a href={href({ name: 'request', sessionId: item.sessionId, key: item.key })} className="block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-raised">
      <div className="flex items-center gap-2.5">
        <MobileBot tool={item.tool} seed={item.sessionId} state={session?.state ?? 'waiting_permission'} frozen={offline} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.botName} · {item.task}</span>
        <span className="text-[11px] text-muted">{ageLabel(item.since, now)}</span>
      </div>
      <h3 className="mt-[11px] mb-[3px] text-base leading-[1.4] font-semibold [overflow-wrap:anywhere]"><span className="line-clamp-3">{headline(item)}</span></h3>
      <div className="text-[11px] [overflow-wrap:anywhere] text-muted">{item.repo}{item.branch && <> · <code className={`font-mono text-[.9em] ${item.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{item.branch}</code></>}</div>
      <div className="mt-3 flex items-center justify-between gap-2.5 text-[11px]">
        <Badge kind={item.kind} risk={item.risk} />
        <span className="flex items-center gap-1 text-muted">{offline ? copy.inbox.lastKnown : copy.inbox.examine}
          <svg className={CHEVRON} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </span>
      </div>
    </a>
  );
}

/**
 * « À traiter »: the requests waiting on the PC, the oldest first. Offline, the last known ones, said to be so: by
 * `notice` when given (the PC off the relay), else by the banner.
 */
export function Inbox({ store, onReconnect, notice }: { store: MobileStore; onReconnect?: () => void; notice?: ReactNode }) {
  const state = useMobile(store);
  const [filter, setFilter] = useState<Filter>('all');
  const now = useNow();
  const all = requestsOf([...state.sessions.values()]);
  const list = filterItems(all, filter);
  const offline = !state.fresh;
  // Offline before any state was received: no time to give, so no separator either.
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.inbox.lastKnown) : copy.inbox.subtitle(all.length);
  return (
    <>
      <Header title={copy.inbox.title} subtitle={subtitle} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3">{notice ?? <OfflineBanner onReconnect={onReconnect} />}</div>}
        <div role="group" aria-label={copy.inbox.filtersLabel} className="mb-1.5 flex gap-1">
          {FILTERS.map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-[10px] px-3 text-xs ${filter === f ? 'bg-raised text-fg' : 'text-muted'}`}>{copy.inbox.filters[f]}</button>
          ))}
        </div>
        <div className="flex items-center justify-between py-3 text-[11px] tracking-[.4px] text-muted"><span>{offline ? copy.inbox.lastKnown.toUpperCase() : copy.inbox.oldestFirst}</span><span>{list.length}</span></div>
        <div className="flex flex-col gap-3">{list.map(i => <Row key={`${i.sessionId}/${i.key}`} item={i} session={state.sessions.get(i.sessionId)} now={now} offline={offline} />)}</div>
        {list.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            {!all.length && <div aria-hidden="true"><ResidentMascot size={96} theme="dark" frozen={offline} /></div>}
            <h2 className="text-[21px] leading-[1.3] tracking-[-.5px]">{all.length ? copy.inbox.emptyFilter : copy.inbox.upToDate}</h2>
            <p className="max-w-[260px] text-[13px] text-muted">{all.length ? copy.inbox.emptyFilterHint : copy.inbox.upToDateHint}</p>
            {!all.length && <a href={href({ name: 'agents' })} className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-control border border-line px-4 text-[13px]">{copy.inbox.seeAgents}
              <svg className={CHEVRON} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></a>}
          </div>
        )}
        {offline && <p className="mt-4 text-xs text-muted">{copy.inbox.offlineNote}</p>}
      </main>
      <TabBar count={all.length} chat={!!state.device?.chat} />
    </>
  );
}
