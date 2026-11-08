import { useEffect, useState, type JSX } from 'react';
import type { OpenRigReseated, Rig } from '@ledge/protocol';
import { seatPlan } from '@ledge/protocol';
import type { RigPermissionsView, RigSnapshotsView } from '@ledge/fleet/openrig';
import { useI18n } from '../../i18n/lang';
import { isWorking } from '../../openrig/model';
import { ProviderLogo } from '../ProviderLogo';
import { providerOf } from '../../workspace/sessionTab';
import { rigErrorText } from './errors';
import { PERM_LEVELS, permLevelOf, roleCounts, seatDraft, type PermLevel } from './model';
import '../../styles/ide-rig.css';

/** A snapshot's date in local time. OpenRig writes it without a zone (`2026-11-08 14:54:01`): that is UTC. */
function snapshotAt(createdAt: string, lang: string): string {
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(createdAt) ? createdAt : `${createdAt.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? createdAt : d.toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });
}

export interface RigSettingsProps {
  rig: Rig; running: boolean; permissions: RigPermissionsView; snapshots: RigSnapshotsView;
  /** The machine's daemon applies `rig.policy` (`openrigPolicy`). */ policyAvailable: boolean;
  /** An action runs on the machine. */ busy: boolean;
  /** The failure of the last permission change, as an error code. */ policyError: string | null; /** The failure of the last snapshot, as an error code. */ snapshotError: string | null;
  onPolicy(level: PermLevel): void; onSnapshot(): void; onApply(seats: Record<string, number>): Promise<OpenRigReseated>;
}

/** The « Réglages » block of the Rig tab: spec file, permission level, seats per role, last snapshot (docs/mockups/ledge-ide-rigs.html `topoPage`). */
export function RigSettings({ rig, running, permissions, snapshots, policyAvailable, busy, policyError, snapshotError, onPolicy, onSnapshot, onApply }: RigSettingsProps): JSX.Element {
  const { t, lang } = useI18n();
  const r = t.ide.rigTab, o = t.openrig;
  const counts = running ? roleCounts(rig) : [];
  // A draft belongs to the seats it was made on: when they change (a seat added elsewhere, a restart) it is not read any more.
  const key = counts.map(c => `${c.role}=${c.count}`).join(',');
  const [made, setMade] = useState<{ key: string; seats: Record<string, number> } | null>(null);
  const [applying, setApplying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { setMade(null); }, [key]);
  const { seats, changed } = seatDraft(counts, made?.key === key ? made.seats : {});
  const plan = changed ? seatPlan(rig.nodes, seats) : { add: [], remove: [] };
  const working = plan.remove.filter(id => { const n = rig.nodes.find(x => x.logicalId === id); return n && isWorking(n); });
  const step = (role: string, by: number) => setMade({ key, seats: { ...seats, [role]: (seats[role] ?? 1) + by } });
  const apply = async () => {
    setApplying(true); setFailed(null);
    const res = await onApply(seats);
    setApplying(false);
    if (res.ok) setMade(null); else setFailed(res.error ?? '');
  };

  const level = permissions.status === 'ready' && !permissions.error ? permLevelOf(permissions.seats) : null;
  const specKnown = permissions.policy !== undefined;
  const noSeats = rig.nodes.length === 0;
  const levelOff = (l: PermLevel): boolean => !policyAvailable || noSeats || busy || (l === 'spec' && !specKnown);
  const last = snapshots.snapshots[0];

  return (
    <section className="ide-rig-block ide-rig-settings">
      <header className="ide-rig-head"><b>{r.settings}</b><span className="ide-rig-sub mono">{rig.specPath ?? r.specUnknown}</span></header>
      <div className="ide-rig-body">
        <div className="ide-rig-lbl">{r.permissions}</div>
        <div className="ide-rig-seg" role="radiogroup" aria-label={r.permissionsLabel}>
          {PERM_LEVELS.map(l => (
            <button key={l} type="button" role="radio" aria-checked={level === l} disabled={levelOff(l)}
              title={noSeats ? r.noSeats : l === 'spec' && !specKnown ? r.specNoPolicy : undefined} onClick={() => onPolicy(l)}>{r.level[l]}</button>
          ))}
        </div>
        {!policyAvailable && <p className="ide-rig-note" role="status">{o.outdated}</p>}
        {permissions.error && <p className="ide-rig-note" role="status">{rigErrorText(t, permissions.error)}</p>}
        {policyError !== null && <p className="ide-rig-fail" role="alert">{rigErrorText(t, policyError)}</p>}
        {level === 'mixed' && (
          <div className="ide-rig-mixed"><b>{r.mixed}</b>{permissions.seats.map(s => <span key={s.logicalId}>{r.mixedSeat(s.logicalId, s.summary ?? s.error ?? '')}</span>)}</div>
        )}
        {specKnown && <p className="ide-rig-note">{r.specPolicy(permissions.policy!)}</p>}
        <p className="ide-rig-note">{r.nextLaunch}</p>

        <div className="ide-rig-lbl">{r.seatsByRole}{!running && <span className="ide-rig-mut"> {r.seatsLocked}</span>}</div>
        {running && counts.map(c => (
          <div key={c.role} className="ide-rig-kv ide-rig-role">
            <span><ProviderLogo provider={providerOf(c.runtime === 'codex' ? 'codex' : c.runtime === 'claude-code' ? 'claude' : 'omp')} size={12} /> {c.role}</span>
            <span className="ide-rig-step">
              <button type="button" aria-label={o.reseat.fewer(c.role)} disabled={applying || (seats[c.role] ?? c.count) <= 1} onClick={() => step(c.role, -1)}>−</button>
              <span aria-live="polite">{seats[c.role] ?? c.count}</span>
              <button type="button" aria-label={o.reseat.more(c.role)} disabled={applying || (seats[c.role] ?? c.count) >= 9} onClick={() => step(c.role, 1)}>+</button>
            </span>
          </div>
        ))}
        {!running && roleCounts(rig).map(c => <div key={c.role} className="ide-rig-kv"><span>{c.role}</span><span className="mono">{c.count}</span></div>)}
        {changed && (
          <div className="ide-rig-plan">
            {plan.add.length > 0 && <span>{r.planAdd(plan.add.map(a => a.id))}</span>}
            {plan.remove.length > 0 && <span>{r.planRemove(plan.remove)}</span>}
            {working.map(id => <span key={id} className="ide-rig-warn">{o.reseat.working(id)}</span>)}
            <span className="ide-rig-go">
              <button type="button" className="pri" disabled={applying} onClick={() => void apply()}>{applying ? r.applying : r.apply}</button>
              <button type="button" disabled={applying} onClick={() => setMade(null)}>{r.revert}</button>
            </span>
          </div>
        )}
        {failed !== null && <p className="ide-rig-fail" role="alert">{o.reseat.errors[failed] ?? rigErrorText(t, failed)}</p>}

        <div className="ide-rig-kv">
          <span>{r.lastSnapshot}</span>
          <span className="ide-rig-snap"><span className="mono">{last ? snapshotAt(last.createdAt, lang) : r.noSnapshot}</span>
            {running && <button type="button" className="ide-rig-btn" disabled={busy} onClick={onSnapshot}>{r.snapshotNow}</button>}
          </span>
        </div>
        {snapshotError !== null && <p className="ide-rig-fail" role="alert">{rigErrorText(t, snapshotError)}</p>}
      </div>
    </section>
  );
}
