import type { JSX, KeyboardEvent } from 'react';
import type { RigPlan } from '@ledge/protocol';
import { runtimeLabel } from '@ledge/ui/rigs/model';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';

/** The seat the goal goes to: the one named lead, else the first. */
export const leadOf = (plan: RigPlan): string => (plan.seats.find(s => /lead/.test(s.address)) ?? plan.seats[0])?.address.replace(/^@/, '') ?? '';

/** Step 2 of « Nouveau rig » (mockup l-2): who starts, what changes in the folder (with the copy, which makes a new plan), what Ledge does
 *  after the launch, and the `rig up` command. Optional behind « Voir le plan », imposed on a real repository. */
export function RigPlanView(p: {
  plan: RigPlan; busy: 'preparing' | 'launching' | null; refused: string | null;
  onCopy(): void; onBack(): void; onLaunch(): void;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.rigLaunch;
  const { plan } = p;
  const n = plan.seats.length;
  const kinds = new Set(plan.seats.map(s => s.runtime)).size;
  const busy = p.busy !== null;
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!busy) p.onLaunch(); } };
  return (
    <form className="composer rig-plan" onSubmit={e => { e.preventDefault(); if (!busy) p.onLaunch(); }} onKeyDown={onKeyDown}>
      <div className="composer-body">
        <section aria-label={c.starts(n)}>
          <span className="composer-label">{c.starts(n)}</span>
          <ul className="rig-plan-box rig-plan-seats">
            {plan.seats.map(s => (
              <li key={s.address}><code className="rig-plan-address">{s.address}</code>{[runtimeLabel(s.runtime), s.model, s.autonomy].filter(Boolean).join(' · ')}</li>
            ))}
          </ul>
        </section>
        <section aria-label={c.changes(plan.cwd)}>
          <span className="composer-label">{c.changes(plan.cwd)}</span>
          <div className="rig-plan-box">
            <p>{c.writes} {plan.writes.map((w, i) => <span key={w}>{i > 0 && ', '}<code>{w}</code></span>)}.</p>
            {plan.where.kind === 'project' && (
              <button type="button" className={cls('chip', plan.where.copy && 'selected')} aria-pressed={plan.where.copy} aria-disabled={busy}
                onClick={() => { if (!busy) p.onCopy(); }}>
                {plan.where.copy && <Icon d={ICONS.check.d} size={12} />}{c.copyChip(plan.spec)}
              </button>
            )}
          </div>
        </section>
        <section aria-label={c.after}>
          <span className="composer-label">{c.after}</span>
          <p className="rig-plan-box rig-plan-after"><span className="rig-flag" aria-hidden="true">⚑</span>{c.afterText(leadOf(plan), n)}</p>
        </section>
      </div>
      <footer className="composer-footer rig-launch-footer">
        <div className="composer-preview">
          <span className="rig-flag" aria-hidden="true">⚑</span>
          <span><span className="preview-line"><strong>{c.planFoot(n, kinds)}</strong></span><small><code>{plan.command}</code></small></span>
        </div>
        {/* A launch in flight is not left: its answer closes the window on Rigs › En cours. */}
        <Button variant="ghost" type="button" aria-disabled={p.busy === 'launching'} onClick={() => { if (p.busy !== 'launching') p.onBack(); }}>{c.back}</Button>
        <Button variant="primary" type="submit" aria-disabled={busy}>{p.busy === 'launching' ? c.launching : c.launch}<Kbd>Ctrl ↵</Kbd></Button>
      </footer>
      {p.busy === 'preparing' ? <p className="rig-launch-status" role="status">{c.preparing}</p>
        : p.refused ? <p className="composer-missing rig-launch-status" role="alert">{c.refused(p.refused)}</p> : null}
    </form>
  );
}
