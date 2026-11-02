import { useEffect, useMemo, useState, type JSX } from 'react';
import type { OpenRigStatus, Projects, Rig, Session } from '@ledge/protocol';
import { useOpenRig, useRigs, useRigSpecs, type DaemonClient, type TeamBroadcastAnswer } from '@ledge/fleet';
import { allSeats, rigsModel } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import type { NavAction, NavState, RigsSub } from '../nav/state';
import { cls } from '../shell/cls';
import { RigsAgents } from './RigsAgents';
import { RigsLive } from './RigsLive';
import { RigsSpecs } from './RigsSpecs';
import { openSeatTerminal } from './terminal';
import { launchTeam, useEngine } from './engine';

export type { RigsSub } from '../nav/state';
const SUBS: readonly RigsSub[] = ['live', 'specs', 'agents'];
/** OpenRig cannot answer on that machine: no rig of it is shown, the tab says why (in OpenRig mode). */
const down = (s: OpenRigStatus | undefined) => !!s && (s.state === 'absent' || s.state === 'stopped' || s.state === 'error' || s.state === 'unsupported');
/** The rigs the tab shows: a Ledge team always (OpenRig's state says nothing of it, Review Focus 1), an OpenRig rig when OpenRig answers
 *  on its machine. The Ledge home's « Équipes · n » counts the same ones. */
export const visibleRigs = (all: readonly Rig[], openrig: readonly OpenRigStatus[]): Rig[] =>
  all.filter(x => x.engine === 'ledge' || !down(openrig.find(s => s.machine === x.machine)));

/** The one count of rigs (R13): the visible rigs outside the kernels, stopped ones included (the kernel is a trailing row « au repos »,
 *  not a rig). « Rigs · n » of the Ledge screen, « En cours · n » here and the rail's « Rigs · n » all read it. */
export const rigsCount = (all: readonly Rig[], openrig: readonly OpenRigStatus[]): number => visibleRigs(all, openrig).filter(r => !r.kernel).length;

/**
 * The « Équipes » tab of the Ledge screen (spec §8.2, lot F), the same whatever the engine: sub-tabs « En cours · Specs · Agents » (the
 * sub-tab and the chosen spec live in the nav's home place), « Lancer une équipe » (`launchTeam`). What is OpenRig's own shows in OpenRig
 * mode only: the Specs, and the banner when the local OpenRig is absent, stopped, refused or in error (in the sidebar's words; no card of
 * that machine shows). The specs are those of the local machine, or of the machine picked in a list when several run OpenRig.
 * A live Ledge team's card writes to all its seats (`team.broadcast`, through the fleet to the local daemon).
 */
export function RigsTab({ nav, dispatch, client, sessions, projects, notify }: {
  nav: NavState; dispatch: (a: NavAction) => void; client: DaemonClient; sessions: readonly Session[]; projects: Projects | null; notify?(text: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const engine = useEngine(client);
  const subs = engine === 'ledge' ? SUBS.filter(x => x !== 'specs') : SUBS;
  const home = nav.place.kind === 'home' ? nav.place : null;
  const sub = home?.rigs && subs.includes(home.rigs) ? home.rigs : 'live';
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const rigs = useMemo(() => visibleRigs(allRigs, openrig), [allRigs, openrig]);
  const model = useMemo(() => rigsModel(rigs, byId, projects), [rigs, byId, projects]);

  // The local machine, then every other one running OpenRig.
  const machines = useMemo(() => ['local', ...openrig.filter(s => s.state === 'running' && s.machine !== 'local').map(s => s.machine)], [openrig]);
  const [picked, setPicked] = useState('local');
  const machine = machines.includes(picked) ? picked : 'local';
  useEffect(() => { if (machine !== picked) setPicked(machine); }, [machine, picked]);
  // OpenRig's specs: none asked for in Ledge mode, where they are off.
  const specs = useRigSpecs(client, engine === 'ledge' ? null : machine);

  const local = openrig.find(s => s.machine === 'local');
  const banner = engine === 'ledge' || !down(local) ? null
    : local!.state === 'absent' ? t.side.rigs.absent
    : local!.state === 'stopped' ? t.side.rigs.stopped
    : local!.state === 'error' ? t.side.rigs.error
    : t.side.rigs.unsupported(local!.version);

  const broadcast = (rig: Rig, text: string): Promise<TeamBroadcastAnswer> => client.fleet?.broadcastTeam(rig.id, text) ?? Promise.resolve({ reason: 'offline' });
  const specCount = specs.status === 'ready' && !specs.error ? specs.specs.length : undefined;
  const labels: Record<RigsSub, string> = { live: r.sub.live(rigsCount(allRigs, openrig)), specs: r.sub.specs(specCount), agents: r.sub.agents(allSeats(rigs).length) };
  return (
    <div className="rigs-tab" role="tabpanel" aria-label={t.home.tabs.rigs}>
      <div className="rigs-bar">
        <div className="rigs-subtabs" role="tablist" aria-label={r.tabs}>
          {subs.map(x => <button key={x} type="button" role="tab" aria-selected={sub === x} className={cls(sub === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: 'rigs', rigs: x })}>{labels[x]}</button>)}
        </div>
        {sub === 'specs' && <button type="button" className="st-qa" onClick={specs.refresh} disabled={specs.status === 'loading'}>{t.rigLaunch.refreshSpecs}</button>}
        {sub === 'specs' && machines.length > 1 && (
          <label className="rigs-machine">
            <span>{r.machine}</span>
            <select aria-label={r.machine} value={machine} onChange={e => setPicked(e.target.value)}>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        <span className="st-fill" />
        <button type="button" className="st-qa pri" onClick={() => dispatch(launchTeam(engine))}>{t.side.rigs.launch}</button>
      </div>
      {banner && (
        <p className="rigs-banner" role="status" title={local?.detail}>
          <span>{banner}</span>
          {local?.state === 'absent' && local.install && <code>{local.install}</code>}
        </p>
      )}
      <div className="rigs-body">
        {sub === 'live' && <RigsLive model={model} openrig={openrig} byId={byId} projects={projects} dispatch={dispatch} onBroadcast={broadcast}
          onTerminal={(rig, seat) => { void openSeatTerminal(client, rig, seat, byId).then(ok => { if (!ok) notify?.(t.session.terminal.openFailed(seat.name)); }); }} />}
        {sub === 'specs' && <RigsSpecs specs={specs} selected={home?.spec} rigs={allRigs} machine={machine}
          version={openrig.find(s => s.machine === machine)?.version} dispatch={dispatch} />}
        {sub === 'agents' && <RigsAgents rigs={rigs} byId={byId} dispatch={dispatch} />}
      </div>
    </div>
  );
}
