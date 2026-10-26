import { useState, type ReactNode } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import type { PhoneSession, PhoneTask } from '@ledge/protocol';
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
import { Flag, RolePill } from '../ui/teams/RolePill';
import { closedTasks } from '../model/teams';
import { navigate } from '../router';

type InboxFilter = Filter | 'tasks';
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

/** A closed task Ledge gave (ledge home spec §2.4): its owner with its role and team, the start of its result. */
function TaskRow({ task, now, onSee }: { task: PhoneTask; now: number; onSee: () => void }) {
  const title = task.state === 'done' ? copy.inbox.finishedTitle(task.title) : task.state === 'refused' ? copy.inbox.refusedTitle(task.title) : copy.inbox.droppedTitle(task.title);
  return (
    <article aria-label={title} className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{task.ownerName}</span>{task.ownerRole && <RolePill role={task.ownerRole} />}
        {task.teamName && <span className="flex items-center gap-1 text-team"><Flag />{task.teamName}</span>}
        <span className="ml-auto text-[11px] text-muted">{ageLabel(task.updatedAt, now)}</span>
      </div>
      <h3 className="mt-[11px] mb-[3px] text-base leading-[1.4] font-semibold [overflow-wrap:anywhere]">{title}</h3>
      <p className="line-clamp-2 text-[11px] [overflow-wrap:anywhere] text-muted">{copy.inbox.ledgeTask} · <code className="font-mono">{task.id}</code>{task.result ? ` · ${task.result}` : ''}</p>
      <div className="mt-3 flex items-center justify-between gap-2.5 text-[11px]">
        <span className={`inline-flex h-6 items-center rounded-md px-2 ${task.state === 'done' ? 'bg-ok/10 text-ok' : 'bg-attention/10 text-attention'}`}>{task.state === 'done' ? `✓ ${copy.inbox.taskDone}` : copy.inbox.taskClosed}</span>
        <button type="button" onClick={onSee} className="flex min-h-11 items-center gap-1 text-muted">{copy.inbox.seeResult}
          <svg className={CHEVRON} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
    </article>
  );
}

/**
 * « À traiter »: the requests waiting on the PC, the oldest first. Offline, the last known ones, said to be so: by
 * `notice` when given (the PC off the relay), else by the banner.
 */
export function Inbox({ store, onReconnect, notice }: { store: MobileStore; onReconnect?: () => void; notice?: ReactNode }) {
  const state = useMobile(store);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const now = useNow();
  const all = requestsOf([...state.sessions.values()]);
  const list = filter === 'tasks' ? [] : filterItems(all, filter);
  const closed = closedTasks(state.tasks.values());
  const tasks = filter === 'all' || filter === 'tasks' ? closed : [];
  const filters: InboxFilter[] = state.teams ? [...FILTERS, 'tasks'] : FILTERS;
  const waiting = all.length + closed.length;
  const see = (t: PhoneTask) => { void store.seeTask(t.id); navigate({ name: 'thread', sessionId: t.owner }); };
  const offline = !state.fresh;
  // Offline before any state was received: no time to give, so no separator either.
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.inbox.lastKnown) : closed.length ? copy.inbox.subtitleTasks(all.length, closed.length) : copy.inbox.subtitle(all.length);
  return (
    <>
      <Header title={copy.inbox.title} subtitle={subtitle} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3">{notice ?? <OfflineBanner onReconnect={onReconnect} />}</div>}
        <div role="group" aria-label={copy.inbox.filtersLabel} className="mb-1.5 flex gap-1">
          {filters.map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`min-h-11 rounded-[10px] px-3 text-xs ${filter === f ? 'bg-raised text-fg' : 'text-muted'}`}>{copy.inbox.filters[f]}</button>
          ))}
        </div>
        <div className="flex items-center justify-between py-3 text-[11px] tracking-[.4px] text-muted"><span>{offline ? copy.inbox.lastKnown.toUpperCase() : copy.inbox.oldestFirst}</span><span>{list.length + tasks.length}</span></div>
        <div className="flex flex-col gap-3">
          {list.map(i => <Row key={`${i.sessionId}/${i.key}`} item={i} session={state.sessions.get(i.sessionId)} now={now} offline={offline} />)}
          {tasks.map(t => <TaskRow key={t.id} task={t} now={now} onSee={() => see(t)} />)}
        </div>
        {list.length === 0 && tasks.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            {!waiting && <div aria-hidden="true"><ResidentMascot size={96} theme="dark" frozen={offline} /></div>}
            <h2 className="text-[21px] leading-[1.3] tracking-[-.5px]">{waiting ? copy.inbox.emptyFilter : copy.inbox.upToDate}</h2>
            <p className="max-w-[260px] text-[13px] text-muted">{waiting ? copy.inbox.emptyFilterHint : copy.inbox.upToDateHint}</p>
            {!waiting && <a href={href({ name: 'agents' })} className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-control border border-line px-4 text-[13px]">{copy.inbox.seeAgents}
              <svg className={CHEVRON} viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></a>}
          </div>
        )}
        {offline && <p className="mt-4 text-xs text-muted">{copy.inbox.offlineNote}</p>}
      </main>
      <TabBar count={all.length + closed.length} chat={!!state.device?.chat} />
    </>
  );
}
