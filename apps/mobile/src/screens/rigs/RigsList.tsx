import { useEffect, type ReactNode } from 'react';
import type { PhoneOpenRigState } from '@ledge/protocol';
import { copy } from '../../copy';
import { attentionOf, daemonDown, kernelOf, kernelSeatName, listedRigs, rigDot, rigStatus, runs as isUp, STATUS_TONE } from '../../model/rigs';
import { href, useRoute } from '../../router';
import { TabPage, hostName, useShell } from '../../shell/Shell';
import { daemonAction, useDaemonPrefs } from '../../state/rigPrefs';
import { useRigs, type RigsStore } from '../../state/rigs';
import { useMobile, type MobileStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { Dot } from '../../ui/kit/marks';
import { useWide } from '../../ui/layout';
import { clock } from '../Inbox';
import { Att, Chip, Frame, IconLabel, Lbl, RRow, Strip, ToggleRow, rigButtonClass, type ChipTone } from './kit';
import { RunNote, isRunning, lastRun } from './runs';

/*
 * The Rigs tab (docs/mockups/ledge-mobile-refonte/m4-rigs.html, §1 and §2): OpenRig on top (the daemon, the kernel), then the
 * rigs, running first, each with its status and what waits on the person apart. Its states: loading, no rig, OpenRig stopped or
 * absent, a read that did not answer, the PC offline (the last state, greyed).
 */

const C = copy.rigs;

export const DAEMON_TONE: Record<PhoneOpenRigState['daemon']['state'], ChipTone> = { running: 'on', stopped: 'plain', stale: 'bad', unknown: 'plain' };
export const KERNEL_TONE: Record<PhoneOpenRigState['kernel']['state'], ChipTone> = { ready: 'on', starting: 'go', stopped: 'plain', skipped: 'plain', absent: 'plain', unknown: 'plain' };

/** The daemon's row: its state, version and start. */
export function DaemonRow({ state, href: to }: { state: PhoneOpenRigState; href?: string }) {
  const since = state.daemon.state === 'running' && state.daemon.startedAt ? clock(state.daemon.startedAt) : null;
  return (
    <RRow
      lead={<Icon name="cpu" className="size-[18px] text-muted" />} name={C.daemon}
      chip={<Chip tone={DAEMON_TONE[state.daemon.state]}>{C.daemonState[state.daemon.state]}</Chip>}
      sub={C.daemonSub(state.version, since)} {...(to ? { href: to } : {})}
    />
  );
}

/** The two start choices of the daemon, kept on this phone (Q45). */
export function DaemonChoices({ disabled, next = false }: { disabled: boolean; next?: boolean }) {
  const [prefs, save] = useDaemonPrefs();
  return (
    <>
      <ToggleRow on={prefs.relaunch} label={C.relaunch} disabled={disabled} onChange={v => save({ relaunch: v })} />
      <ToggleRow on={prefs.noKernel} label={C.noKernel} hint={next ? C.noKernelNext : C.noKernelHint} disabled={disabled} onChange={v => save({ noKernel: v })} />
    </>
  );
}

/** A framed empty state of the list: its glyph, title and line, then what it offers. */
function Empty({ glyph, title, body, children }: { glyph?: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 pt-[26px] pb-[22px] text-center">
      {glyph && <div aria-hidden="true" className="grid size-12 place-items-center rounded-[10px] border border-line text-muted">{glyph}</div>}
      <h2 className="mt-1.5 text-[17px] leading-6 font-semibold">{title}</h2>
      <p className="max-w-[300px] text-[13.5px] text-muted">{body}</p>
      {children}
    </div>
  );
}

/** OpenRig stopped: start it, with its two choices (no Face ID to start). */
function Stopped({ state, rigs, store, pc }: { state: PhoneOpenRigState | null; rigs: RigsStore; store: MobileStore; pc: string }) {
  const fresh = useMobile(store).fresh;
  const [prefs] = useDaemonPrefs();
  const r = useRigs(rigs);
  const run = lastRun(r.runs, x => x.subject.kind === 'act' && x.subject.action.kind === 'daemon.start');
  return (
    <>
      {state && <Frame><DaemonRow state={state} /></Frame>}
      <Frame>
        <Empty glyph={<Icon name="power" />} title={C.stopped.title} body={C.stopped.body} />
        <div className="border-t border-line"><DaemonChoices disabled={!fresh} /></div>
        <div className="p-3">
          <button type="button" disabled={!fresh || isRunning(run)} onClick={() => { void rigs.act(daemonAction('start', prefs)); }} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>
            <IconLabel icon="power">{C.stopped.start}</IconLabel>
          </button>
        </div>
      </Frame>
      {run && <RunNote run={run} rigs={rigs} pc={pc} />}
      <p className="text-[12px] leading-4 text-muted">{C.stopped.note}</p>
    </>
  );
}

/** The skeleton of the list while OpenRig is read for the first time. */
function Reading() {
  const sk = 'block animate-[ledge-pulse_1.6s_ease-in-out_infinite] rounded-[5px] bg-raised';
  return (
    <div role="status" className="flex flex-col gap-3">
      <Frame><div aria-hidden="true" className="flex flex-col gap-2.5 p-2.5"><span className={`${sk} h-3.5 w-[60%]`} /><span className={`${sk} h-3 w-[40%]`} /></div></Frame>
      <Frame><div aria-hidden="true" className="flex flex-col gap-2.5 p-2.5"><span className={`${sk} h-3.5 w-1/2`} /><span className={`${sk} h-3 w-[70%]`} /><span className={`${sk} h-3.5 w-[45%]`} /><span className={`${sk} h-3 w-[65%]`} /></div></Frame>
      <span className="text-[12px] text-muted">{C.loading}</span>
    </div>
  );
}

/** The list itself: OpenRig, then the rigs (`offline`: greyed, the time of the last state in place of the uptime). */
function Listing({ state, at, store, offline }: { state: PhoneOpenRigState; at: string | null; store: MobileStore; offline: boolean }) {
  const m = useMobile(store);
  const route = useRoute();
  const wide = useWide();
  const kernel = kernelOf(state);
  const listed = listedRigs(state);
  const up = listed.filter(r => isUp(rigStatus(r))).length;
  const sessions = [...m.sessions.values()];
  const kernelNames = (kernel?.nodes ?? []).map(kernelSeatName);
  const daemonUp = state.daemon.state === 'running';
  return (
    <div className={`flex flex-col gap-3 ${offline ? 'opacity-50' : ''}`}>
      <Lbl aside={!offline && at ? C.updatedAt(clock(at)) : undefined}>{C.openrig}</Lbl>
      <Frame label={C.openrig}>
        <DaemonRow state={state} {...(offline ? {} : { href: href({ name: 'kernel' }) })} />
        {state.kernel.state !== 'absent' && (
          <RRow
            lead={<Dot state="rig" />} name={C.kernel} selected={route.name === 'kernel' && wide}
            chip={<Chip tone={KERNEL_TONE[state.kernel.state]}>{C.kernelState[state.kernel.state]}</Chip>}
            sub={kernelNames.length ? (offline || wide ? C.kernelSubShort(kernelNames) : C.kernelSub(kernelNames)) : ''}
            {...(offline ? {} : { href: href({ name: 'kernel' }) })}
          />
        )}
      </Frame>
      {daemonUp && listed.length === 0 ? (
        <Frame>
          <Empty title={C.empty.title} body={C.empty.body}>
            <a href={href({ name: 'max' })} className={rigButtonClass({ size: 'sm', className: 'mt-1.5' })}>{C.empty.talk}</a>
          </Empty>
        </Frame>
      ) : listed.length > 0 && (
        <>
          <Lbl>{C.rigsHead(up)}</Lbl>
          <Frame tone="rigs" label={C.title}>
            {listed.map(r => {
              const s = rigStatus(r);
              const a = attentionOf(r.name, sessions, m.asks);
              const dim = s === 'stopped';
              const sub = offline
                ? [dim ? C.seatCount(r.seats) : C.seats(r.running, r.seats), !dim && at ? C.at(clock(at)) : ''].filter(Boolean).join(' · ')
                : s === 'stopped' ? [C.seatCount(r.seats), r.snapshot ? C.snapshot(r.snapshot) : C.noSnapshot].join(' · ')
                : s === 'partial' ? [C.seats(r.running, r.seats), C.stoppedCount(r.nodes.filter(n => n.stopped).length || r.seats - r.running)].join(' · ')
                : s === 'starting' ? C.seats(r.running, r.seats)
                : [C.seats(r.running, r.seats), r.uptime ? C.since(r.uptime) : '', r.snapshot ? C.snapshot(r.snapshot) : ''].filter(Boolean).join(' · ');
              const att = !offline && (a.perm || a.ask) ? <>{a.perm > 0 && <Att perm>{C.attention.permission(a.perm)}</Att>}{a.ask > 0 && <Att>{C.attention.question(a.ask)}</Att>}</> : undefined;
              return (
                <RRow
                  key={r.id} lead={<Dot state={rigDot(r, a)} pulse={s === 'starting' && !offline} />} name={r.name} dim={dim}
                  chip={<Chip tone={STATUS_TONE[s]}>{C.status[s]}</Chip>} sub={sub} att={att} href={href({ name: 'rig', rig: r.name })}
                  selected={wide && route.name === 'rig' && route.rig === r.name}
                />
              );
            })}
          </Frame>
        </>
      )}
      {!offline && daemonUp && <p className="text-[12px] leading-4 text-muted">{C.launchNote}</p>}
    </div>
  );
}

/** The Rigs tab of a PC that sends its rigs (`daemon.rigs`). */
export function RigsList({ rigs, store }: { rigs: RigsStore; store: MobileStore }) {
  const r = useRigs(rigs);
  const { pc, look } = useShell();
  const offline = look === 'offline';
  useEffect(() => { rigs.follow(); }, [rigs]);
  const name = hostName(pc);
  const state = r.state;
  const body = (() => {
    if (!state) {
      if (r.error === 'not_installed') return <Frame><Empty title={C.notInstalled.title} body={C.notInstalled.body(name)} /></Frame>;
      if (r.error === 'daemon_stopped') return <Stopped state={null} rigs={rigs} store={store} pc={name} />;
      if (r.error) {
        return (
          <Strip warn role="alert" lead={<Icon name="warning" className="mt-px size-4 text-attention" />}>
            <b className="font-semibold">{C.unavailable.title}</b>
            <button type="button" onClick={() => rigs.retry()} className={rigButtonClass({ size: 'sm', className: 'self-start' })}><IconLabel icon="refresh">{C.unavailable.retry}</IconLabel></button>
          </Strip>
        );
      }
      return <Reading />;
    }
    if (!state.installed) return <Frame><Empty title={C.notInstalled.title} body={C.notInstalled.body(name)} /></Frame>;
    if (!offline && daemonDown(state)) return <Stopped state={state} rigs={rigs} store={store} pc={name} />;
    return (
      <>
        {!offline && r.error && (
          <Strip warn role="alert" lead={<Icon name="warning" className="mt-px size-4 text-attention" />}>
            <b className="font-semibold">{C.unavailable.title}</b>
            {r.at && <span className="text-muted">{C.unavailable.body(clock(r.at))}</span>}
            <button type="button" onClick={() => rigs.retry()} className={rigButtonClass({ size: 'sm', className: 'self-start' })}><IconLabel icon="refresh">{C.unavailable.retry}</IconLabel></button>
          </Strip>
        )}
        <Listing state={state} at={r.at} store={store} offline={offline} />
      </>
    );
  })();
  return <TabPage title={C.title} offlineBody={C.offlineBody} heading={false}>{body}</TabPage>;
}
