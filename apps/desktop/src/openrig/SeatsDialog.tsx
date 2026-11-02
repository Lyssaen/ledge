import { useId, useMemo, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { reseatRig } from '@ledge/fleet/openrig';
import { seatPlan, seatsByRole, type OpenRigReseated, type Rig } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { Modal } from '../shell/Modal';
import { isWorking } from './model';

/**
 * A running rig's seats (docs/mockups/ledge-openrig.html, view 7): a counter per role, the seats it adds (copies of the role's
 * first) and removes (the last copies first), how the added seats are linked, and the `rig` commands it runs. The rig keeps running.
 */
export function SeatsDialog({ client, machine, machineLabel, rig, onClose, onDone }: {
  client: DaemonClient; machine: string; machineLabel: string; rig: Rig; onClose: () => void; onDone: (r: OpenRigReseated) => void;
}) {
  const { t } = useI18n();
  const s = t.openrig.reseat;
  const body = useId();
  const roles = useMemo(() => seatsByRole(rig.nodes), [rig.nodes]);
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries([...roles].map(([role, ids]) => [role, ids.length])));
  const [delegation, setDelegation] = useState<'pairs' | 'all'>('pairs');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<OpenRigReseated | null>(null);
  const plan = seatPlan(rig.nodes, counts);
  const working = plan.remove.filter(id => { const n = rig.nodes.find(x => x.logicalId === id); return n && isWorking(n); });
  const commands = [
    ...plan.add.map(a => `rig add ${rig.name} ${a.pod} ${a.id}.json`),
    ...plan.remove.map(id => `rig remove ${rig.name} ${id}`),
    ...(plan.add.length ? [`rig edge add ${rig.name} … --kind …`] : []),
    ...(plan.add.length || plan.remove.length ? [`rig snapshot ${rig.name}`] : [])
  ];
  const first = (role: string) => rig.nodes.find(n => n.logicalId === roles.get(role)?.[0]);
  const apply = async () => {
    setBusy(true); setFailed(null);
    const r = await reseatRig(client, machine, rig.name, counts, plan.add.length ? delegation : undefined);
    setBusy(false);
    if (r.ok) onDone(r); else setFailed(r);
  };
  const now = [...roles].map(([role, ids]) => `${ids.length} ${role.split('.')[1]}`).join(', ');
  return (
    <Modal title={s.title(rig.name, machineLabel)} describedBy={body} className="confirm-modal or-confirm or-seats-dialog" wide onClose={onClose}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <p id={body}>{s.now(now)}</p>
        <div className="or-roles">
          {[...roles].map(([role, ids]) => {
            const n = counts[role] ?? ids.length, seat = first(role);
            const removed = new Set(plan.remove), added = plan.add.filter(a => a.role === role);
            return (
              <div key={role} className="or-role or-role-live">
                <span className="mono">{role}<small>{[seat?.runtime, seat?.model].filter(Boolean).join(' · ')}</small></span>
                <span className="or-chips">
                  {ids.map(id => <span key={id} className={cls('or-chip-seat', removed.has(id) && 'rm')}>{id.split('.')[1]}</span>)}
                  {added.map(a => <span key={a.id} className="or-chip-seat new">+ {a.id}</span>)}
                </span>
                <span className={cls('or-step', n !== ids.length && 'changed')}>
                  <button type="button" aria-label={s.fewer(role)} disabled={n <= 0 || busy} onClick={() => setCounts(c => ({ ...c, [role]: n - 1 }))}>−</button>
                  <span aria-live="polite">{n}</span>
                  <button type="button" aria-label={s.more(role)} disabled={n >= 9 || busy} onClick={() => setCounts(c => ({ ...c, [role]: n + 1 }))}>+</button>
                </span>
              </div>
            );
          })}
        </div>
        {plan.add.length > 0 && (
          <div className="or-seg" role="radiogroup" aria-label={s.delegation}>
            {(['pairs', 'all'] as const).map(d => <button key={d} type="button" role="radio" aria-checked={delegation === d} onClick={() => setDelegation(d)}>{s[d]}</button>)}
          </div>
        )}
        {working.map(id => <p key={id} className="or-warn-line">{s.working(id)}</p>)}
        {commands.length > 0 && <pre className="or-cmds" aria-label={s.command}>{commands.join('\n')}</pre>}
        {commands.length > 0 && <p className="or-hint">{s.snapshotNote}</p>}
        {failed && <div className="or-status or-err" role="alert"><p>{s.errors[failed.error ?? ''] ?? t.openrig.launch.errors[failed.error ?? ''] ?? t.openrig.failed(failed.error ?? '')}</p></div>}
        <div className="confirm-actions">
          <Button autoFocus onClick={onClose}>{s.cancel}</Button>
          <Button variant="primary" className={working.length ? 'danger-btn' : ''} disabled={busy || commands.length === 0} onClick={() => void apply()}>
            {busy ? s.applying : s.apply(plan.add.length, plan.remove.length)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
