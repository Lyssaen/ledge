import { useState, type CSSProperties, type JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../i18n/lang';
import type { NavAction } from '../../nav/state';
import type { SidebarOpenRig } from '../../openrig/sidebarState';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { SessionBot } from '../SessionBot';

const KERNEL = 'kernel';
const waiting = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error';
type Tag = 'ready' | 'starting' | 'stopped';
/** The kernel tag's word and dot (the user: « état réel ») : ready, starting, and every other state as stopped. */
const tagOf = (state: string): Tag => (state === 'ready' ? 'ready' : state === 'starting' ? 'starting' : 'stopped');
const RANK: Record<Tag, number> = { ready: 0, starting: 1, stopped: 2 };
/** The kernel's seats may live on several machines: the tag says the worst of their states (stopped, then starting, then
 *  ready), never « opérationnel » while one is down; `per` lists each machine's, for the tooltip. Null until one is read. */
export function kernelTagOf(machines: readonly string[], stateOf: (machine: string) => string | undefined): { tag: Tag; per: Array<[string, Tag]> } | null {
  const per = machines.flatMap(m => { const st = stateOf(m); return st === undefined ? [] : [[m, tagOf(st)] as [string, Tag]]; });
  if (per.length === 0) return null;
  return { tag: per.reduce<Tag>((worst, [, t]) => (RANK[t] > RANK[worst] ? t : worst), 'ready'), per };
}

/**
 * The OpenRig seats Ledge follows, away from the projects (docs/mockups/ledge-sidebar-tidy.html): « Kernel » first, in its box,
 * with the kernel's real state; then « Rigs », one row per rig with its seats under it, and the header's options. A seat that ended
 * is left out. Without a seat, the box OpenRig's state calls for: stopped, starting, failed, or no rig yet.
 */
export function RigGroups({ sessions, current, paused, dispatch, openrig, dense, onToggleDense }: {
  sessions: readonly Session[]; current: string | null; paused: boolean; dispatch: (a: NavAction) => void;
  openrig?: SidebarOpenRig | undefined; dense: boolean; onToggleDense(): void;
}): JSX.Element | null {
  const { t } = useI18n();
  const o = t.openrig;
  const e = t.side.empty;
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const live = sessions.filter(s => s.rig && s.state !== 'exited');
  const kernel = live.filter(s => s.rig!.name === KERNEL);
  const rigs = new Map<string, Session[]>();
  for (const s of live) if (s.rig!.name !== KERNEL) rigs.set(s.rig!.name, [...(rigs.get(s.rig!.name) ?? []), s]);
  const launch = () => dispatch({ type: 'openrig', section: 'rigs', open: { launch: true } });
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

  if (live.length === 0) {
    if (!openrig) return null;
    const openPage = <button type="button" className="st-empty-link" onClick={() => dispatch({ type: 'openrig', section: 'rigs' })}>{e.openPage}</button>;
    const box = (title: string, body: JSX.Element, action: JSX.Element) => <div className="st-empty" role="status"><strong>{title}</strong>{body}{action}</div>;
    if (openrig.starting) return box(e.stopped, <p>{e.stoppedBody}</p>, <button type="button" className="st-empty-btn" disabled><i className="st-spin" aria-hidden="true" />{e.starting}</button>);
    if (!openrig.daemonUp && openrig.canStart && openrig.failed !== null) {
      const why = openrig.failed === 'busy' ? o.busy : openrig.failed === 'not_installed' ? o.notInstalled : openrig.failed === 'offline' ? o.offline : openrig.failed === 'outdated' ? o.outdated : o.failed(openrig.failed);
      return box(e.stopped, <p className="err">{why}</p>, <>
        <button type="button" className="st-empty-btn" onClick={openrig.start}><Icon d={SHELL_ICONS.play} size={12} />{e.retry}</button>
        {openPage}
      </>);
    }
    if (!openrig.daemonUp && openrig.installed) {
      // « Démarrer OpenRig » acts on this computer only: without OpenRig here (or this computer unreachable), the page's link alone.
      if (!openrig.canStart) return <div className="st-empty" role="status"><strong>{e.stopped}</strong>{openPage}</div>;
      return box(e.stopped, <p>{e.stoppedBody}</p>, <button type="button" className="st-empty-btn" onClick={openrig.start}><Icon d={SHELL_ICONS.play} size={12} />{e.start}</button>);
    }
    if (!openrig.daemonUp) return null;
  }

  const operator = kernel.find(s => (s.rig!.role ?? s.rig!.seat).startsWith('operator'));
  const kernelMachines = [...new Set(kernel.map(s => s.machineId ?? 'local'))];
  const kt = openrig ? kernelTagOf(kernelMachines, m => openrig.kernelState(m)) : null;
  const tag = kt?.tag ?? null;
  // Several machines: each one's state in the tooltip (« WSL · opérationnel »); one machine, nothing more on screen.
  const tagTitle = kt && kernelMachines.length > 1 ? kt.per.map(([m, x]) => `${openrig!.labelOf(m)} · ${t.side.kernelTag[x]}`).join('\n') : undefined;
  return (
    <>
      {kernel.length > 0 && (
        <section className="st-kernel-box" aria-label={t.side.kernel}>
          <div className="st-label">
            <span className="st-kernel-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={12} /></span><span className="st-kernel-name">{t.side.kernel}</span><span className="st-fill" />
            {tag && <span className="st-kernel-tag" data-state={tag} title={tagTitle}><i aria-hidden="true" />{t.side.kernelTag[tag]}</span>}
          </div>
          <div role="tree" aria-label={t.side.kernel}>{kernel.map(s => row(s, 0))}</div>
        </section>
      )}
      <section aria-label={t.side.rigs}>
        <div className="st-label">
          <span>{t.side.rigs}</span><span className="st-fill" />
          <button type="button" className={cls('st-icon', dense && 'on')} aria-pressed={dense} aria-label={t.side.dense} title={t.side.dense} onClick={onToggleDense}>
            <Icon d={SHELL_ICONS.densityTight} size={14} />
          </button>
          <button type="button" className="st-icon" aria-label={t.side.foldAll} title={t.side.foldAll} onClick={() => setClosed(new Set(rigs.keys()))}>
            <Icon d={SHELL_ICONS.foldAll} size={14} />
          </button>
          <button type="button" className="st-icon" aria-label={o.launch.open} title={o.launch.open} onClick={launch}>
            <Icon d={ICONS.plus.d} size={14} />
          </button>
        </div>
        {rigs.size === 0
          ? <div className="st-empty" role="status">
              <strong>{e.noRig}</strong>
              <p>{e.noRigBody}{operator && ` ${e.noRigOperator(operator.name)}`}</p>
              <button type="button" className="st-empty-btn" onClick={launch}><Icon d={ICONS.plus.d} size={13} />{o.launch.open}</button>
            </div>
          : <div role="tree" aria-label={t.side.rigs}>
              {[...rigs].sort(([a], [b]) => a.localeCompare(b)).map(([name, seats]) => {
                const open = !closed.has(name);
                const flip = () => setClosed(c => { const n = new Set(c); if (n.has(name)) n.delete(name); else n.add(name); return n; });
                const ask = seats.filter(waiting).length, working = seats.filter(x => x.state === 'working').length;
                const machine = seats[0]!.machineId ?? 'local';
                return [
                  <div key={`rig:${name}`} role="treeitem" aria-level={1} aria-expanded={open} className="st-row st-project st-rig" style={{ '--d': 0 } as CSSProperties}>
                    <button type="button" className="st-chev" aria-label={open ? t.side.fold(name) : t.side.unfold(name)} onClick={flip}><span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span></button>
                    <span className="st-rig-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={13} /></span>
                    <button type="button" className="st-main" title={t.side.rigOf(name)} onClick={() => dispatch({ type: 'openrig' })}>
                      <strong>{name}</strong><span className="mono">{seats[0]!.cwd.split('/').filter(Boolean).at(-1) ?? ''}</span>
                    </button>
                    <span className="st-tally">{ask > 0 && <span className="t-need" title={t.side.rigAsks(ask)}><i />{ask}</span>}{working > 0 && <span className="t-work"><i />{working}</span>}</span>
                    <span className="st-acts">
                      <button type="button" aria-label={o.reseat.openLabel(name)} title={o.reseat.openLabel(name)} onClick={() => dispatch({ type: 'openrig', machine, section: 'rigs', open: { reseat: name } })}>
                        <Icon d={ICONS.plus.d} size={13} />
                      </button>
                    </span>
                  </div>,
                  ...(open ? seats.map(s => row(s, 1)) : [])
                ];
              })}
            </div>}
      </section>
    </>
  );
}
