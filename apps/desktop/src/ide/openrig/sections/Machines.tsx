import { useMemo, type JSX } from 'react';
import { useLatency, type DaemonClient, type MachineState } from '@ledge/fleet';
import { useOpenRigStates } from '@ledge/fleet/openrig';
import type { OpenRigState } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../../i18n/lang';
import type { NavAction } from '../../../nav/state';
import { SIDEBAR_POLL_MS } from '../../../openrig/sidebarState';
import { cls } from '../../../shell/cls';
import type { Tab } from '../../../workspace/model';
import { useRigsMachine } from '../../../workspace/prefs';
import { openrigTab } from '../../../workspace/store';
import { machineEntries, type MachineEntry } from '../../rigs/model';

export interface MachinesProps { client: DaemonClient; machines: readonly MachineState[]; dispatch(a: NavAction): void; onTab(tab: Tab): void }

/** Machines (R15, mockup `orPageB` « machines »): one row per machine with its OpenRig, its rigs and its latency; « Afficher » makes it the shown machine. */
export function Machines({ client, machines, dispatch, onTab }: MachinesProps): JSX.Element {
  const { t } = useI18n();
  const p = t.ide.openrigPage;
  const [shownId, setShown] = useRigsMachine(machines);
  const seen = useOpenRigStates(client, useMemo(() => machines.filter(m => m.ready).map(m => m.id), [machines]), SIDEBAR_POLL_MS);
  // Measured only while the section shows (this component), and never for this computer.
  const latency = useLatency(client, useMemo(() => machines.filter(m => m.ssh).map(m => m.id), [machines]));
  const { entries, states } = useMemo(() => {
    const states = new Map<string, OpenRigState>(), errors = new Set<string>();
    for (const [id, s] of seen) { if (s.state) states.set(id, s.state); if (s.error) errors.add(id); }
    return { entries: machineEntries(machines, states, errors), states };
  }, [machines, seen]);

  const version = (e: MachineEntry): string => {
    const v = states.get(e.id)?.version;
    return e.status === 'offline' ? t.side.offline : e.status === 'loading' ? '…' : e.status === 'absent' ? p.notInstalled : v ? t.openrig.version(v) : '';
  };
  const rigs = (e: MachineEntry): string => (e.status === 'running' ? p.rigs(e.running) : e.status === 'stopped' ? p.stopped : '');
  const lat = (e: MachineEntry): string => {
    if (e.kind === 'local') return p.local;
    const ms = latency.get(e.id);
    return ms === undefined ? p.measuring : ms === null ? '—' : p.latency(ms);
  };
  const show = (id: string) => { setShown(id); onTab(openrigTab(id)); };

  return (
    <section className="ide-orp-blk">
      <ul className="ide-orp-machs">
        {entries.map(e => {
          const m = machines.find(x => x.id === e.id);
          return (
            <li key={e.id} className={cls('ide-orp-mach', e.id === shownId && 'on')} aria-label={e.label}>
              <i className={`ide-rigs-dot d-${e.status === 'running' ? 'idle' : 'off'}`} aria-hidden="true" />
              <span className="ide-orp-mt"><b>{e.label}</b><small>{m?.ssh ? p.ssh(m.ssh) : p.local}</small></span>
              <span className="ide-orp-mut mono">{version(e)}</span>
              <span className="ide-orp-mut">{rigs(e)}</span>
              <span className="ide-orp-mut mono">{lat(e)}</span>
              {e.id === shownId ? <span className="ide-orp-pill run">{p.shown}</span>
                : <button type="button" className="ide-orp-ib" aria-label={p.showLabel(e.label)} onClick={() => show(e.id)}>{p.show}</button>}
            </li>
          );
        })}
      </ul>
      <div className="ide-orp-blk-b row">
        <button type="button" className="ide-orp-ib" onClick={() => dispatch({ type: 'settings', section: 'machines' })}><Icon d={ICONS.plus.d} size={13} />{t.ide.rigsView.add}</button>
        <span className="ide-orp-mut">{p.addNote}</span>
      </div>
    </section>
  );
}
