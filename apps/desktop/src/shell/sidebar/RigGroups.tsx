import { useState, type CSSProperties, type JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import type { NavAction } from '../../nav/state';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { SessionBot } from '../SessionBot';

const KERNEL = 'kernel';
const waiting = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error';

/**
 * The OpenRig seats Ledge follows, away from the projects (docs/mockups/ledge-openrig-groups.html, view 1): « Rigs », one row per
 * rig with its seats under it, and « Kernel », the operator, the advisor and the queue together. A seat that ended is left out.
 */
export function RigGroups({ sessions, current, paused, dispatch }: { sessions: readonly Session[]; current: string | null; paused: boolean; dispatch: (a: NavAction) => void }): JSX.Element | null {
  const { t } = useI18n();
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const live = sessions.filter(s => s.rig && s.state !== 'exited');
  const kernel = live.filter(s => s.rig!.name === KERNEL);
  const rigs = new Map<string, Session[]>();
  for (const s of live) if (s.rig!.name !== KERNEL) rigs.set(s.rig!.name, [...(rigs.get(s.rig!.name) ?? []), s]);
  const row = (s: Session, depth: number) => (
    <div key={s.id} role="treeitem" aria-level={depth + 1} aria-selected={current === s.id} className={cls('st-row st-agent', current === s.id && 'sel')} style={{ '--d': depth } as CSSProperties}>
      <span className="st-gap" />
      <span className="st-bot"><SessionBot session={s} size={18} paused={paused} /></span>
      <button type="button" className="st-main" onClick={() => dispatch({ type: 'open', id: s.id })}>
        <strong>{s.name}</strong><span className="mono">{[s.rig!.role?.replace(/\.agent$|\.lead$|\.worker$/, '') ?? s.rig!.seat, s.tool].join(' · ')}</span>
      </button>
      <span className={cls('st-time', waiting(s) && (s.state === 'waiting_permission' ? 't-approval' : s.state === 'waiting_input' ? 't-question' : 't-error'))}>{s.offline ? t.side.offline : ''}</span>
    </div>
  );
  if (live.length === 0) return null;
  return (
    <>
      {rigs.size > 0 && (
        <section aria-label={t.side.rigs}>
          <div className="st-label"><span>{t.side.rigs}</span><span className="st-fill" /></div>
          <div role="tree" aria-label={t.side.rigs}>
            {[...rigs].sort(([a], [b]) => a.localeCompare(b)).map(([name, seats]) => {
              const open = !closed.has(name);
              const flip = () => setClosed(c => { const n = new Set(c); if (n.has(name)) n.delete(name); else n.add(name); return n; });
              const ask = seats.filter(waiting).length, working = seats.filter(x => x.state === 'working').length;
              return [
                <div key={`rig:${name}`} role="treeitem" aria-level={1} aria-expanded={open} className="st-row st-project st-rig" style={{ '--d': 0 } as CSSProperties}>
                  <button type="button" className="st-chev" aria-label={open ? t.side.fold(name) : t.side.unfold(name)} onClick={flip}><span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span></button>
                  <span className="st-rig-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={13} /></span>
                  <button type="button" className="st-main" title={t.side.rigOf(name)} onClick={() => dispatch({ type: 'openrig' })}>
                    <strong>{name}</strong><span className="mono">{seats[0]!.cwd.split('/').filter(Boolean).at(-1) ?? ''}</span>
                  </button>
                  <span className="st-tally">{ask > 0 && <span className="t-need" title={t.side.rigAsks(ask)}><i />{ask}</span>}{working > 0 && <span className="t-work"><i />{working}</span>}</span>
                </div>,
                ...(open ? seats.map(s => row(s, 1)) : [])
              ];
            })}
          </div>
        </section>
      )}
      {kernel.length > 0 && (
        <section aria-label={t.side.kernel}>
          <div className="st-label"><span className="st-kernel-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={12} /></span><span>{t.side.kernel}</span><span className="st-fill" /></div>
          <div role="tree" aria-label={t.side.kernel}>{kernel.map(s => row(s, 0))}</div>
        </section>
      )}
    </>
  );
}
