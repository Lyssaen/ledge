import { useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { PROJECT_COLORS, type OpenRigStatus, type Rig, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { isSeatPlaceholder, kernelFilter, kernelSplit, rigColor, rigFilter, seatSession, type rigsModel } from '@ledge/ui/rigs/model';
import { useI18n } from '../../i18n/lang';
import { taskOf } from '../../nav/agents';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { SessionBot } from '../SessionBot';
import { shortWhen } from './Tree';

const NO_SESSIONS: ReadonlyMap<string, Session> = new Map();
const flip = (set: Set<string>, k: string): Set<string> => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
const needs = (s: Session) => !s.offline && (s.state === 'waiting_permission' || s.state === 'waiting_input' || s.state === 'error');

/** The sidebar's Rigs section (spec §8.1): its title and « + », one row per rig (unfolded, its running seats as session rows), the
 *  OpenRig kernel last (folded, advisor and the human's terminal behind « +n »), or an invitation when OpenRig is absent or stopped.
 *  A seat with no Ledge session (`isSeatPlaceholder`) is shown read-only: no time, no task, no click, no menu.
 *  `byId` finds the paired sessions of the kernel's hidden seats (the model only carries the shown ones). */
export function RigsSection(p: {
  model: ReturnType<typeof rigsModel>; openrig: readonly OpenRigStatus[]; current: string | null;
  onOpenSeat(s: Session): void; onRoom(filter: string): void; onLaunch(): void; onMenu(id: string, e: MouseEvent): void;
  paused: boolean; dense: boolean; byId?: ReadonlyMap<string, Session>;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.side.rigs;
  // Rigs are unfolded by default, kernels folded: `flipped` holds the rows the user turned the other way.
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const [more, setMore] = useState<Set<string>>(() => new Set());
  const treeRef = useRef<HTMLDivElement>(null);
  const nav = useRef(new Map<string, { toggle?: () => void; open?: boolean; parent?: string }>());
  nav.current = new Map();

  const local = p.openrig.find(s => s.machine === 'local');
  const empty = p.model.rigs.length === 0 && p.model.kernels.length === 0;
  const invite = !empty || !local ? null
    : local.state === 'absent' ? r.absent
    : local.state === 'stopped' ? r.stopped
    : local.state === 'error' ? r.error
    : local.state === 'unsupported' ? r.unsupported(local.version)
    : null;

  const seatKey = (s: Session) => `seat:${s.id}`;
  const tabKey = (() => {
    const all = [...p.model.rigs.flatMap(x => x.seats), ...p.model.kernels.flatMap(k => k.shown)];
    const cur = p.current ? all.find(s => s.id === p.current) : undefined;
    if (cur) return seatKey(cur);
    return p.model.rigs[0] ? `rig:${p.model.rigs[0].key}` : p.model.kernels[0] ? `kernel:${p.model.kernels[0].key}` : '';
  })();
  const tab = (k: string) => (k === tabKey ? 0 : -1);

  const Chevron = ({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) => (
    <button type="button" tabIndex={-1} className="st-chev" aria-label={label} onClick={e => { e.stopPropagation(); onClick(); }}>
      <span className={open ? 'open' : undefined}><Icon d={ICONS.chevronRight.d} size={12} /></span>
    </button>
  );

  const seatRow = (s: Session, parent: string): ReactNode => {
    const ghost = isSeatPlaceholder(s.id);
    const key = seatKey(s);
    nav.current.set(key, { parent });
    const selected = !ghost && p.current === s.id;
    const task = ghost ? '' : taskOf(s);
    const timeClass = s.offline ? undefined : s.state === 'waiting_permission' ? 't-approval' : s.state === 'waiting_input' ? 't-question' : s.state === 'error' ? 't-error' : undefined;
    return (
      <div key={key} role="treeitem" aria-level={2} aria-selected={selected} aria-current={selected ? 'true' : undefined}
        className={cls('st-row st-agent st-seat', selected && 'sel', s.offline && 'off', ghost && 'ghost')} style={{ '--d': 1 } as CSSProperties}
        onContextMenu={ghost ? undefined : e => { e.preventDefault(); p.onMenu(s.id, e); }}>
        <span className="st-gap" />
        <span className="st-bot"><SessionBot session={s} size={18} paused={p.paused} /></span>
        <button type="button" className="st-main" data-tree-key={key} tabIndex={tab(key)} aria-disabled={ghost || undefined} title={ghost ? r.ghost : undefined}
          onClick={ghost ? undefined : () => p.onOpenSeat(s)}>
          <strong>{s.name}</strong>{task && <span>{task}</span>}
        </button>
        {!ghost && <span className={cls('st-time', needs(s) && timeClass)}>{s.offline ? t.side.offline : shortWhen(s.lastActivityAt, t.list.when.units, t.list.when.now)}</span>}
        {!ghost && (
          <span className="st-acts">
            <button type="button" tabIndex={-1} aria-label={t.side.manageOne(s.name)} aria-haspopup="menu" title={t.manage.menu.more} onClick={e => p.onMenu(s.id, e)}><Icon d={[]} fill={SHELL_ICONS.dots} size={13} /></button>
          </span>
        )}
      </div>
    );
  };

  const where = (rig: Rig) => (
    <>
      {rig.machine !== 'local' && <span className="mono st-rig-machine">· {rig.machine}</span>}
      {rig.lifecycle === 'unreachable' && <span className="st-rig-down">{r.unreachable}</span>}
    </>
  );

  const rows: ReactNode[] = [];
  for (const row of p.model.rigs) {
    const key = `rig:${row.key}`;
    const has = row.seats.length > 0;
    const open = has && !flipped.has(key);
    const toggle = has ? () => setFlipped(f => flip(f, key)) : undefined;
    nav.current.set(key, { toggle, open });
    const room = () => p.onRoom(rigFilter(row.rig));
    rows.push(
      <div key={key} role="treeitem" aria-level={1} aria-expanded={has ? open : undefined} className={cls('st-row st-project st-rig', row.rig.lifecycle === 'unreachable' && 'off')} style={{ '--d': 0 } as CSSProperties}>
        {toggle ? <Chevron open={open} label={open ? t.side.fold(row.rig.name) : t.side.unfold(row.rig.name)} onClick={toggle} /> : <span className="st-gap" />}
        <i className="side-swatch" style={{ background: PROJECT_COLORS[rigColor(row.rig)] }} />
        <button type="button" className="st-main" data-tree-key={key} tabIndex={tab(key)} title={r.room(row.rig.name)}
          onClick={toggle} onDoubleClick={room} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); room(); } }}>
          <strong>{row.rig.name}</strong>
          <span className="mono">{r.seats(row.seats.length)}</span>
          {row.place.kind === 'off' && <span className="st-rig-off">{r.off}</span>}
          {where(row.rig)}
        </button>
        <span className="st-tally">
          {row.waiting > 0 && <span className="t-need" title={`${row.waiting} ${t.side.tallyNeed}`}><i />{row.waiting}</span>}
          {row.working > 0 && <span className="t-work" title={`${row.working} ${t.side.tallyWork}`}><i />{row.working}</span>}
        </span>
      </div>
    );
    if (open) for (const s of row.seats) rows.push(seatRow(s, key));
  }
  for (const k of p.model.kernels) {
    const key = `kernel:${k.key}`;
    const open = flipped.has(key);
    const toggle = () => setFlipped(f => flip(f, key));
    nav.current.set(key, { toggle, open });
    const room = () => p.onRoom(kernelFilter(k.rig.machine));
    rows.push(
      <div key={key} role="treeitem" aria-level={1} aria-expanded={open} className={cls('st-row st-project st-kernel', k.rig.lifecycle === 'unreachable' && 'off')} style={{ '--d': 0 } as CSSProperties}>
        <Chevron open={open} label={open ? t.side.fold(r.kernel) : t.side.unfold(r.kernel)} onClick={toggle} />
        <i className="side-swatch st-kernel-swatch" />
        <button type="button" className="st-main" data-tree-key={key} tabIndex={tab(key)} title={r.room(r.kernel)}
          onClick={toggle} onDoubleClick={room} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); room(); } }}>
          <strong>{r.kernel}</strong><span className="mono">{r.kernelTag}</span>{where(k.rig)}
        </button>
      </div>
    );
    if (!open) continue;
    for (const s of k.shown) rows.push(seatRow(s, key));
    if (k.hiddenCount === 0) continue;
    if (more.has(key)) {
      const byId = p.byId ?? NO_SESSIONS;
      const live = { ...k.rig, seats: k.rig.seats.filter(x => x.state !== 'stopped') };
      for (const s of kernelSplit(live).hidden) rows.push(seatRow(seatSession(s, k.rig, byId), key));
    } else {
      const moreKey = `${key}:more`;
      nav.current.set(moreKey, { parent: key });
      rows.push(
        <div key={moreKey} className="st-row st-more" style={{ '--d': 1 } as CSSProperties}>
          <span className="st-gap" />
          <button type="button" data-tree-key={moreKey} tabIndex={tab(moreKey)} aria-expanded={false} onClick={() => setMore(m => flip(m, key))}>{r.more(k.hiddenCount)}</button>
        </div>
      );
    }
  }

  const onKey = (e: ReactKeyboardEvent) => {
    const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-tree-key]') : null;
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = nav.current.get(el.dataset.treeKey!);
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
    const i = items.indexOf(el);
    let done = true;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'ArrowLeft') { if (n?.toggle && n.open) n.toggle(); else items.find(x => x.dataset.treeKey === n?.parent)?.focus(); }
    else if (e.key === 'ArrowRight') { if (n?.toggle && !n.open) n.toggle(); else items[i + 1]?.focus(); }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  return (
    <section className="st-rigs" aria-label={r.title}>
      <div className="st-label">
        <span>{r.title}</span><span className="st-fill" />
        <button type="button" className="st-icon" aria-label={r.launch} title={r.launch} onClick={p.onLaunch}><Icon d={ICONS.plus.d} size={14} /></button>
      </div>
      {invite && (
        <p className="st-rig-invite" title={local?.detail}>
          <span>{invite}</span>
          {local?.state === 'absent' && local.install && <code className="st-rig-install">{local.install}</code>}
        </p>
      )}
      {rows.length > 0 && <div ref={treeRef} role="tree" aria-label={r.tree} className={cls('st-tree', p.dense && 'st-dense')} onKeyDown={onKey}>{rows}</div>}
    </section>
  );
}
