import { useEffect, useMemo, useState, type JSX } from 'react';
import type { OpenRigStatus, Projects, Rig, Session } from '@ledge/protocol';
import { useOpenRig, useRigs, useRigSpecs, type DaemonClient } from '@ledge/fleet';
import { allSeats, rigsModel } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import type { NavAction, NavState, RigsSub } from '../nav/state';
import { cls } from '../shell/cls';
import { RigsAgents } from './RigsAgents';
import { RigsLive } from './RigsLive';
import { RigsSpecs } from './RigsSpecs';
import { openSeatTerminal } from './terminal';

export type { RigsSub } from '../nav/state';
const SUBS: readonly RigsSub[] = ['live', 'specs', 'agents'];
/** OpenRig cannot answer on that machine: no rig of it is shown, the Rigs tab says why. */
const down = (s: OpenRigStatus | undefined) => !!s && (s.state === 'absent' || s.state === 'stopped' || s.state === 'error' || s.state === 'unsupported');
/** The rigs the tab shows: those of a machine where OpenRig answers. The Ledge home's « Rigs · n » counts the same ones. */
export const visibleRigs = (all: readonly Rig[], openrig: readonly OpenRigStatus[]): Rig[] => all.filter(x => !down(openrig.find(s => s.machine === x.machine)));

/**
 * The Rigs tab of the Ledge screen (spec §8.2), read only: sub-tabs « En cours · Specs · Agents » (the sub-tab and the chosen spec live in
 * the nav's home place). When the local OpenRig is absent, stopped, refused or in error, a banner says so in the sidebar's words and no card
 * of that machine shows. The specs are those of the local machine, or of the machine picked in a list when several run OpenRig.
 */
export function RigsTab({ nav, dispatch, client, sessions, projects, notify }: {
  nav: NavState; dispatch: (a: NavAction) => void; client: DaemonClient; sessions: readonly Session[]; projects: Projects | null; notify?(text: string): void;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const home = nav.place.kind === 'home' ? nav.place : null;
  const sub = home?.rigs ?? 'live';
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const rigs = useMemo(() => visibleRigs(allRigs, openrig), [allRigs, openrig]);
  const model = useMemo(() => rigsModel(rigs, byId, projects), [rigs, byId, projects]);

  // The local machine, then every other one running OpenRig.
  const machines = useMemo(() => ['local', ...openrig.filter(s => s.state === 'running' && s.machine !== 'local').map(s => s.machine)], [openrig]);
  const [picked, setPicked] = useState('local');
  const machine = machines.includes(picked) ? picked : 'local';
  useEffect(() => { if (machine !== picked) setPicked(machine); }, [machine, picked]);
  const specs = useRigSpecs(client, machine);

  const local = openrig.find(s => s.machine === 'local');
  const banner = !down(local) ? null
    : local!.state === 'absent' ? t.side.rigs.absent
    : local!.state === 'stopped' ? t.side.rigs.stopped
    : local!.state === 'error' ? t.side.rigs.error
    : t.side.rigs.unsupported(local!.version);

  const specCount = specs.status === 'ready' && !specs.error ? specs.specs.length : undefined;
  const labels: Record<RigsSub, string> = { live: r.sub.live(model.rigs.length + model.kernels.length), specs: r.sub.specs(specCount), agents: r.sub.agents(allSeats(rigs).length) };
  return (
    <div className="rigs-tab" role="tabpanel" aria-label={t.home.tabs.rigs}>
      <div className="rigs-bar">
        <div className="rigs-subtabs" role="tablist" aria-label={r.tabs}>
          {SUBS.map(x => <button key={x} type="button" role="tab" aria-selected={sub === x} className={cls(sub === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: 'rigs', rigs: x })}>{labels[x]}</button>)}
        </div>
        {sub === 'specs' && machines.length > 1 && (
          <label className="rigs-machine">
            <span>{r.machine}</span>
            <select aria-label={r.machine} value={machine} onChange={e => setPicked(e.target.value)}>
              {machines.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
      </div>
      {banner && (
        <p className="rigs-banner" role="status" title={local?.detail}>
          <span>{banner}</span>
          {local?.state === 'absent' && local.install && <code>{local.install}</code>}
        </p>
      )}
      <div className="rigs-body">
        {sub === 'live' && <RigsLive model={model} openrig={openrig} byId={byId} dispatch={dispatch}
          onTerminal={(rig, seat) => { void openSeatTerminal(client, rig, seat, byId).then(ok => { if (!ok) notify?.(t.session.terminal.openFailed(seat.name)); }); }} />}
        {sub === 'specs' && <RigsSpecs specs={specs} selected={home?.spec} rigs={allRigs} machine={machine}
          version={openrig.find(s => s.machine === machine)?.version} dispatch={dispatch} />}
        {sub === 'agents' && <RigsAgents rigs={rigs} byId={byId} dispatch={dispatch} />}
      </div>
    </div>
  );
}
