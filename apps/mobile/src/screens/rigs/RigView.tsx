import { useEffect, useState, type ReactNode } from 'react';
import type { HumanAsk, OpenRigAction, PhoneOpenRigState, PhoneSession, RigGraph, RigGraphSeat } from '@ledge/protocol';
import { copy } from '../../copy';
import { ageLabel, requestsOf } from '../../model/requests';
import {
  SEAT_DOT, closedTone, newestFirst, parseRigTime, permLevelOf, podsOf, rigStatus, rowTone, runRig, seatName, seatState, sessionOfSeat, STATUS_TONE, toolOf, topSeat,
  type RigStatus, type RowTone
} from '../../model/rigs';
import { href, navigate } from '../../router';
import { LinkStrip, hostName, useShell } from '../../shell/Shell';
import type { QueueData, Read, RigsStore } from '../../state/rigs';
import { useRigs } from '../../state/rigs';
import { useMobile, type MobileStore } from '../../state/store';
import { iconButtonClass } from '../../ui/Button';
import { BackLink } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { Dot, Pill, RuntimeTag } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { clock } from '../Inbox';
import { Chip, Frame, HoldBar, IconLabel, Lbl, Opt, ReadFail, Strip, Tile, rigButtonClass, useLongPress } from './kit';
import { RunNote, isRunning, lastRun } from './runs';
import { MoreSheet, PermissionsSheet, ReseatForm, ReseatSheet, SeatSettingsSheet, SeatSheet, SnapshotList, SnapshotsSheet, StopSheet, snapWhen } from './sheets';

/*
 * A rig (m4-rigs.html, §3 to §7): its status in the head, the tiles (seats, permissions, last snapshot), the seat that waits, the
 * topology by pod, the OpenRig queue, then the actions at the bottom (± seats, restart, stop; start alone when it is stopped).
 * Offline, everything stays readable and nothing is sent.
 */

const C = copy.rigs;
type Rig = PhoneOpenRigState['rigs'][number];
type Open = { kind: 'more' | 'stop' | 'restart' | 'reseat' | 'permissions' | 'snapshots' } | { kind: 'seat' | 'settings'; id: string } | null;

/** OpenRig's UTC time as an ISO one, for the ages and clocks of the queue. */
export const iso = (t: string): string => parseRigTime(t)?.toISOString() ?? t;

const TONE_CLASS: Record<RowTone, string> = {
  mine: 'border-attention/50 text-attention', progress: 'border-info/45 text-info', pending: 'border-input text-muted', blocked: 'border-approval/45 text-approval'
};

const RowChip = ({ tone }: { tone: RowTone }) =>
  <span data-row={tone} className={`flex-none rounded-[5px] border px-1.5 text-[11px] leading-[18px] whitespace-nowrap ${TONE_CLASS[tone]}`}>{C.queue.tone[tone]}</span>;

const who = (address: string): string => address.split('@')[0] ?? address;

/**
 * A node of the topology: its dot, its name, its harness when it differs from the lead's, and its state and context in words. The kernel
 * names its operator Max (`name`) and writes only what is not idle (`words`).
 */
export function Node({ seat, state, pod, tag, near, isNew, pulse, onOpen, onMore, top = false, name: given, words: givenWords }: {
  seat: RigGraphSeat; state: ReturnType<typeof seatState>; pod?: string | undefined; tag: boolean; near: number; isNew: boolean; pulse: boolean; onOpen?: (() => void) | undefined; top?: boolean;
  /** Wide (Q74): a long press or a right click opens the seat's sheet, the tap its session. */
  onMore?: (() => void) | undefined;
  name?: string; words?: string;
}) {
  const { swallow, ...press } = useLongPress(onMore);
  const name = given ?? seatName(seat.logicalId, seat.session);
  const tool = toolOf(seat.runtime);
  const ctx = seat.context !== undefined && state !== 'off' && state !== 'waiting' ? Math.round(seat.context) : null;
  const words = givenWords ?? [top ? pod : undefined, C.seatState[state]].filter(Boolean).join(' · ');
  const border = isNew ? 'border-ok/55' : state === 'ask' ? 'border-attention/55' : state === 'perm' ? 'border-approval/55' : state === 'off' || state === 'waiting' ? 'border-dashed border-input bg-transparent' : 'border-line';
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <Dot state={SEAT_DOT[state]} pulse={pulse} />
        <b className={`truncate text-[13px] font-semibold ${state === 'off' ? 'text-muted' : ''}`}>{name}</b>
        {isNew ? <span className="ml-auto"><Pill tone="ok">{C.reseat.new}</Pill></span> : tag && tool && <span className="ml-auto"><RuntimeTag tool={tool} /></span>}
      </span>
      <small className={`truncate text-[11.5px] ${state === 'ask' ? 'text-attention' : 'text-muted'}`}>
        {words}{ctx !== null && <>{words ? ' · ' : ''}<span className={`font-mono ${ctx >= near ? 'text-attention' : ''}`}>{`${ctx} %`}</span></>}
      </small>
    </>
  );
  const className = `flex min-w-0 flex-col gap-px rounded-[9px] border bg-surface px-[9px] py-[7px] text-left ${border} ${top ? 'w-[190px] max-w-full' : ''}`;
  return onOpen
    ? <button type="button" {...press} onClick={() => { if (!swallow?.()) onOpen(); }} aria-label={C.seatLabel(name, C.seatState[state])} data-seat={seat.logicalId} className={className}>{body}</button>
    : <div data-seat={seat.logicalId} className={className}>{body}</div>;
}

/** The topology from `rigs.graph`: the lead alone on top, then the pods side by side, each node opening its seat's sheet. */
function Topology({ graph, rig, status, sessions, near, added, onSeat, wide = false }: {
  graph: RigGraph; rig: Rig; status: RigStatus; sessions: PhoneSession[]; near: number; added: readonly string[]; onSeat?: ((id: string) => void) | undefined;
  /** Q74: wide, a tap opens the seat's session (« appuie sur un siège : son fil »), its sheet on a long press; a seat Ledge does not follow opens its sheet. */
  wide?: boolean;
}) {
  const topId = topSeat(graph.seats, graph.links);
  const top = graph.seats.find(s => s.logicalId === topId);
  const pods = podsOf(graph.seats.filter(s => s.logicalId !== topId), graph.pods);
  const leadRuntime = top?.runtime ?? graph.seats[0]?.runtime;
  const node = (s: RigGraphSeat, isTop = false) => {
    const session = sessionOfSeat(sessions, rig.name, s.logicalId);
    const state = seatState({ session, node: rig.nodes.find(n => n.logicalId === s.logicalId), graph: s, rigStatus: status });
    const pod = graph.pods.find(p => p.id === s.pod)?.label ?? s.pod;
    const sheet = onSeat ? () => onSeat(s.logicalId) : undefined;
    const thread = wide && session ? () => navigate({ name: 'thread', sessionId: session.id }) : undefined;
    return (
      <Node
        key={s.logicalId} seat={s} state={state} pod={pod} top={isTop} near={near} isNew={added.includes(s.logicalId)}
        tag={isTop || s.runtime !== leadRuntime} pulse={state === 'starting' || (status === 'starting' && state === 'work')}
        onOpen={thread ?? sheet} onMore={thread ? sheet : undefined}
      />
    );
  };
  return (
    <div className="flex flex-col items-center">
      {top && <>{node(top, true)}<span aria-hidden="true" className="h-3 w-[1.5px] bg-input" /></>}
      <div className={`grid w-full gap-2 ${pods.length >= 3 ? 'grid-cols-3' : pods.length === 1 && !top ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {pods.map(p => (
          <div key={p.id} className="flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-dashed border-input p-1.5">
            <small className="px-0.5 font-mono text-[10.5px] text-muted">{p.label}</small>
            {p.seats.map(s => node(s))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One open row, unfolded (Q42): read only, its from and to, what it waits on, when it was made and taken. */
function RowDetail({ row, mine }: { row: QueueData['rows'][number]; mine: boolean }) {
  const kv: [string, string][] = [
    [C.queue.from, `${who(row.from)} → ${who(row.to)}`],
    ...(row.blockedOn ? [[C.queue.blockedOn, row.blockedOn] as [string, string]] : []),
    [C.queue.created, [clock(iso(row.createdAt)), row.claimedAt ? C.queue.claimed(clock(iso(row.claimedAt))) : ''].filter(Boolean).join(' · ')]
  ];
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-raised/40 px-3 py-2.5 last:border-b-0">
      <span className="font-mono text-[12px] text-muted">{row.id}</span>
      {row.summary && <b className="text-[14px] font-semibold">{row.summary}</b>}
      <dl className="m-0 grid grid-cols-[90px_1fr] gap-x-3 gap-y-1 text-[13px]">
        {kv.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="m-0 [overflow-wrap:anywhere]">{v}</dd></div>)}
      </dl>
      <span className="text-[12px] leading-4 text-muted">{C.queue.readOnly}</span>
      {mine && <a href={href({ name: 'atoi' })} className={rigButtonClass({ size: 'sm', className: 'self-start' })}>{C.queue.seeAtoi}</a>}
    </div>
  );
}

/** The OpenRig queue of this rig: the open rows, newest first, each unfolding; then the closed ones, folded. */
function Queue({ read, asks, now, retry }: { read: Read<QueueData> | undefined; asks: readonly HumanAsk[] | null; now: number; retry: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const data = read?.data;
  if (!data) {
    return (
      <Frame>{read?.error ? <ReadFail retry={retry} retryLabel={C.unavailable.retry}>{C.queue.unavailable}</ReadFail> : <p role="status" className="p-3 text-[13px] text-muted">{C.loading}</p>}</Frame>
    );
  }
  const MARK = { done: <span className="text-ok">✓</span>, handed: <span className="text-muted">↪</span>, stopped: <span className="text-approval">✕</span> };
  return (
    <>
      <Lbl>{C.queue.title(data.rows.length)}</Lbl>
      <Frame>
        {data.rows.length === 0 && <p className="p-3 text-[13px] text-muted">{C.queue.none}</p>}
        {data.rows.map(row => {
          const tone = rowTone(row, asks);
          const unfolded = open === row.id;
          return (
            <div key={row.id} className="contents">
              <button type="button" aria-expanded={unfolded} onClick={() => setOpen(unfolded ? null : row.id)} className="flex min-h-[46px] w-full items-center gap-[9px] border-b border-line px-3 py-1.5 text-left text-[13px] last:border-b-0">
                <RowChip tone={tone} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{row.summary ?? row.id}</span>
                  <small className="truncate text-[11.5px] text-muted">{[`${who(row.from)} → ${who(row.to)}`, row.needsInput ? C.queue.prompt : ''].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="font-mono text-[11px] whitespace-nowrap text-muted">{ageLabel(iso(row.updatedAt), now)}</span>
              </button>
              {unfolded && <RowDetail row={row} mine={tone === 'mine'} />}
            </div>
          );
        })}
        {data.closed.length > 0 && (
          <button type="button" aria-expanded={closed} onClick={() => setClosed(!closed)} className="flex min-h-[46px] w-full items-center gap-[9px] border-t border-line px-3 text-left text-[13px] text-muted first:border-t-0">
            <Icon name="chevron" className={`size-3.5 transition-transform ${closed ? 'rotate-90' : ''}`} /><span>{C.queue.closed(data.closed.length)}</span>
          </button>
        )}
        {closed && data.closed.map(row => {
          const t = closedTone(row.state);
          return (
            <div key={row.id} className="flex min-h-[46px] items-center gap-[9px] border-t border-line px-3 py-1.5 text-[13px] text-muted">
              <span aria-hidden="true">{MARK[t]}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-fg">{row.summary ?? row.id}</span>
                <small className="truncate text-[11.5px]">{`${who(row.from)} → ${who(row.to)} · ${C.queue.closedTone[t]}`}</small>
              </span>
              <span className="font-mono text-[11px]">{clock(iso(row.updatedAt))}</span>
            </div>
          );
        })}
      </Frame>
      {data.truncated && <p className="text-[12px] leading-4 text-muted">{C.queue.truncated}</p>}
    </>
  );
}

/** The band of the seat that waits on the person, with « Voir ». */
function Waits({ rig, sessions, asks }: { rig: string; sessions: PhoneSession[]; asks: readonly HumanAsk[] | null }) {
  const mine = sessions.filter(s => s.rig?.name === rig);
  const items = requestsOf(mine);
  const item = items.find(i => i.filter === 'permission') ?? items[0];
  const s = item ? mine.find(x => x.id === item.sessionId) : undefined;
  const ask = !item ? asks?.find(a => a.from.rig === rig && a.kind !== 'update') : undefined;
  if (!item && !ask) return null;
  const seat = s ? (s.rig?.role ? seatName(s.rig.role) : s.name) : ask ? who(ask.from.seat) : '';
  const perm = item?.filter === 'permission';
  const [pre, name, post] = perm ? C.waits.permission(seat) : C.waits.question(seat);
  const to = item ? href({ name: 'request', sessionId: item.sessionId, key: item.key }) : href({ name: 'atoi' });
  return (
    <Strip warn={!perm} danger={perm} compact lead={<Dot state={perm ? 'perm' : 'ask'} />} action={<a href={to} className={rigButtonClass({ size: 'xs' })}>{C.waits.see}</a>}>
      <span>{pre}<b className="font-semibold">{name}</b>{post}</span>
    </Strip>
  );
}

/** A rig of the Rigs tab, by its name (`#/rigs/<rig>`). Wide (§10): its actions in the pane's head, two columns. */
export function RigView({ rig, rigs, store }: { rig: string; rigs: RigsStore; store: MobileStore }) {
  const r = useRigs(rigs);
  const m = useMobile(store);
  const { pc, look } = useShell();
  const wide = useWide();
  const [sheet, setSheet] = useState<Open>(null);
  const [resume, setResume] = useState<'last' | 'fresh'>('last');
  const live = m.fresh;
  const offline = look === 'offline';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    rigs.follow();
    if (live) { rigs.openRig(rig); rigs.readSnapshots(rig); }
  }, [rigs, rig, live]);

  const name = hostName(pc);
  const state = r.state;
  const it = state?.rigs.find(x => x.name === rig);
  const graph = r.graphs[rig];
  const perms = r.permissions[rig];
  const snaps = r.snapshots[rig];
  const queue = r.queues[rig];
  const sessions = [...m.sessions.values()];
  const near = m.device?.contextNear ?? 70;
  const confirm = !!m.device?.confirm;
  const run = lastRun(r.runs, x => runRig(x.subject) === rig);
  const busy = isRunning(run);
  const act = (a: OpenRigAction) => { void rigs.act(a); };
  const reseat = (seats: Record<string, number>, delegation: 'pairs' | 'all' | undefined) => { void rigs.reseat(rig, seats, delegation ? { delegation } : {}); };
  const close = () => setSheet(null);
  const reopen = () => rigs.openRig(rig);
  const more = (
    <button type="button" aria-label={C.more} title={C.more} aria-haspopup="menu" onClick={() => setSheet({ kind: 'more' })} className={iconButtonClass()}>
      <Icon name="more" />
    </button>
  );

  const header = (chip: ReactNode, sub?: string, actions?: ReactNode) => wide
    ? (
      <header className="pane-head flex h-[58px] flex-none items-center gap-2 border-b border-line pr-1.5">
        <BackLink fallback={{ name: 'rigs' }} label={C.back} />
        <h1 className="min-w-0 truncate text-[17px] font-semibold">{rig}</h1>
        {chip}
        {sub && <span className="min-w-0 truncate text-[12.5px] text-muted">{sub}</span>}
        <span className="flex-1" />
        {actions}
        {it && more}
      </header>
    )
    : (
      <header className="flex h-14 flex-none items-center gap-2 border-b border-line pr-1.5 pl-0.5">
        <BackLink fallback={{ name: 'rigs' }} label={C.back} />
        <h1 className="min-w-0 truncate text-base font-semibold">{rig}</h1>
        {chip}
        <span className="flex-1" />
        {it && more}
      </header>
    );
  const scroll = `tab-main flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[18px] ${wide ? 'pt-[18px]' : 'pt-3'}`;

  // A rig gone from the PC takes the whole screen, as a session gone (m4-complement.html, §2).
  const gone = !!state && (!it || graph?.error === 'unknown_rig' || queue?.error === 'unknown_rig');
  if (gone) {
    return (
      <>
        {header(null)}
        <main data-tab-scroll="" className={scroll}>
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <h2 className="text-[17px] font-semibold">{C.readError.unknown_rig}</h2>
            <a href={href({ name: 'rigs' })} className={rigButtonClass({ size: 'sm', className: 'mt-1.5' })}>{C.back}</a>
          </div>
        </main>
      </>
    );
  }
  if (!it) {
    const why = r.error ? C.readError[r.error] : null;
    return (
      <>
        {header(null)}
        <main data-tab-scroll="" className={scroll}>
          <LinkStrip body={C.offlineBody} />
          {why
            ? <Strip warn role="alert" lead={<Icon name="warning" className="mt-px size-4 text-attention" />}><b className="font-semibold">{why}</b></Strip>
            : <p role="status" className="text-[13px] text-muted">{C.loading}</p>}
        </main>
      </>
    );
  }

  const status = rigStatus(it);
  const stopped = status === 'stopped';
  const perm = perms?.data ? permLevelOf(perms.data.seats) : null;
  const level = perm ? C.level[perm] : null;
  const newest = newestFirst(snaps?.data ?? [])[0];
  const snapShort = newest ? snapWhen(newest.createdAt).short : it.snapshot || '';
  const added = run?.phase === 'done' && run.reseated?.ok ? run.reseated.added : [];
  const stoppedSeats = it.nodes.filter(n => n.stopped).map(n => seatName(n.logicalId, n.session));
  const seatOf = (id: string) => graph?.data?.seats.find(s => s.logicalId === id);
  const start = () => act(resume === 'fresh'
    ? { kind: 'rig.start', rig, fresh: (graph?.data?.seats.map(s => s.logicalId) ?? it.nodes.map(n => n.logicalId)) as [string, ...string[]] }
    : { kind: 'rig.start', rig });
  const ended = run && !busy ? run : undefined;
  const can = live && !busy;

  // The rig's actions: at the bottom on a phone (start alone when it is stopped), in the pane's head on a wide screen.
  const btn = wide ? 'sm' as const : 'md' as const;
  const barClass = wide ? '' : '!h-[42px] !px-2 !text-[13.5px]';
  const startBtn = <button type="button" disabled={!can} onClick={start} className={rigButtonClass({ tone: 'primary', size: btn, className: wide ? '' : '!h-[42px]' })}><IconLabel icon="power">{C.actions.start}</IconLabel></button>;
  const restartBtn = <button type="button" disabled={!can} onClick={() => setSheet({ kind: 'restart' })} className={rigButtonClass({ size: btn, className: barClass })}><IconLabel icon="refresh">{C.actions.restart}</IconLabel></button>;
  const stopBtn = <button type="button" disabled={!can} onClick={() => setSheet({ kind: 'stop' })} className={rigButtonClass({ tone: 'danger', size: btn, className: barClass })}><IconLabel icon="power">{C.actions.stop}</IconLabel></button>;
  const seatsBtn = <button type="button" disabled={!can} onClick={() => setSheet({ kind: 'reseat' })} className={rigButtonClass({ size: btn, className: barClass })}><IconLabel icon="plus">{C.actions.seats}</IconLabel></button>;
  const going = busy ? <RunNote run={run!} rigs={rigs} pc={name} bar={!wide} /> : status === 'starting' ? <HoldBar bar={!wide}>{C.startingSeats(rig, it.running, it.seats)}</HoldBar> : null;
  const bar = going ?? (
    <div className={`bleed grid flex-none gap-2 border-t border-line bg-bg px-3.5 pt-2.5 pb-3 ${stopped ? 'grid-cols-1' : 'grid-cols-3'}`}>
      {stopped ? startBtn : <>{seatsBtn}{restartBtn}{stopBtn}</>}
    </div>
  );

  const waits = live && <Waits rig={rig} sessions={sessions} asks={m.asks} />;
  const partial = status === 'partial' && stoppedSeats.length > 0 && (
    <Strip warn lead={<Icon name="warning" className="mt-px size-4 text-attention" />}>
      <span>{C.partial(stoppedSeats, it.nodes.length - stoppedSeats.length)}</span>
      <button type="button" disabled={!can} onClick={() => setSheet({ kind: 'restart' })} className={rigButtonClass({ size: 'sm', className: 'self-start' })}>{C.actions.restartRig}</button>
    </Strip>
  );
  const topology = (
    <>
      <Lbl aside={stopped ? C.topologyStopped : graph?.data ? C.topologyHint : undefined}>{C.topology}</Lbl>
      {graph?.data
        ? <Topology graph={graph.data} rig={it} status={status} sessions={sessions} near={near} added={added} onSeat={id => setSheet({ kind: 'seat', id })} wide={wide} />
        : <Frame>{graph?.error ? <ReadFail retry={reopen} retryLabel={C.unavailable.retry}>{C.readError[graph.error]}</ReadFail> : <p role="status" className="p-3 text-[13px] text-muted">{C.loading}</p>}</Frame>}
    </>
  );
  const resumeOpts = stopped && it.snapshot && (
    <>
      <Lbl>{C.resume}</Lbl>
      <div className="flex flex-col gap-1.5">
        <Opt pressed={resume === 'last'} disabled={!live} onClick={() => setResume('last')} title={C.resumeLast(newest ? snapWhen(newest.createdAt).long : it.snapshot)} sub={C.resumeLastBody} />
        <Opt pressed={resume === 'fresh'} disabled={!live} onClick={() => setResume('fresh')} title={C.fresh} sub={C.freshBody} />
      </div>
    </>
  );
  const queueBlock = <Queue read={queue} asks={m.asks} now={now} retry={reopen} />;

  const body = wide
    ? (
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] content-start gap-[18px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {waits}{partial}{topology}
          {!stopped && status !== 'starting' && (
            <>
              <Lbl>{C.seatsByRole}</Lbl>
              <Frame><div className="flex flex-col gap-2.5 px-3 py-1"><ReseatForm key={it.nodes.length} rig={it} confirm={confirm} live={can} onReseat={reseat} context={Object.fromEntries((graph?.data?.seats ?? []).map(s => [s.logicalId, s.context]))} /></div></Frame>
            </>
          )}
          {resumeOpts}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {queueBlock}
          <Lbl>{C.actions.snapshots}</Lbl>
          <SnapshotList read={snaps} kindOnly retry={() => rigs.readSnapshots(rig)} />
          <button type="button" disabled={!can} onClick={() => act({ kind: 'rig.snapshot', rig })} className={rigButtonClass({ size: 'sm', className: 'self-start' })}><IconLabel icon="camera">{C.snapshots.take}</IconLabel></button>
        </div>
      </div>
    )
    : (
      <>
        <div className="grid grid-cols-3 gap-2">
          <Tile label={C.tiles.seats} value={`${it.running}/${it.seats}`} />
          <Tile label={C.tiles.permissions} value={level ?? '—'} onOpen={() => setSheet({ kind: 'permissions' })} />
          <Tile label={C.tiles.snapshot} value={snapShort || '—'} onOpen={() => setSheet({ kind: 'snapshots' })} />
        </div>
        {waits}{partial}{topology}{queueBlock}{resumeOpts}
      </>
    );

  const seatSheet = sheet?.kind === 'seat' || sheet?.kind === 'settings' ? seatOf(sheet.id) : undefined;
  const node = seatSheet ? it.nodes.find(n => n.logicalId === seatSheet.logicalId) : undefined;
  const sub = [C.seats(it.running, it.seats), level ?? '', snapShort ? C.snapshot(snapShort) : ''].filter(Boolean).join(' · ');

  return (
    <>
      {header(<Chip tone={STATUS_TONE[status]}>{C.status[status]}</Chip>, sub, !going && (stopped ? startBtn : <>{restartBtn}{stopBtn}</>))}
      <main data-tab-scroll="" className={scroll}>
        <LinkStrip body={C.offlineBody} />
        {wide && going}
        {ended && <RunNote run={ended} rigs={rigs} pc={name} />}
        <div className={`flex flex-col gap-3 ${offline ? 'opacity-50' : ''}`}>{body}</div>
      </main>
      {!wide && bar}
      {sheet?.kind === 'more' && (
        <MoreSheet
          rig={rig} live={live} running={busy} snapshots={snaps?.data ? snaps.data.length : null} level={level} onClose={close}
          onSnapshot={() => { close(); act({ kind: 'rig.snapshot', rig }); }} onSnapshots={() => setSheet({ kind: 'snapshots' })}
          onPermissions={() => setSheet({ kind: 'permissions' })} onRefresh={() => { close(); rigs.retry(); rigs.openRig(rig); rigs.readSnapshots(rig); }}
        />
      )}
      {(sheet?.kind === 'stop' || sheet?.kind === 'restart') && <StopSheet rig={it} pc={name} verb={sheet.kind} confirm={confirm} live={can} onAct={act} onClose={close} />}
      {sheet?.kind === 'reseat' && <ReseatSheet rig={it} pc={name} confirm={confirm} live={can} onReseat={reseat} onClose={close} />}
      {sheet?.kind === 'permissions' && <PermissionsSheet rig={it} read={perms} level={perm} confirm={confirm} live={can} onAct={act} onClose={close} />}
      {sheet?.kind === 'snapshots' && <SnapshotsSheet rig={rig} read={snaps} live={live} running={busy} onSnapshot={() => act({ kind: 'rig.snapshot', rig })} onRetry={() => rigs.readSnapshots(rig)} onClose={close} />}
      {sheet?.kind === 'seat' && seatSheet && graph?.data && (
        <SeatSheet
          rig={rig} seat={seatSheet} graph={graph.data} node={node} session={sessionOfSeat(sessions, rig, seatSheet.logicalId)} status={status} near={near}
          onSettings={() => setSheet({ kind: 'settings', id: seatSheet.logicalId })} onClose={close}
        />
      )}
      {sheet?.kind === 'settings' && seatSheet && (
        <SeatSettingsSheet
          rig={rig} seat={seatSheet} node={node} selection={perms?.data?.seats.find(s => s.logicalId === seatSheet.logicalId)?.selection}
          confirm={confirm} live={can} onAct={act} onClose={close}
        />
      )}
    </>
  );
}
