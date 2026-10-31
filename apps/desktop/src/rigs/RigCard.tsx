import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { PROJECT_COLORS, type OpenRigStatus, type Rig, type RigSeat, type Session } from '@ledge/protocol';
import { kernelSplit, readyCount, rigColor, runtimeLabel, workingCount, type RigPlace } from '@ledge/ui/rigs/model';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { isLaunching } from './LaunchNote';
import { Menu, MenuItem } from '../shell/Menu';

/** A seat's line: address, name, state, « · {outil} · {modèle} · contexte {p} % ». A seat paired with a Ledge session is a button that opens it. */
function SeatLine({ seat, paired, onOpen, action }: { seat: RigSeat; paired: Session | undefined; onOpen(id: string): void; action?: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const rest = [runtimeLabel(seat.runtime), seat.model, seat.contextPct !== undefined ? r.context(Math.round(seat.contextPct)) : undefined].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="rc-address mono">{seat.address}</span>
      <strong className="rc-name">{seat.name}</strong>
      <span className={cls('rc-state', `rc-${seat.state}`)}>{r.seatState[seat.state]}</span>
      {rest && <span className="rc-rest">· {rest}</span>}
    </>
  );
  return (
    <li className="rc-seat" data-seat={seat.ref}>
      {paired
        ? <button type="button" className="rc-seat-main" aria-label={r.open(seat.name)} onClick={() => onOpen(paired.id)}>{body}</button>
        : <span className="rc-seat-main">{body}</span>}
      {action}
    </li>
  );
}

/** « Terminaux »: one item per running seat, each opening that seat's terminal. */
function Terminals({ rig, name, onTerminal }: { rig: Rig; name: string; onTerminal(seat: RigSeat): void }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const seats = rig.seats.filter(s => s.state !== 'stopped');
  return (
    <Menu open={open} onOpenChange={setOpen} label={t.rigsTab.terminalsOf(name)} className="rc-menu-wrap" menuClassName="assign-menu rc-menu"
      trigger={tr => <button type="button" className="st-qa" disabled={seats.length === 0} {...tr}>{t.rigsTab.terminals}</button>}>
      {seats.map(s => <MenuItem key={s.ref} onSelect={() => onTerminal(s)}><span>{s.name}</span></MenuItem>)}
    </Menu>
  );
}

/**
 * A rig of the Rigs tab, « En cours » (spec §8.2, maquette p-rigs-live): its flag, name, « rig · n sièges · {lieu} · ⎇ {branche} · spec
 * {spec} » (each missing piece left out), « sur {machine} » when remote, the share of seats at work (« {r}/{n} prêts » while it launches),
 * « Table » and « Terminaux », then one line per seat. `actions`, `seatAction` and `footer` are what acts on it (lot 5: `RigsLive`).
 */
export function RigCard(p: {
  rig: Rig; place: RigPlace; byId: ReadonlyMap<string, Session>; onTable(): void; onTerminal(seat: RigSeat): void; onOpen(id: string): void;
  actions?: ReactNode; seatAction?: (seat: RigSeat) => ReactNode; footer?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  // One rule everywhere (sidebar, atelier plaque): a stopped seat is not at the table.
  const rig = { ...p.rig, seats: p.rig.seats.filter(x => x.state !== 'stopped') };
  const n = rig.seats.length;
  // A rig Ledge launched says « démarre » until its goal is given (lot 5); its seats count as ready, as any rig whose seats start.
  const starting = isLaunching(rig);
  const launching = starting || rig.lifecycle === 'launching';
  const count = launching ? readyCount(rig) : workingCount(rig);
  const pieces = [r.rig, starting ? t.rigActions.starting : r.seats(n),
    p.place.kind === 'project' ? r.inProject(p.place.name) : p.place.kind === 'off' ? r.off : null,
    rig.branch ? r.branch(rig.branch) : null,
    rig.spec ? `${r.spec} ${rig.spec}` : null,
    rig.machine !== 'local' ? r.onMachine(rig.machine) : null,
    rig.lifecycle === 'unreachable' ? t.side.rigs.unreachable : null].filter((x): x is string => !!x);
  return (
    <article className={cls('rig-card', rig.lifecycle === 'unreachable' && 'off')} aria-label={rig.name} data-rig={`${rig.machine}/${rig.id}`}
      style={{ '--rig': PROJECT_COLORS[rigColor(rig)] } as CSSProperties}>
      <header className="rc-head">
        <span className="rc-flag" aria-hidden="true">⚑</span>
        <strong className="rc-title">{rig.name}</strong>
        <span className="rc-meta" title={p.place.kind === 'off' ? p.place.cwd : undefined}>{pieces.join(' · ')}</span>
        <span className="st-fill" />
        <span className="rc-bar" aria-hidden="true"><i style={{ width: `${n ? (count / n) * 100 : 0}%` }} /></span>
        <span className="rc-count">{launching ? r.ready(count, n) : r.working(count, n)}</span>
        <button type="button" className="st-qa" title={r.tableTitle(rig.name)} onClick={p.onTable}>{r.table}</button>
        <Terminals rig={rig} name={rig.name} onTerminal={p.onTerminal} />
        {p.actions}
      </header>
      <ul className="rc-seats">
        {rig.seats.map(s => <SeatLine key={s.ref} seat={s} paired={s.sessionId ? p.byId.get(s.sessionId) : undefined} onOpen={p.onOpen} action={p.seatAction?.(s)} />)}
      </ul>
      {p.footer}
    </article>
  );
}

/**
 * The OpenRig kernel of a machine (spec §8.2): « Noyau OpenRig · la mécanique · operator et queue · toujours allumé », « au repos » when no
 * seat works, « Santé » unfolding OpenRig's state on that machine (version, the human registered or not). Advisor and the human's terminal
 * wait behind « +n ».
 */
export function KernelCard({ rig, byId, status, onOpen }: { rig: Rig; byId: ReadonlyMap<string, Session>; status: OpenRigStatus | undefined; onOpen(id: string): void }): JSX.Element {
  const { t } = useI18n();
  const r = t.rigsTab;
  const [more, setMore] = useState(false);
  const [health, setHealth] = useState(false);
  const { shown, hidden } = kernelSplit({ ...rig, seats: rig.seats.filter(x => x.state !== 'stopped') });
  const seats = more ? [...shown, ...hidden] : shown;
  const name = t.side.rigs.kernel;
  return (
    <article className="rig-card rig-kernel" aria-label={name} data-rig={`${rig.machine}/${rig.id}`}>
      <header className="rc-head">
        <span className="rc-flag" aria-hidden="true">⚑</span>
        <strong className="rc-title">{name}</strong>
        <span className="rc-meta">{[r.kernelWhat, rig.machine !== 'local' ? r.onMachine(rig.machine) : null].filter(Boolean).join(' · ')}</span>
        <span className="st-fill" />
        {workingCount(rig) === 0 && <span className="rc-count">{r.rest}</span>}
        <button type="button" className="st-qa" aria-expanded={health} onClick={() => setHealth(h => !h)}>{r.health}</button>
      </header>
      {health && (
        <p className="rc-health">
          {[r.version(status?.version), status ? r.openrigState[status.state] : null, status?.human ? r.human[status.human] : null].filter(Boolean).join(' · ')}
          {status?.detail && <small> · {status.detail}</small>}
        </p>
      )}
      <ul className="rc-seats">
        {seats.map(s => <SeatLine key={s.ref} seat={s} paired={s.sessionId ? byId.get(s.sessionId) : undefined} onOpen={onOpen} />)}
        {!more && hidden.length > 0 && <li className="rc-seat"><button type="button" className="rc-more" aria-expanded={false} onClick={() => setMore(true)}>{t.side.rigs.more(hidden.length)}</button></li>}
      </ul>
    </article>
  );
}
