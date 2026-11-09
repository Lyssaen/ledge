import { useId, type JSX } from 'react';
import type { OpenRigState } from '@ledge/protocol';
import { useI18n } from '../../../i18n/lang';
import { PermSegment } from '../../PermSegment';
import { useDaemonPrefs } from '../prefs';

function Check({ label, on, disabled = false, onChange }: { label: string; on: boolean; disabled?: boolean; onChange(on: boolean): void }): JSX.Element {
  return <label className="ide-orp-chk"><input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.currentTarget.checked)} /><span>{label}</span></label>;
}

/** Daemon (R16, mockup `orPageB` « daemon »): its address, then Ledge's preferences for this machine (R9), each written at once. */
export function Daemon({ state, machine }: { state: OpenRigState; machine: string }): JSX.Element {
  const { t } = useI18n();
  const p = t.ide.openrigPage;
  const [prefs, save] = useDaemonPrefs(machine);
  const id = useId();
  const up = state.daemon.state === 'running';
  const address = up ? p.address(state.daemon.port, state.daemon.pid) : '';
  return (
    <section className="ide-orp-blk">
      <div className="ide-orp-blk-h"><b>{t.openrig.daemon}</b><span className="ide-orp-sp" />{address && <span className="ide-orp-mut mono">{address}</span>}</div>
      <div className="ide-orp-blk-b ide-orp-fld">
        <span id={`${id}-start`}>{p.onStart}</span>
        <div className="ide-orp-checks" role="group" aria-labelledby={`${id}-start`}>
          <Check label={p.relaunch} on={prefs.relaunch} onChange={relaunch => save({ relaunch })} />
          {/* Without « Relancer », a start brings nothing back: only then can it leave the kernel out (R9). */}
          <Check label={p.noKernel} on={prefs.noKernel} disabled={prefs.relaunch} onChange={noKernel => save({ noKernel })} />
        </div>
        <span>{p.perm}</span>
        <div className="ide-orp-checks">
          <PermSegment value={prefs.perm} onChange={perm => save({ perm })} label={p.perm} />
          <span className="ide-orp-mut">{p.permHint}</span>
        </div>
        <span id={`${id}-stop`}>{p.beforeStop}</span>
        <div className="ide-orp-checks" role="group" aria-labelledby={`${id}-stop`}>
          <Check label={p.snapshot} on={prefs.snapshotBeforeStop} onChange={snapshotBeforeStop => save({ snapshotBeforeStop })} />
          <Check label={p.askBusy} on={prefs.askAlways} onChange={askAlways => save({ askAlways })} />
        </div>
      </div>
    </section>
  );
}
