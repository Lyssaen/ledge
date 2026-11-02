import { useId, useState } from 'react';
import type { OpenRigView } from '@ledge/fleet/openrig';
import { EffortSchema, ModelIdSchema, type OpenRigAction, type OpenRigDone, type RigSeat, type SeatPermissions } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { commandsOf } from './model';

const RUNTIMES = ['codex', 'claude-code'] as const;
const EFFORTS = ['low', 'medium', 'high', 'max'] as const;
const PERMISSIONS: readonly SeatPermissions[] = ['inherit', 'floor', 'auto', 'full_bypass'];

/** The action the dialog sends: only what the person changed; null when nothing is. */
export function seatAction(seat: RigSeat, f: { runtime: string; model: string; effort: string | null; permissions: SeatPermissions | null }, dryRun = false): Extract<OpenRigAction, { kind: 'seat.set' }> | null {
  const runtime = f.runtime !== seat.runtime && (f.runtime === 'codex' || f.runtime === 'claude-code') ? f.runtime : undefined;
  const model = f.model.trim() && f.model.trim() !== (seat.model ?? '') && ModelIdSchema.safeParse(f.model.trim()).success ? f.model.trim() : undefined;
  const effort = f.effort && EffortSchema.safeParse(f.effort).success ? f.effort : undefined;
  const permissions = f.permissions ?? undefined;
  if (!runtime && !model && !effort && !permissions) return null;
  return { kind: 'seat.set', seat: seat.session, ...(runtime ? { runtime } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(permissions ? { permissions } : {}), ...(dryRun && runtime ? { dryRun: true } : {}) };
}

/**
 * A seat's settings (docs/mockups/ledge-openrig-groups.html, view 2): its harness, moved now by OpenRig through a successor that
 * takes its context (« Voir le plan » shows it first), and its model, effort and permissions for its next resume. The commands
 * show before anything runs.
 */
export function SeatSettings({ seat, rig, view, onClose }: { seat: RigSeat; rig: string; view: OpenRigView; onClose: () => void }) {
  const { t } = useI18n();
  const s = t.openrig.seatSettings;
  const body = useId();
  const [runtime, setRuntime] = useState(seat.runtime);
  const [model, setModel] = useState(seat.model ?? '');
  const [effort, setEffort] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<SeatPermissions | null>(null);
  const [plan, setPlan] = useState<OpenRigDone | null>(null);
  const [done, setDone] = useState<OpenRigDone | null>(null);
  const form = { runtime, model, effort, permissions };
  const action = seatAction(seat, form);
  const moves = !!action?.runtime;
  const busy = view.pending !== null;
  const send = async (dry: boolean) => {
    const a = seatAction(seat, form, dry);
    if (!a) return;
    const d = await view.act(a);
    if (dry) setPlan(d); else { setDone(d); if (d.ok) onClose(); }
  };
  const label = (x: string) => (x === 'claude-code' ? 'Claude Code' : x === 'codex' ? 'Codex' : x);
  return (
    <Modal title={s.title(seat.logicalId, rig)} describedBy={body} className="confirm-modal or-confirm or-seat-settings" wide onClose={onClose}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <p id={body}>{s.now([label(seat.runtime), seat.model].filter(Boolean).join(' · '))}</p>
        <div className="or-setgrid">
          <span className="or-setlabel">{s.runtime}<span className="or-when now">{s.whenNow}</span></span>
          <div className="or-seg" role="radiogroup" aria-label={s.runtime}>
            {RUNTIMES.map(r => <button key={r} type="button" role="radio" aria-checked={runtime === r} onClick={() => { setRuntime(r); setPlan(null); }}>{label(r)}</button>)}
          </div>
          <span className="or-setlabel">{s.model}<span className="or-when">{moves ? s.whenNow : s.whenResume}</span></span>
          <input className="ledge-field mono" aria-label={s.model} value={model} placeholder={s.modelPlaceholder} spellCheck={false} onChange={e => { setModel(e.target.value); setPlan(null); }} />
          <span className="or-setlabel">{s.effort}<span className="or-when">{moves ? s.whenNow : s.whenResume}</span></span>
          <div className="or-seg" role="radiogroup" aria-label={s.effort}>
            <button type="button" role="radio" aria-checked={effort === null} onClick={() => setEffort(null)}>{s.unchanged}</button>
            {EFFORTS.map(e => <button key={e} type="button" role="radio" aria-checked={effort === e} onClick={() => { setEffort(e); setPlan(null); }}>{e}</button>)}
          </div>
          <span className="or-setlabel">{s.permissions}<span className="or-when">{s.whenLaunch}</span></span>
          <div className="or-seg or-seg-wrap" role="radiogroup" aria-label={s.permissions}>
            <button type="button" role="radio" aria-checked={permissions === null} onClick={() => setPermissions(null)}>{s.unchanged}</button>
            {PERMISSIONS.map(p => <button key={p} type="button" role="radio" aria-checked={permissions === p} className={p === 'full_bypass' ? 'or-risky' : undefined} onClick={() => { setPermissions(p); setPlan(null); }}>{s.perm[p]}</button>)}
          </div>
        </div>
        {moves && <p className="or-hint">{s.moveNote(label(seat.runtime), label(runtime))}</p>}
        {action && <pre className="or-cmds" aria-label={t.openrig.confirm.command}>{commandsOf(action).join('\n')}</pre>}
        {plan && <pre className={plan.ok ? 'or-cmds or-plan' : 'or-cmds or-plan or-plan-err'} aria-label={s.planTitle}>{plan.ok ? plan.output ?? s.planEmpty : plan.error}</pre>}
        {done && !done.ok && <div className="or-status or-err" role="alert"><p>{t.openrig.failed(done.error ?? '')}</p></div>}
        <div className="confirm-actions">
          <Button onClick={onClose}>{t.openrig.confirm.cancel}</Button>
          {moves && <Button disabled={busy} onClick={() => void send(true)}>{s.seePlan}</Button>}
          <Button variant="primary" disabled={!action || busy} onClick={() => void send(false)}>{busy ? s.applying : moves ? s.move(label(runtime)) : s.save}</Button>
        </div>
      </div>
    </Modal>
  );
}
