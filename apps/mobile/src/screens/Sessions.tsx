import { useEffect, useState } from 'react';
import { CONTEXT_NEAR, type PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { MOBILE_STORAGE_PREFIX } from '../link/keys';
import { closingHere } from '../model/sessionEnd';
import { activeHelpers, contextPct, dotOf, filterCounts, GROUPINGS, rowLine, rowMeta, SESSION_FILTERS, sessionGroups, type Grouping, type SessionFilter, type SessionGroup } from '../model/sessions';
import { href, useRoute } from '../router';
import { TabPage } from '../shell/Shell';
import { localStore } from '../state/storage';
import { useMobile, type MobileStore } from '../state/store';
import { Icon } from '../ui/icons';
import { Box, EmptyState, Line } from '../ui/kit/Box';
import { kitButtonClass } from '../ui/kit/Controls';
import { Dot, RuntimeTag } from '../ui/kit/marks';
import { useWide } from '../ui/layout';
import { useNow } from '../useNow';
import { clock } from './Inbox';
import { useLongPress } from './longPress';
import { SessionActions } from './SessionHead';
import { SessionsAtelier } from './SessionsAtelier';

/** The filter is kept on the device (m2-sessions.html, « Comportements »). */
const FILTER_KEY = `${MOBILE_STORAGE_PREFIX}sessions.filter`;
const isFilter = (v: unknown): v is SessionFilter => SESSION_FILTERS.includes(v as SessionFilter);

function useFilter(fromRoute: SessionFilter | undefined, storage?: Storage): [SessionFilter, (f: SessionFilter) => void] {
  const store = localStore(storage);
  const [filter, set] = useState<SessionFilter>(() => {
    if (fromRoute) return fromRoute;
    try { const v = store?.getItem(FILTER_KEY); return isFilter(v) ? v : 'all'; } catch { return 'all'; }
  });
  const choose = (f: SessionFilter) => {
    set(f);
    try { store?.setItem(FILTER_KEY, f); } catch { /* kept for this visit only */ }
  };
  // « Voir les N autres » in « À toi » opens the list on « Au travail », even when it is already shown.
  useEffect(() => { if (fromRoute) choose(fromRoute); }, [fromRoute]); // eslint-disable-line react-hooks/exhaustive-deps
  return [filter, choose];
}

/** A choice kept on the device (Comportements: the filter, Liste / Atelier; §7: the grouping and the eye). */
function useKept<T extends string>(key: string, values: readonly T[], fallback: T, storage?: Storage): [T, (v: T) => void] {
  const store = localStore(storage);
  const [value, set] = useState<T>(() => {
    try { const v = store?.getItem(`${MOBILE_STORAGE_PREFIX}${key}`); return values.includes(v as T) ? v as T : fallback; } catch { return fallback; }
  });
  const choose = (v: T) => { set(v); try { store?.setItem(`${MOBILE_STORAGE_PREFIX}${key}`, v); } catch { /* kept for this visit only */ } };
  return [value, choose];
}

type Mode = 'list' | 'atelier';
const MODES: readonly Mode[] = ['list', 'atelier'];

/** « Liste · Atelier » on the title's line, on a phone (§1, §7). */
function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const M = copy.sessions.mode;
  return (
    <div role="group" aria-label={M.label} className="flex flex-none overflow-hidden rounded-lg border border-input">
      {MODES.map(m => (
        <button key={m} type="button" aria-pressed={m === value} onClick={() => onChange(m)}
          className="grid h-9 place-items-center px-3.5 text-[13px] font-medium text-muted aria-pressed:bg-raised aria-pressed:text-fg">
          {M[m]}
        </button>
      ))}
    </div>
  );
}

/** « Toutes · En attente · Au travail », each with its count, across the list's width (§1). */
function FilterBar({ value, counts, onChange }: { value: SessionFilter; counts: Record<SessionFilter, number>; onChange: (f: SessionFilter) => void }) {
  const F = copy.sessions.filter;
  return (
    <div role="group" aria-label={F.label} className="flex flex-none rounded-lg border border-input p-0.5">
      {SESSION_FILTERS.map(f => (
        <button
          key={f} type="button" aria-pressed={f === value} onClick={() => onChange(f)}
          className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap text-muted aria-pressed:bg-raised aria-pressed:text-fg"
        >
          {F[f]}<span className="font-mono text-meta">{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}

/** One session (§1): its dot, runtime, name and sub-agents at work, what it does or waits for, its branch or seat role. */
function Row({ session: s, filter, offline, threshold, now, closing, pressed, onPress }: { session: PhoneSession; filter: SessionFilter; offline: boolean; threshold: number; now: number; closing: boolean; pressed: boolean; onPress: (s: PhoneSession) => void }) {
  const route = useRoute();
  const press = useLongPress(() => onPress(s));
  const open = (route.name === 'thread' || route.name === 'terminal') && route.sessionId === s.id;
  const dot = dotOf(s);
  const kids = activeHelpers(s);
  const pct = contextPct(s);
  // Under « Au travail » the right side gives the context, the line what the agent does (§1, second board).
  const meta = filter === 'working' ? (pct === undefined ? undefined : `${pct} %`) : rowMeta(s);
  return (
    <Line
      href={href({ name: 'thread', sessionId: s.id })} selected={open} stale={offline} press={press} pressed={pressed}
      lead={<><Dot state={dot} pulse={dot === 'work' && !offline} /><RuntimeTag tool={s.tool} /></>}
      title={<>
        <b className="font-semibold">{s.name}</b>
        {kids > 0 && <span aria-label={copy.sessions.kidsLabel(kids)} className="ml-1.5 font-mono text-small text-muted">{copy.sessions.kids(kids)}</span>}
      </>}
      // A close this phone sent says so over the state, as the list always did, until the session ends.
      sub={closing ? <span className="text-attention">{copy.chat.closing}</span> : <span className={dot === 'ask' ? 'text-attention' : undefined}>{rowLine(s, filter, now)}</span>}
      {...(dot === 'perm' ? { subTone: 'perm' as const } : {})}
      {...(meta !== undefined ? { meta, metaWarn: filter === 'working' && pct !== undefined && pct / 100 >= threshold } : {})}
    />
  );
}

function Group({ group, children }: { group: SessionGroup; children: React.ReactNode }) {
  const rig = group.kind === 'rig';
  const title = rig ? copy.sessions.rigGroup(group.name) : group.name;
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-0.5 text-small font-semibold text-muted">
        {rig && <Dot state="rig" />}{title}<span className="font-normal">{group.sessions.length}</span>
      </div>
      <Box {...(rig ? { tone: 'rigs' as const } : {})}>{children}</Box>
    </section>
  );
}

/**
 * « Sessions » (docs/mockups/ledge-mobile-refonte/m2-sessions.html §1, Q24, Q25): every session of the PC, filtered (Toutes,
 * En attente, Au travail), grouped by project then by rig; a row opens the session's thread.
 */
export function Sessions({ store, filter: fromRoute, storage }: { store: MobileStore; filter?: SessionFilter | undefined; storage?: Storage }) {
  const state = useMobile(store);
  const now = useNow();
  const [filter, setFilter] = useFilter(fromRoute, storage);
  const wide = useWide();
  const [mode, setMode] = useKept<Mode>('sessions.mode', MODES, 'list', storage);
  const [by, setBy] = useKept<Grouping>('sessions.groupBy', GROUPINGS, 'projects', storage);
  const [helpers, setHelpers] = useKept<'shown' | 'hidden'>('sessions.helpers', ['shown', 'hidden'], 'shown', storage);
  // A long press's session (§8): its actions' sheet is open, its seat or row ringed.
  const [pressed, setPressed] = useState<string | null>(null);
  const pressedSession = pressed ? state.sessions.get(pressed) : undefined;
  // The Atelier in islands is the phone's; a tablet keeps its drawn Atelier (§10).
  const atelier = !wide && mode === 'atelier';
  const sessions = [...state.sessions.values()];
  const counts = filterCounts(sessions);
  const groups = sessionGroups(sessions, filter);
  const offline = !state.fresh;
  const threshold = state.device?.contextNear ?? CONTEXT_NEAR;
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.agents.offline) : undefined;

  // « Nouvelle » (§1, §10): the screen opens even when the PC cannot launch; its button then says why (m2-lancement.html §1).
  const newButton = <a href={href({ name: 'launch' })} className={kitButtonClass({ variant: 'primary', size: 'sm', className: 'flex-none' })}><Icon name="plus" className="size-4" />{copy.sessions.new}</a>;
  const seeButton = (to: SessionFilter, label: string) => <button type="button" onClick={() => setFilter(to)} className={kitButtonClass({ size: 'xs' })}>{label}</button>;
  const S = copy.sessions;
  // A filter with nothing in it says so and leads on (§1; « Au travail »: m2-vides.html, Q70).
  const emptyFilter = groups.length === 0 && sessions.length > 0 && (
    <Box label={S.filter[filter]}>
      {filter === 'waiting'
        ? <EmptyState framed={false} glyph={null} title={S.filterEmpty} body={S.filterEmptyBody(counts.working)} action={seeButton('all', S.seeAll)} />
        : counts.waiting > 0
          ? <EmptyState framed={false} glyph={null} title={S.emptyWorking.title} body={S.emptyWorking.waiting(counts.waiting)} action={seeButton('waiting', S.seeWaiting)} />
          : <EmptyState framed={false} glyph={null} title={S.emptyWorking.title} body={S.emptyWorking.idle} action={seeButton('all', S.seeAll)} />}
    </Box>
  );

  return (
    <TabPage
      title={copy.agents.title} subtitle={subtitle} bodyClassName="flex flex-col gap-2.5"
      actions={wide ? undefined : <><ModeToggle value={mode} onChange={setMode} />{newButton}</>} wideActions={wide ? newButton : undefined}
    >
      {pressedSession && <SessionActions store={store} session={pressedSession} onDone={() => setPressed(null)} />}
      {sessions.length === 0 ? (
        <Box label={copy.agents.empty}>
          <EmptyState list glyph={<Icon name="sessions" />} title={copy.agents.empty} body={copy.agents.emptyHint}
            action={<a href={href({ name: 'launch' })} className={kitButtonClass({ variant: 'primary', size: 'sm' })}><Icon name="plus" className="size-4" />{copy.sessions.newSession}</a>} />
        </Box>
      ) : atelier ? (
        <SessionsAtelier
          sessions={sessions} by={by} onBy={setBy} helpers={helpers === 'shown'} onHelpers={() => setHelpers(helpers === 'shown' ? 'hidden' : 'shown')}
          rigs={!!state.daemon?.rigs} pressed={pressed} onPress={s => setPressed(s.id)}
        />
      ) : (
        <>
          <FilterBar value={filter} counts={counts} onChange={setFilter} />
          {groups.map(g => (
            <Group key={g.id} group={g}>
              {g.sessions.map(s => <Row key={s.id} session={s} filter={filter} offline={offline} threshold={threshold} now={now} closing={closingHere(s, state.ops, now)} pressed={pressed === s.id} onPress={x => setPressed(x.id)} />)}
            </Group>
          ))}
          {emptyFilter}
        </>
      )}
    </TabPage>
  );
}
