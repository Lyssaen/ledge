import { useEffect, useState, type ReactNode } from 'react';
import { KERNEL_RIG, type OpenRigAction, type RigGraph, type RigGraphSeat } from '@ledge/protocol';
import { copy } from '../../copy';
import {
  attentionOf, changeOf, isOperator, kernelOf, kernelSeatName, listedRigs, permLevelOf, rigDot, rigStatus, seatState, workingSeats, type RigStatus
} from '../../model/rigs';
import { href } from '../../router';
import { LinkStrip, hostName, useShell } from '../../shell/Shell';
import { daemonAction, useDaemonPrefs } from '../../state/rigPrefs';
import { useRigs, type RigsStore } from '../../state/rigs';
import { useMobile, type MobileStore } from '../../state/store';
import { iconButtonClass } from '../../ui/Button';
import { BackLink } from '../../ui/Header';
import { Icon } from '../../ui/icons';
import { Dot, type DotState } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { clock } from '../Inbox';
import { GoalThread, ReplyField, maxAt, maxWord } from './Max';
import { Chip, Frame, IconLabel, Lbl, ReadFail, Strip, rigButtonClass } from './kit';
import { DaemonChoices, DaemonRow, KERNEL_TONE } from './RigsList';
import { Node, iso } from './RigView';
import { RunNote, isRunning, lastRun } from './runs';
import { ConfirmSheet, KernelMenuSheet } from './sheets';

/*
 * The kernel, OpenRig's own rig, and its daemon (m4-rigs.html, §8): the role in a sentence, the topology (Max, the advisor, the queue
 * worker), Max's last word and « Parler à Max », the rigs it drives, the queue's routing (newest first, Q43); then the kernel's and the
 * daemon's restart and stop (with the device's check) and the daemon's two start choices, kept on this phone (Q45). Wide (§10): Max's
 * current goal as a thread.
 */

const C = copy.rigs;
const K = C.kernelView;
type Sheet = 'menu' | 'kernel.restart' | 'kernel.stop' | 'daemon.restart' | 'daemon.stop' | null;

/** A queue row's id as Desktop shortens it in « attend la ligne …c8a66d5a »; any other word of OpenRig as it comes. */
const rowId = (on: string): string => (/^qitem-\d{14}-[0-9a-f]{8,}$/.test(on) ? `…${on.slice(-8)}` : on);

/** The kernel's topology, flat: Max on top, the other seats side by side under him (no pod boxes). */
function KernelTopology({ graph, status, near }: { graph: RigGraph; status: RigStatus; near: number }) {
  const m = graph.seats;
  const top = m.find(s => isOperator(s.logicalId));
  const rest = m.filter(s => s !== top);
  const leadRuntime = top?.runtime ?? m[0]?.runtime;
  const node = (s: RigGraphSeat, isTop = false) => {
    const state = seatState({ graph: s, rigStatus: status });
    const pod = graph.pods.find(p => p.id === s.pod)?.label ?? s.pod;
    const words = [isTop ? pod : '', state === 'idle' ? '' : C.seatState[state]].filter(Boolean).join(' · ');
    return (
      <Node
        key={s.logicalId} seat={s} state={state} pod={pod} top={isTop} near={near} isNew={false} name={kernelSeatName({ logicalId: s.logicalId, session: s.session ?? '' })}
        words={words} tag={isTop || s.runtime !== leadRuntime} pulse={state === 'starting'}
      />
    );
  };
  return (
    <div className="flex flex-col items-center">
      {top && <>{node(top, true)}<span aria-hidden="true" className="h-3 w-[1.5px] bg-input" /></>}
      <div className="grid w-full max-w-[420px] grid-cols-2 gap-2">{rest.map(s => node(s))}</div>
    </div>
  );
}

/** The queue's routing on the PC, every rig, newest first (Q43): « pilot-lead » a passé à design-ux. */
function Routing({ rigs }: { rigs: RigsStore }) {
  const read = useRigs(rigs).routing;
  const entries = read?.data ? [...read.data].reverse() : null;
  const words = (change: string): string => {
    const c = changeOf(change);
    if (c.verb === 'handed') return K.change.handed(c.to);
    if (c.verb === 'blocked') return K.change.blocked(rowId(c.on));
    if (c.verb === 'other') return c.text;
    return K.change[c.verb];
  };
  return (
    <>
      <Lbl aside={K.allRigs}>{K.routing}</Lbl>
      <Frame>
        {!entries
          ? read?.error ? <ReadFail retry={() => rigs.readRouting()} retryLabel={C.unavailable.retry}>{C.readError[read.error]}</ReadFail> : <p role="status" className="p-3 text-[13px] text-muted">{C.loading}</p>
          : entries.length === 0
            ? <ReadFail>{K.noRouting}</ReadFail>
            : entries.map((e, i) => (
              <div key={`${e.qitem}-${e.at}-${i}`} className="grid grid-cols-[44px_1fr] gap-x-2 border-b border-line px-3 py-2 text-[13px] leading-[18px] last:border-b-0">
                <span className="font-mono text-[11.5px] text-muted">{clock(iso(e.at))}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]"><b className="font-semibold">{K.actor(e.seat.split('@')[0] ?? e.seat)}</b> {words(e.change)}</span>
                <small className="col-start-2 truncate text-[11.5px] text-muted">{[e.rig, e.summary ?? ''].filter(Boolean).join(' · ')}</small>
              </div>
            ))}
      </Frame>
    </>
  );
}

/** `#/kernel`: the kernel and the daemon. */
export function KernelView({ rigs, store }: { rigs: RigsStore; store: MobileStore }) {
  const r = useRigs(rigs);
  const m = useMobile(store);
  const { pc, look } = useShell();
  const wide = useWide();
  const [prefs] = useDaemonPrefs();
  const [sheet, setSheet] = useState<Sheet>(null);
  const live = m.fresh;
  const offline = look === 'offline';
  useEffect(() => {
    rigs.follow();
    rigs.followGoals();
    if (live) { rigs.openRig(KERNEL_RIG); rigs.readRouting(); }
  }, [rigs, live]);
  // The level of each running rig in « Rigs pilotés », read once per rig on opening the kernel (m4-complement.html, F).
  const running = r.state ? listedRigs(r.state).filter(x => rigStatus(x) !== 'stopped').map(x => x.name).join(' ') : '';
  useEffect(() => {
    if (live && running) for (const rig of running.split(' ')) rigs.readPermissions(rig);
  }, [rigs, live, running]);

  const name = hostName(pc);
  const state = r.state;
  const scroll = `tab-main flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pb-[18px] ${wide ? 'pt-[18px]' : 'pt-3'}`;
  const header = (chip: ReactNode) => (
    <header className={wide ? 'pane-head flex h-[58px] flex-none items-center gap-2 border-b border-line pr-1.5' : 'flex h-14 flex-none items-center gap-2 border-b border-line pr-1.5 pl-0.5'}>
      <BackLink fallback={{ name: 'rigs' }} label={C.back} />
      <h1 className={`min-w-0 truncate font-semibold ${wide ? 'text-[17px]' : 'text-base'}`}>{C.kernel}</h1>
      {chip}
      <span className="flex-1" />
      {chip && (
        <button type="button" aria-label={C.more} title={C.more} aria-haspopup="menu" onClick={() => setSheet('menu')} className={iconButtonClass()}>
          <Icon name="more" />
        </button>
      )}
    </header>
  );
  const refresh = () => { rigs.retry(); rigs.openRig(KERNEL_RIG); rigs.readRouting(); };

  if (!state) {
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

  const kernel = kernelOf(state);
  const kstate = state.kernel.state;
  const status: RigStatus = kernel ? rigStatus(kernel) : 'stopped';
  const graph = r.graphs[KERNEL_RIG];
  const near = m.device?.contextNear ?? 70;
  const confirm = !!m.device?.confirm;
  const run = lastRun(r.runs, x => x.subject.kind === 'act' && /^(kernel|daemon)\./.test(x.subject.action.kind));
  const busy = isRunning(run);
  const can = live && !busy;
  const act = (a: OpenRigAction) => { void rigs.act(a); };
  const sessions = [...m.sessions.values()];
  const listed = listedRigs(state);
  const daemonUp = state.daemon.state === 'running';
  const kernelUp = kstate === 'ready' || kstate === 'starting';
  const goals = r.goals?.data?.goals ?? [];

  const strip = kstate === 'stopped'
    ? (
      <Strip lead={<span className="mt-[5px]"><Dot state="off" /></span>}>
        <span><b className="font-semibold">{K.stoppedTitle}</b></span>
        <span className="text-muted">{K.stoppedBody}</span>
        <button type="button" disabled={!can || !daemonUp} onClick={() => act({ kind: 'kernel.start' })} className={rigButtonClass({ tone: 'primary', size: 'sm', className: 'self-start' })}>
          <IconLabel icon="power">{K.startKernel}</IconLabel>
        </button>
      </Strip>
    )
    : kstate === 'skipped'
      ? (
        <Strip lead={<span className="mt-[5px]"><Dot state="off" /></span>}>
          <span><b className="font-semibold">{K.skippedTitle}</b></span>
          <span className="text-muted">{K.skippedBody}</span>
        </Strip>
      )
      : null;

  // Max: on a phone his last word and « Parler à Max »; wide, the goal he works on as a thread, with its field.
  const said = goals.find(g => maxWord(g) !== null);
  const saidAt = said ? maxAt(said) : null;
  const current = goals.find(g => g.state !== 'done' && g.state !== 'closed');
  const talk = <a href={href({ name: 'max' })} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{K.talk}</a>;
  const maxBox = wide && current
    ? (
      <>
        <Lbl>{`${K.max} · ${current.text}`}</Lbl>
        <Frame>
          <div className="flex flex-col gap-2.5 p-3">
            <GoalThread goal={current} runs={r.runs} rigs={rigs} pc={name} compact />
            <ReplyField goalId={current.goalId} rigs={rigs} live={live} />
          </div>
        </Frame>
      </>
    )
    : (
      <Frame>
        <div className="flex flex-col gap-2 p-3">
          {said && <span className="text-[12px] text-muted">{K.lastMessage(saidAt ? clock(iso(saidAt)) : null)}</span>}
          {said && <span className="text-[13.5px] leading-[19px] [overflow-wrap:anywhere]">{maxWord(said)}</span>}
          {talk}
        </div>
      </Frame>
    );

  // « 5 sièges · Auto »: each running rig's level, read on opening the kernel; the count alone when that read fails.
  const levelOf = (rig: string): string => { const p = r.permissions[rig]?.data; const l = p ? permLevelOf(p.seats) : null; return l ? C.level[l] : ''; };
  const driven = listed.length > 0 && (
    <>
      <Lbl>{K.driven}</Lbl>
      <Frame>
        {listed.map(x => {
          const s = rigStatus(x);
          const dot: DotState = rigDot(x, attentionOf(x.name, sessions, m.asks));
          return (
            <a key={x.id} href={href({ name: 'rig', rig: x.name })} className="flex min-h-[46px] items-center gap-2.5 border-b border-line px-3 py-1.5 text-[13.5px] last:border-b-0">
              <Dot state={dot} />
              <span className={`min-w-0 flex-1 truncate ${s === 'stopped' ? 'text-muted' : ''}`}>{x.name}</span>
              <span className="text-[12px] text-muted">{s === 'stopped' ? C.seatState.off : [C.seatCount(x.seats), levelOf(x.name)].filter(Boolean).join(' · ')}</span>
              <Icon name="chevron" className="size-4 text-muted" />
            </a>
          );
        })}
      </Frame>
    </>
  );

  const pair = (restart: () => void, stop: () => void) => (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={!can} onClick={restart} className={rigButtonClass({})}><IconLabel icon="refresh">{C.actions.restart}</IconLabel></button>
      <button type="button" disabled={!can} onClick={stop} className={rigButtonClass({ tone: 'danger' })}><IconLabel icon="power">{C.actions.stop}</IconLabel></button>
    </div>
  );
  const kernelBox = kernelUp && (
    <>
      <Lbl>{C.kernel}</Lbl>
      <Frame>
        <div className="flex flex-col gap-2 p-3">
          <span className="text-[12.5px] leading-[18px] text-muted">{C.confirm.kernelNote}</span>
          {pair(() => setSheet('kernel.restart'), () => setSheet('kernel.stop'))}
        </div>
      </Frame>
    </>
  );
  const daemonBox = (
    <>
      <Lbl>{C.daemon}</Lbl>
      <Frame>
        <DaemonRow state={state} />
        <DaemonChoices disabled={!live} next />
        {daemonUp && <div className="px-3 pt-2.5 pb-3">{pair(() => setSheet('daemon.restart'), () => setSheet('daemon.stop'))}</div>}
      </Frame>
      <p className="text-[12px] leading-4 text-muted">{K.daemonNote}</p>
    </>
  );

  const working = listed.flatMap(x => workingSeats(x)).length;
  const runningRigs = listed.filter(x => rigStatus(x) !== 'stopped').length;
  const daemonConseq = [C.confirm.daemonStops(runningRigs), working ? C.confirm.working(working) : ''].filter(Boolean).join(' ');
  const close = () => setSheet(null);

  return (
    <>
      {header(<Chip tone={KERNEL_TONE[kstate]}>{C.kernelState[kstate]}</Chip>)}
      <main data-tab-scroll="" className={scroll}>
        <LinkStrip body={C.offlineBody} />
        {run && <RunNote run={run} rigs={rigs} pc={name} />}
        <div className={`flex flex-col gap-3 ${wide ? 'max-w-[720px]' : ''} ${offline ? 'opacity-50' : ''}`}>
          {strip}
          <p className="text-[12.5px] leading-[18px] text-muted">{K.role}</p>
          {kernelUp && (graph?.data
            ? <KernelTopology graph={graph.data} status={status} near={near} />
            : <Frame><p role={graph?.error ? 'alert' : 'status'} className="p-3 text-[13px] text-muted">{graph?.error ? C.readError[graph.error] : C.loading}</p></Frame>)}
          {kernelUp && maxBox}
          {driven}
          <Routing rigs={rigs} />
          {kernelBox}
          {daemonBox}
        </div>
      </main>
      {sheet === 'menu' && (
        <KernelMenuSheet
          live={live} up={kernelUp && !busy} onClose={close} onRefresh={() => { close(); refresh(); }}
          onRestart={() => setSheet('kernel.restart')} onStop={() => setSheet('kernel.stop')}
        />
      )}
      {sheet === 'kernel.restart' && <ConfirmSheet title={C.confirm.restartKernel(name)} conseq={{ title: C.confirm.kernelNote }} verb={C.actions.restart} confirm={confirm} live={can} onConfirm={() => act({ kind: 'kernel.restart' })} onClose={close} />}
      {sheet === 'kernel.stop' && <ConfirmSheet title={C.confirm.stopKernel(name)} conseq={{ title: C.confirm.kernelNote }} verb={C.actions.stop} confirm={confirm} live={can} onConfirm={() => act({ kind: 'kernel.stop' })} onClose={close} />}
      {sheet === 'daemon.restart' && <ConfirmSheet title={C.confirm.restartDaemon(name)} conseq={{ title: daemonConseq }} verb={C.actions.restart} confirm={confirm} live={can} onConfirm={() => act(daemonAction('restart', prefs))} onClose={close} />}
      {sheet === 'daemon.stop' && <ConfirmSheet title={C.confirm.stopDaemon(name)} conseq={{ title: daemonConseq }} verb={C.actions.stop} confirm={confirm} live={can} onConfirm={() => act({ kind: 'daemon.stop' })} onClose={close} />}
    </>
  );
}
