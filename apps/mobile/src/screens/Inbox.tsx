import { useEffect, useState, type ReactNode } from 'react';
import { CONTEXT_NEAR, type HumanAsk, type PhoneSession } from '@ledge/protocol';
import { copy, locale } from '../copy';
import { askEndOf, cardMode, CHIPS_FROM, pillOf, sortAsks, whoOf, workingOf, WORKING_MAX } from '../model/atoi';
import { outcomeFor } from '../model/requestOutcome';
import { ageLabel, filterItems, firstLine, headline, requestsOf, type Filter, type InboxItem } from '../model/requests';
import { doingLine } from '../model/sessions';
import { indicators } from '../model/usage';
import { href, useRoute } from '../router';
import { TabPage } from '../shell/Shell';
import { useMobile, type MobileState, type MobileStore } from '../state/store';
import { Icon } from '../ui/icons';
import { Box, EmptyState, Line } from '../ui/kit/Box';
import { FilterChips, kitButtonClass } from '../ui/kit/Controls';
import { Dot, Pill, RuntimeTag } from '../ui/kit/marks';
import { useWide } from '../ui/layout';
import { Mascot } from '../ui/MobileBot';
import { useNow } from '../useNow';
import { AskCard } from './atoi/AskCard';
import { useSticky } from './atoi/Receipt';
import { SessionCard } from './atoi/SessionCard';
import { usePlatform } from './device';
import { UpdateCard } from './Enroll';

export const clock = (iso: string | null): string => iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';

/** The chips of « À toi » once it holds many requests (Q16): the sessions' two kinds, and the rigs'. */
type AtoiFilter = Filter | 'rigs';

const idOf = (i: Pick<InboxItem, 'sessionId' | 'key'>) => `${i.sessionId}/${i.key}`;

/**
 * Whether OpenRig's section shows (m1-reponses-rig.html §4): with asks, or to say why none can come (the channel not ready,
 * a partial list). A PC without `daemon.openrig`, or a ready channel with nothing asked, has no section.
 */
function rigsShown(state: MobileState, asks: readonly HumanAsk[]): boolean {
  if (!state.daemon?.openrig) return asks.length > 0;
  const ch = state.asksChannel;
  return asks.length > 0 || (ch !== null && (ch.partial || ch.channel.state !== 'ready'));
}

/** Why OpenRig's asks may be missing, with Desktop's words (Q66): the channel, else a partial read. */
function ChannelStrip({ state, machine }: { state: MobileState; machine: string }) {
  const ch = state.asksChannel;
  if (!ch) return null;
  const C = copy.asks.channel;
  const lines = ch.channel.state === 'ready'
    ? (ch.partial ? { title: null, body: copy.asks.partial } : null)
    : ch.channel.state === 'not_installed'
      ? { title: C.not_installed.title(machine), body: C.not_installed.body }
      : { title: C[ch.channel.state].title, body: C[ch.channel.state].body };
  if (!lines) return null;
  return (
    <div role="status" data-channel={ch.channel.state} className="flex items-start gap-[9px] rounded-lg border border-line px-3 py-2.5 text-[13px] leading-[18px]">
      <span className="mt-[5px]"><Dot state="off" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {lines.title && <span className="font-medium">{lines.title}</span>}
        {lines.body && <span className="text-muted">{lines.body}</span>}
      </div>
    </div>
  );
}

/** The sessions at work (Q13): five at most, then « Voir les N autres ». What each is doing (Q68). */
function Working({ sessions, threshold, now, stale }: { sessions: PhoneSession[]; threshold: number; now: number; stale: boolean }) {
  const shown = sessions.slice(0, WORKING_MAX);
  const rest = sessions.length - shown.length;
  return (
    <Box label={copy.atoi.working}>
      {shown.map(s => {
        const ctx = indicators(s, now, threshold).context;
        return (
          <Line
            key={s.id} href={href({ name: 'thread', sessionId: s.id })} stale={stale}
            lead={<><Dot state="work" pulse={!stale} /><RuntimeTag tool={s.tool} /></>}
            title={<><b className="font-semibold">{s.name}</b>{s.rig && <span className="text-small text-muted"> {s.rig.name}</span>}</>}
            sub={doingLine(s)}
            {...(ctx ? { meta: `${ctx.pct} %`, metaWarn: ctx.near } : {})}
          />
        );
      })}
      {rest > 0 && (
        <a href={href({ name: 'sessions', filter: 'working' })} className="flex min-h-11 items-center gap-1 px-3 text-[13px] font-medium text-muted">
          {copy.atoi.more(rest)}<Icon name="chevron" className="size-4" />
        </a>
      )}
    </Box>
  );
}

/**
 * « À toi » (docs/mockups/ledge-mobile-refonte/m1-a-toi.html, 3228f5ed; m1-reponses-rig.html, 7aa3ec6e). On a phone: the sessions'
 * requests as cards decided in place, OpenRig's asks under « Rigs OpenRig », then the sessions at work; nothing waiting, a calm
 * state. On a wide screen (§12): the same groups as compact rows, the one chosen opened on the right.
 */
export function Inbox({ store, onReconnect }: { store: MobileStore; onReconnect?: () => void }) {
  const state = useMobile(store);
  const wide = useWide();
  const platform = usePlatform();
  const now = useNow();
  const [filter, setFilter] = useState<AtoiFilter>('all');
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());

  const sessions = [...state.sessions.values()];
  const items = requestsOf(sessions);
  const asks = sortAsks(state.asks ?? []);
  const fresh = state.fresh;
  const canConfirm = state.device?.confirm === true && platform;
  const enroll = platform && state.device?.confirm !== true;
  const machine = state.daemon?.name ?? '';
  const threshold = state.device?.contextNear ?? CONTEXT_NEAR;

  const total = items.length + asks.length;
  const chips = total >= CHIPS_FROM;
  // The chips leave once the list is short again: everything shows.
  const f: AtoiFilter = chips ? filter : 'all';
  const shownItems = f === 'rigs' ? [] : filterItems(items, f);
  const shownAsks = f === 'all' || f === 'rigs' ? asks : [];

  const cards = useSticky(shownItems.map(i => ({ id: idOf(i), value: i })));
  const askCards = useSticky(shownAsks.map(a => ({ id: a.id, value: a })));

  // A request that left while on screen, with no decision of this phone's and none recorded on the PC, while its session asks
  // something new: it was replaced (§6). Its place goes to the new one, which is read again before deciding.
  const replaced = cards.entries.filter(e => {
    if (!e.ghost || !fresh) return false;
    const s = state.sessions.get(e.value.sessionId);
    const now_ = s?.pending?.key;
    if (!now_ || now_ === e.value.key || s?.lastAnswer?.key === e.value.key) return false;
    return outcomeFor(e.value, sessions, state.ops).kind === 'handledElsewhere';
  });
  const replacedKey = replaced.map(e => e.id).join('|');
  useEffect(() => {
    if (!replaced.length) return;
    setChanged(c => {
      const next = new Set(c);
      for (const e of replaced) {
        const key = state.sessions.get(e.value.sessionId)?.pending?.key;
        if (key) next.add(`${e.value.sessionId}/${key}`);
      }
      return next;
    });
    for (const e of replaced) cards.dismiss(e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replacedKey]);
  const hidden = new Set(replaced.map(e => e.id));
  const reread = (id: string) => setChanged(c => { const n = new Set(c); n.delete(id); return n; });

  const withCard = new Set(items.map(i => i.sessionId));
  const working = workingOf(sessions, withCard);
  const showRigs = f !== 'permission' && f !== 'question' && rigsShown(state, asks);
  const nothing = total === 0;
  const offline = !fresh;
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.inbox.lastKnown) : total ? copy.atoi.count(total) : undefined;

  const chipBar = chips && (
    <FilterChips<AtoiFilter>
      label={copy.inbox.filtersLabel} value={f} onChange={setFilter}
      options={[
        { value: 'all', label: copy.inbox.filters.all, count: total },
        { value: 'permission', label: copy.inbox.filters.permission, count: filterItems(items, 'permission').length },
        { value: 'question', label: copy.inbox.filters.question, count: filterItems(items, 'question').length },
        { value: 'rigs', label: copy.atoi.rigs, count: asks.length }
      ]}
    />
  );

  const empty = nothing && (
    <Box label={copy.atoi.noRequest}>
      <EmptyState
        framed={false} glyph={<Mascot size={96} frozen={offline} />} title={copy.atoi.noRequest}
        body={working.length ? copy.atoi.calmHint : copy.atoi.nothingRunning}
        {...(working.length ? {} : { action: <a href={href({ name: 'sessions' })} className={kitButtonClass({ size: 'sm' })}>{copy.atoi.seeSessions}<Icon name="chevron" className="size-4" /></a> })}
      />
    </Box>
  );
  const filteredEmpty = !nothing && shownItems.length === 0 && shownAsks.length === 0 && (
    <EmptyState glyph={<Icon name="inbox" />} title={copy.inbox.emptyFilter} body={copy.inbox.emptyFilterHint} />
  );

  // « Mettre à jour ta passkey » at the top, not counted (passkey-reinstall.html, 4 a).
  const update = <div className="flex flex-col gap-3 empty:hidden"><UpdateCard store={store} /></div>;

  if (wide) return <WideList update={update} state={state} items={shownItems} asks={showRigs ? shownAsks : []} working={working} showRigs={showRigs} chipBar={chipBar} empty={empty || filteredEmpty} subtitle={subtitle} threshold={threshold} now={now} machine={machine} />;

  return (
    <TabPage title={copy.inbox.title} subtitle={subtitle}>
      {update}
      {chipBar}
      {empty}
      {filteredEmpty}
      {cards.entries.filter(e => !hidden.has(e.id)).map(e => {
        const item = e.value;
        const session = state.sessions.get(item.sessionId);
        return (
          <SessionCard
            key={e.id} store={store} item={item} session={session}
            mode={cardMode(item, state.capabilities?.[item.tool], session?.readOnly === true)}
            outcome={outcomeFor(item, sessions, state.ops)} fresh={fresh} ghost={e.ghost}
            changed={changed.has(e.id)} onReread={() => reread(e.id)}
            canConfirm={canConfirm} enroll={enroll} onGone={() => cards.dismiss(e.id)} onCheck={onReconnect}
          />
        );
      })}
      {showRigs && (
        <>
          <h2 className="mt-1 flex items-center gap-2 text-[13px] font-semibold">
            <Dot state="rig" />{copy.atoi.rigs}<span className="font-normal text-muted">{asks.length}</span>
          </h2>
          <ChannelStrip state={state} machine={machine} />
          {askCards.entries.map(e => (
            <AskCard
              key={e.id} store={store} ask={e.value} end={askEndOf(e.id, state.ops)} fresh={fresh} ghost={e.ghost}
              canConfirm={canConfirm} enroll={enroll} onGone={() => askCards.dismiss(e.id)}
            />
          ))}
        </>
      )}
      {working.length > 0 && f === 'all' && (
        <>
          <h2 className="mt-1 text-[13px] font-semibold">{copy.atoi.working}</h2>
          <Working sessions={working} threshold={threshold} now={now} stale={offline} />
        </>
      )}
      {offline && <p className="text-small text-muted">{copy.inbox.offlineNote}</p>}
    </TabPage>
  );
}

/** The list of a wide screen (§12): compact rows grouped Demandes, Rigs OpenRig, En cours; the one open on the right is lit. */
function WideList({ update, state, items, asks, working, showRigs, chipBar, empty, subtitle, threshold, now, machine }: {
  update: ReactNode; state: MobileState; items: InboxItem[]; asks: HumanAsk[]; working: PhoneSession[]; showRigs: boolean;
  chipBar: ReactNode; empty: ReactNode; subtitle: string | undefined; threshold: number; now: number; machine: string;
}) {
  const route = useRoute();
  const offline = !state.fresh;
  return (
    <TabPage title={copy.inbox.title} subtitle={subtitle} wideSubtitle={subtitle}>
      {update}
      {chipBar}
      {empty}
      {items.length > 0 && (
        <Box title={copy.atoi.requests} dot="perm" count={items.length}>
          {items.map(i => (
            <Line
              key={idOf(i)} href={href({ name: 'request', sessionId: i.sessionId, key: i.key })} stale={offline}
              selected={route.name === 'request' && route.sessionId === i.sessionId}
              lead={<RuntimeTag tool={i.tool} />}
              title={<><b className="font-semibold">{i.botName}</b> {i.risk === 'high' ? copy.risk.badge : i.kind === 'permission' ? copy.atoi.line.permission : copy.atoi.pill[i.kind]}</>}
              sub={firstLine(i.kind === 'permission' ? (i.body ?? i.text) : headline(i))}
              meta={ageLabel(i.since, now)}
            />
          ))}
        </Box>
      )}
      {showRigs && (
        <Box title={copy.atoi.rigs} dot="rig" count={asks.length} tone="rigs">
          <div className="p-2 empty:hidden"><ChannelStrip state={state} machine={machine} /></div>
          {asks.map(a => {
            const who = whoOf(a);
            return (
              <Line
                key={a.id} href={href({ name: 'ask', id: a.id })} stale={offline} selected={route.name === 'ask' && route.id === a.id}
                title={<>{a.priority !== 'routine' && <><Pill tone="urgent">{copy.asks.priority[a.priority]}</Pill> </>}<b className="font-semibold">{who.name}</b>{a.from.rig ? ` · ${a.from.rig}` : ''}</>}
                sub={a.summary} meta={clock(a.updatedAt)}
              >
                <span className="sr-only">{copy.asks.pill[pillOf(a)]}</span>
              </Line>
            );
          })}
        </Box>
      )}
      {working.length > 0 && (
        <Box title={copy.atoi.working} dot="work" count={working.length}>
          {working.slice(0, WORKING_MAX).map(s => {
            const ctx = indicators(s, now, threshold).context;
            return (
              <Line
                key={s.id} href={href({ name: 'thread', sessionId: s.id })} stale={offline}
                lead={<RuntimeTag tool={s.tool} />}
                title={<><b className="font-semibold">{s.name}</b>{s.rig && <span className="text-small text-muted"> {s.rig.name}</span>}</>}
                sub={doingLine(s)}
                {...(ctx ? { meta: `${ctx.pct} %`, metaWarn: ctx.near } : {})}
              />
            );
          })}
          {working.length > WORKING_MAX && (
            <a href={href({ name: 'sessions' })} className="flex min-h-11 items-center gap-1 px-3 text-[13px] font-medium text-muted">{copy.atoi.more(working.length - WORKING_MAX)}<Icon name="chevron" className="size-4" /></a>
          )}
        </Box>
      )}
      {offline && <p className="text-small text-muted">{copy.inbox.offlineNote}</p>}
    </TabPage>
  );
}
