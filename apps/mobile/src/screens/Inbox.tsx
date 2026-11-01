import { useState, type ReactNode } from 'react';
import type { PhoneEscalation, PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { ageLabel, filterItems, headline, requestsOf, type Filter, type InboxItem } from '../model/requests';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { useNow } from '../useNow';
import { Badge } from '../ui/Badge';
import { Header, linkView } from '../ui/Header';
import { Mascot, MobileBot } from '../ui/MobileBot';
import { OfflineBanner } from '../ui/Notice';
import { TabBar } from '../ui/TabBar';
import { buttonClass, chipClass } from '../ui/Button';
import { Icon } from '../ui/icons';

const FILTERS: Filter[] = ['all', 'permission', 'question'];

export const clock = (iso: string | null): string => iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

function Row({ item, session, now, offline }: { item: InboxItem; session: PhoneSession | undefined; now: number; offline: boolean }) {
  return (
    <a href={href({ name: 'request', sessionId: item.sessionId, key: item.key })} className="block rounded-card border border-line bg-surface p-4 transition-colors hover:bg-raised active:bg-raised">
      <div className="flex items-center gap-2.5">
        <MobileBot tool={item.tool} seed={item.sessionId} state={session?.state ?? 'waiting_permission'} frozen={offline} />
        <span className="min-w-0 flex-1 truncate text-small font-medium">{item.botName} · {item.task}</span>
        <span className="text-meta text-muted">{ageLabel(item.since, now)}</span>
      </div>
      <h3 className="mt-[11px] mb-[3px] text-base leading-[1.4] font-semibold [overflow-wrap:anywhere]"><span className="line-clamp-3">{headline(item)}</span></h3>
      <div className="text-meta [overflow-wrap:anywhere] text-muted">{item.repo}{item.branch && <> · <code className={`font-mono text-[.9em] ${item.worktree ? 'underline decoration-dotted underline-offset-2' : ''}`}>{item.branch}</code></>}</div>
      <div className="mt-3 flex items-center justify-between gap-2.5 text-meta">
        <Badge kind={item.kind} risk={item.risk} />
        <span className="flex items-center gap-1 text-muted">{offline ? copy.inbox.lastKnown : copy.inbox.examine}<Icon name="chevron" />
        </span>
      </div>
    </a>
  );
}

function ViaLedge({ escalation, store, offline }: { escalation: PhoneEscalation; store: MobileStore; offline: boolean }) {
  const [op, setOp] = useState<string | null>(null); const state = useMobile(store);
  const phase = op ? state.ops[op]?.phase : undefined;
  const busy = !!op && phase !== 'rejected' && phase !== 'failed';
  const question = escalation.questions.length === 1 ? escalation.questions[0] : undefined;
  return <section className="rounded-card border border-line bg-surface p-4"><a className="block" href={href({ name: 'escalation', id: escalation.id })}><p>Via Ledge · {escalation.rigName ?? escalation.from}</p><strong>{escalation.summary}</strong>{escalation.state === 'grace' && <p>Ledge s’en occupe…</p>}</a>
    {question && <div className="mt-2 flex flex-wrap gap-2">{[...question.options].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended)).map(option => <button key={option.id} type="button" className={buttonClass({ size: 'sm' })} disabled={offline || busy} onClick={() => setOp(store.answerEscalation(escalation.id, { [question.id]: option.id }))}>{option.label}{option.recommended ? ' · recommandé' : ''}</button>)}</div>}
    {phase === 'rejected' || phase === 'failed' ? <p role="alert">Réponse non acceptée. Vérifie la demande.</p> : busy ? <p role="status">Réponse envoyée, en attente de confirmation.</p> : null}
  </section>;
}

/**
 * « À traiter »: the requests waiting on the PC, the oldest first. Offline, the last known ones, said to be so: by
 * `notice` when given (the PC off the relay), else by the banner.
 */
export function Inbox({ store, onReconnect, notice }: { store: MobileStore; onReconnect?: () => void; notice?: ReactNode }) {
  const state = useMobile(store);
  const [filter, setFilter] = useState<Filter>('all');
  const [via, setVia] = useState<'all' | 'ledge' | 'sessions'>('all');
  const now = useNow();
  const all = requestsOf([...state.sessions.values()].filter(s => !state.openrig || (!s.rig && !s.brain)));
  const escalations = state.openrig ? [...state.escalations.values()].filter(e => e.state === 'pending' || e.state === 'grace') : [];
  const list = state.openrig ? (via === 'ledge' ? [] : all) : filterItems(all, filter);
  const shownEscalations = via === 'sessions' ? [] : escalations;
  const waiting = all.length + escalations.filter(e => e.state === 'pending').length;
  const mixed = [...list.map(item => ({ kind: 'session' as const, item, at: item.since })), ...shownEscalations.map(item => ({ kind: 'escalation' as const, item, at: item.createdAt }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const offline = !state.fresh;
  // Offline before any state was received: no time to give, so no separator either.
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.inbox.lastKnown) : state.openrig ? `${waiting} décision${waiting === 1 ? '' : 's'}. Ledge en a tranché ${state.decisionsToday.filter(d => d.by === 'ledge').length} autres.` : copy.inbox.subtitle(all.length);
  return (
    <>
      <Header title={state.openrig ? copy.nav.toYou : copy.inbox.title} subtitle={subtitle} link={linkView(state)} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[22px]">
        {offline && <div className="mb-3">{notice ?? <OfflineBanner onReconnect={onReconnect} />}</div>}
        <div role="group" aria-label={copy.inbox.filtersLabel} className="mb-1.5 flex gap-1">
          {state.openrig ? (['all', 'ledge', 'sessions'] as const).map(f => <button key={f} type="button" aria-pressed={via === f} onClick={() => setVia(f)} className={chipClass(via === f)}>{f === 'all' ? 'Tout' : f === 'ledge' ? 'Via Ledge' : 'Sessions'}</button>) : FILTERS.map(f => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={chipClass(filter === f)}>{copy.inbox.filters[f]}</button>
          ))}
        </div>
        <div className="flex items-center justify-between py-3 text-meta tracking-[.4px] text-muted"><span>{offline ? copy.inbox.lastKnown.toUpperCase() : copy.inbox.oldestFirst}</span><span>{mixed.length}</span></div>
        <div className="flex flex-col gap-3">
          {mixed.map(row => row.kind === 'session'
            ? <Row key={`${row.item.sessionId}/${row.item.key}`} item={row.item} session={state.sessions.get(row.item.sessionId)} now={now} offline={offline} />
            : <ViaLedge key={row.item.id} escalation={row.item} store={store} offline={offline} />)}
        </div>
        {mixed.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            {!waiting && <div aria-hidden="true"><Mascot size={96} frozen={offline} /></div>}
            <h2 className="text-heading leading-[1.3] tracking-[-.5px]">{waiting ? copy.inbox.emptyFilter : copy.inbox.upToDate}</h2>
            <p className="max-w-[260px] text-body text-muted">{waiting ? copy.inbox.emptyFilterHint : copy.inbox.upToDateHint}</p>
            {!waiting && <a href={href({ name: 'agents' })} className={buttonClass({ size: 'sm', className: 'mt-1' })}>{copy.inbox.seeAgents}<Icon name="chevron" /></a>}
          </div>
        )}
        {offline && <p className="mt-4 text-small text-muted">{copy.inbox.offlineNote}</p>}
      </main>
      <TabBar openrig={state.openrig} count={all.length + escalations.filter(e => e.state === 'pending').length} chat={!!state.device?.chat} />
    </>
  );
}
