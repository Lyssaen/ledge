import { useEffect, useId, useState } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { isNative } from '../native/mode';
import { useOpenRig, useOpenRigRoles, type OpenRigView } from '@ledge/fleet/openrig';
import type { OpenRigAction, OpenRigState, Projects, Rig, RigSeat, RoleSummary, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction, OpenRigOpen } from '../nav/state';
import { cls } from '../shell/cls';
import { Modal } from '../shell/Modal';
import { openUrl } from '../tauri/bridge';
import { RigLaunchForm } from './RigLaunchForm';
import { SeatsDialog } from './SeatsDialog';
import { SeatSettings } from './SeatSettings';
import { asksFirst, commandsOf, isRunning, kernelRig, listedRigs, rigOf, targetOf, workingSeats } from './model';
import { forgetRoleFiles } from './roles/bits';
import { rolesBySeat } from './roles/model';
import { RolesView } from './roles/RolesView';

export const OPENRIG_INSTALL_URL = 'https://github.com/mvschwarz/openrig#readme';

type Tone = 'ok' | 'off' | 'info' | 'warn' | 'err';
const Pill = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`or-pill or-${tone}`}>{children}</span>;
const Dot = ({ tone }: { tone: Tone }) => <span className={`or-dot or-${tone}`} aria-hidden />;

/** The machine the OpenRig page shows: the one asked, else this computer's, else the first. In native mode (Windows
 *  without WSL) OpenRig never runs on this computer: the first SSH machine (the EC2) comes first. */
export function openRigMachine<M extends Pick<MachineState, 'id' | 'ssh'>>(machines: readonly M[], machine: string | undefined, native: boolean): M | undefined {
  const asked = machines.find(m => m.id === machine);
  if (asked) return asked;
  return (native ? machines.find(m => !!m.ssh) : undefined) ?? machines.find(m => m.id === 'local') ?? machines[0];
}

/**
 * OpenRig on a machine (docs/mockups/ledge-openrig.html, view 1): the machines on top, the daemon and the kernel, then
 * the rigs, each unfolding its seats. A stop or a restart asks first (view 2); every action shows the `rig` command it runs.
 */
export function OpenRigPage({ client, machines, machine, section = 'rigs', role, seat, open, projects = null, sessions = [], dispatch }: { client: DaemonClient; machines: readonly MachineState[]; machine?: string; section?: 'rigs' | 'roles'; role?: string; seat?: string; open?: OpenRigOpen | undefined; projects?: Projects | null; sessions?: readonly Session[]; dispatch: (a: NavAction) => void }) {
  const { t, lang } = useI18n();
  const o = t.openrig;
  const shown = openRigMachine(machines, machine, isNative());
  const id = shown?.id ?? 'local';
  const rig = useOpenRig(client, shown?.ready === false ? null : id);
  // The roles (docs/mockups/ledge-openrig-roles.html): asked once per machine, for the Roles view, its count and each seat's role link.
  const roles = useOpenRigRoles(client, shown?.ready === false ? null : id);
  const bySeat = rolesBySeat(roles.roles);
  const onRoles = section === 'roles';
  const [rolesAt, setRolesAt] = useState(0);
  const [ask, setAsk] = useState<OpenRigAction | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState<string | null>(null);
  const [reseating, setReseating] = useState<string | null>(null);
  const [reseated, setReseated] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ seat: RigSeat; rig: string } | null>(null);
  // Arriving with a dialog to open (the sidebar's « Lancer un rig… » and a rig row's « + »): each arrival opens it once.
  useEffect(() => {
    if (!open) return;
    if ('launch' in open) { setLaunched(null); setLaunching(true); } else { setReseated(null); setReseating(open.reseat); }
  }, [open]);
  const run = (a: OpenRigAction) => { if (asksFirst(a)) setAsk(a); else void rig.act(a); };
  const label = shown?.label ?? id;
  const time = (at: number | string) => new Date(at).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB');
  // When the roles were last read, for « mis à jour à » on the Roles view.
  const rolesReady = roles.status === 'ready';
  useEffect(() => { if (rolesReady) setRolesAt(Date.now()); }, [rolesReady, roles.roles]);
  const [refreshed, setRefreshed] = useState(0);
  const refresh = () => { rig.refresh(); forgetRoleFiles(); roles.reload(); setRefreshed(n => n + 1); };
  const rolesCount = rolesReady && !roles.error ? roles.roles.length : null;
  const version = roles.openrigVersion ?? rig.state?.version;
  return (
    <div className={onRoles ? 'or-page or-page-roles' : 'or-page'} aria-label={o.title}>
      <div className="or-head">
        <div className="orr-seg orr-views" role="group" aria-label={o.roles.views}>
          <button type="button" aria-pressed={!onRoles} onClick={() => dispatch({ type: 'openrig', section: 'rigs' })}>{o.roles.rigs}</button>
          <button type="button" aria-pressed={onRoles} onClick={() => dispatch({ type: 'openrig', section: 'roles' })}>{o.roles.roles}{rolesCount !== null && <small>{rolesCount}</small>}</button>
        </div>
        <div className="or-machines" role="tablist" aria-label={o.machines}>
          {machines.map(m => (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === id} className="or-chip" onClick={() => dispatch({ type: 'openrig', machine: m.id })}>
              <Dot tone={m.ready ? 'ok' : 'off'} />{m.label}{!m.ready && <small>· {o.machineOffline}</small>}
            </button>
          ))}
        </div>
        <span className="or-fill" />
        {onRoles && <span className="or-pill or-off">{o.roles.readOnly}</span>}
        {onRoles
          ? rolesReady && !roles.error && <small className="or-meta">{version ? `${o.version(version)} · ` : ''}{o.updated(time(rolesAt))}</small>
          : rig.state && <small className="or-meta">{rig.state.version ? `${o.version(rig.state.version)} · ` : ''}{o.updated(time(rig.state.at))}</small>}
        <Button variant="ghost" size="sm" aria-label={o.refresh} title={o.refresh} onClick={refresh} disabled={shown?.ready === false}><Icon d={ICONS.refresh.d} size={14} /></Button>
        {!onRoles && rig.state?.installed && !launching && <Button size="sm" onClick={() => { setLaunched(null); setLaunching(true); }}><Icon d={ICONS.plus.d} size={13} />{o.launch.open}</Button>}
      </div>
      {onRoles ? (shown && !shown.ready ? <p className="or-empty" role="status">{o.offline}</p>
        : <RolesView client={client} machine={id} machineLabel={label} roles={roles} {...(role !== undefined ? { roleId: role } : {})} {...(seat !== undefined ? { seat } : {})} refreshed={refreshed} dispatch={dispatch} />) : <>
      {launched && !launching && <p className="or-status or-ok" role="status"><Icon d={ICONS.check.d} size={13} />{o.launch.launched(launched)}</p>}
      {launching
        ? <RigLaunchForm client={client} machine={id} machineLabel={label} projects={projects} onClose={() => setLaunching(false)} onLaunched={name => { setLaunching(false); setLaunched(name); rig.refresh(); }} />
        : <Body view={rig} machine={shown} onAct={run} onSeats={name => { setReseated(null); setReseating(name); }}
            operator={operatorOf(rig.state, sessions, id)} sessionOf={seat => sessionOfSeat(sessions, seat, id)} onOpen={sid => dispatch({ type: 'open', id: sid })}
            onSettings={(seat, r) => setSettings({ seat, rig: r })}
            roleOf={(r, s) => bySeat.get(`${r}/${s.logicalId}`)} onRole={(r, s, x) => dispatch({ type: 'openrig', section: 'roles', role: x.id, seat: `${r}/${s.logicalId}` })} />}
      {settings && <SeatSettings seat={settings.seat} rig={settings.rig} view={rig} onClose={() => setSettings(null)} />}
      {reseated && !launching && <p className="or-status or-ok" role="status">{reseated}</p>}
      {reseating && rig.state && (() => { const r = rig.state.rigs.find(x => x.name === reseating); return r ? (
        <SeatsDialog client={client} machine={id} machineLabel={label} rig={r} onClose={() => setReseating(null)}
          onDone={d => { setReseating(null); setReseated(`${o.reseat.done(d.added.length, d.removed.length, d.links ?? 0)}${d.linksUnsupported ? ` ${o.reseat.noLinks}` : ''}`); rig.refresh(); }} />
      ) : null; })()}
      {ask && rig.state && <Confirm action={ask} state={rig.state} machine={label} onCancel={() => setAsk(null)} onConfirm={a => { setAsk(null); void rig.act(a); }} />}
      </>}
    </div>
  );
}

/** A seat's role, from the roles list, and opening it seen from that seat. */
type RoleLink = { roleOf: (rig: string, seat: RigSeat) => RoleSummary | undefined; onRole: (rig: string, seat: RigSeat, role: RoleSummary) => void };

function Body({ view, machine, onAct, onSeats, operator, sessionOf, onOpen, onSettings, roleOf, onRole }: { view: OpenRigView; machine?: MachineState; onAct: (a: OpenRigAction) => void; onSeats: (rig: string) => void; operator: Session | undefined; sessionOf: (seat: string) => Session | undefined; onOpen: (id: string) => void; onSettings: (seat: RigSeat, rig: string) => void } & RoleLink) {
  const { t } = useI18n();
  const o = t.openrig;
  if (machine && !machine.ready) return <p className="or-empty" role="status">{o.offline}</p>;
  if (view.error === 'outdated') return <p className="or-empty" role="status">{o.outdated}</p>;
  if (view.error === 'offline') return <p className="or-empty" role="status">{o.offline}</p>;
  const s = view.state;
  if (!s) return <p className="or-empty" role="status">{o.loading}</p>;
  if (!s.installed) return (
    <section className="or-card or-absent">
      <h3><Dot tone="off" />{o.notInstalledTitle}</h3>
      <p>{o.notInstalled}</p>
      <div className="or-acts"><Button size="sm" onClick={() => openUrl(OPENRIG_INSTALL_URL)}>{o.howToInstall}</Button></div>
    </section>
  );
  const busy = view.pending !== null;
  const up = s.daemon.state === 'running';
  return <>
    <Status view={view} />
    <div className="or-cards">
      <DaemonCard state={s} busy={busy} onAct={onAct} />
      <KernelCard state={s} busy={busy} onAct={onAct} operator={operator} sessionOf={sessionOf} onOpen={onOpen} onSettings={onSettings} />
    </div>
    <div className="or-h2"><h2>{o.rigs}</h2>{up && <span className="or-count">{listedRigs(s).length}</span>}</div>
    {!up ? <p className="or-empty">{o.daemonFirst}</p>
      : listedRigs(s).length === 0 ? <p className="or-empty">{o.noRigs}</p>
      : <ul className="or-rigs">{listedRigs(s).map(r => <RigRow key={r.id} rig={r} busy={busy} working={rigOf(view.pending) === r.name} onAct={onAct} onSeats={() => onSeats(r.name)} sessionOf={sessionOf} onOpen={onOpen} onSettings={onSettings} roleOf={roleOf} onRole={onRole} />)}</ul>}
  </>;
}

/** The action under way, or how the last one ended when it failed. */
function Status({ view }: { view: OpenRigView }) {
  const { t } = useI18n();
  const o = t.openrig;
  if (view.pending) return <p className="or-status or-info" role="status"><span className="or-spin"><Icon d={ICONS.refresh.d} size={13} /></span>{o.running(commandsOf(view.pending).join(' && '))}</p>;
  const last = view.last;
  if (!last || last.ok) return null;
  return (
    <div className="or-status or-err" role="alert">
      <p>{last.error === 'busy' ? o.busy : last.error === 'not_installed' ? o.notInstalled : last.error === 'offline' ? o.offline : last.error === 'outdated' ? o.outdated : o.failed(last.error ?? '')}</p>
      {last.commands.length > 0 && <code>{last.commands.join(' && ')}</code>}
    </div>
  );
}

function DaemonCard({ state, busy, onAct }: { state: OpenRigState; busy: boolean; onAct: (a: OpenRigAction) => void }) {
  const { t } = useI18n();
  const o = t.openrig;
  const [restoreLast, setRestoreLast] = useState(true);
  const [noKernel, setNoKernel] = useState(false);
  const d = state.daemon, up = d.state === 'running';
  const restore = restoreLast ? 'last' as const : 'none' as const;
  return (
    <section className="or-card" aria-label={o.daemon}>
      <h3><Dot tone={up ? 'ok' : d.state === 'stale' ? 'warn' : 'off'} />{o.daemon}<Pill tone={up ? 'ok' : d.state === 'stale' ? 'warn' : 'off'}>{o.daemonState[d.state]}</Pill></h3>
      <p className="or-sub mono">{up ? [d.port !== undefined && `127.0.0.1:${d.port}`, d.pid !== undefined && `pid ${d.pid}`].filter(Boolean).join(' · ') : d.message ?? ''}</p>
      <div className="or-acts">
        {up ? <>
          <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'daemon.stop' })}><Icon d={ICONS.stop.d} size={12} />{o.stop}</Button>
          <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'daemon.restart', restore })}><Icon d={ICONS.refresh.d} size={12} />{o.restart}</Button>
        </> : <Button size="sm" variant="primary" disabled={busy} onClick={() => onAct({ kind: 'daemon.start', restore, ...(noKernel && !restoreLast ? { noKernel: true } : {}) })}>{o.start}</Button>}
      </div>
      <label className="or-check"><input type="checkbox" checked={restoreLast} onChange={e => setRestoreLast(e.target.checked)} />{o.restoreLast}<code>rig start --last</code></label>
      {!up && !restoreLast && <label className="or-check"><input type="checkbox" checked={noKernel} onChange={e => setNoKernel(e.target.checked)} />{o.noKernel}<code>--no-kernel</code></label>}
    </section>
  );
}

function KernelCard({ state, busy, onAct, operator, sessionOf, onOpen, onSettings }: { state: OpenRigState; busy: boolean; onAct: (a: OpenRigAction) => void; operator: Session | undefined; sessionOf: (seat: string) => Session | undefined; onOpen: (id: string) => void; onSettings: (seat: RigSeat, rig: string) => void }) {
  const { t } = useI18n();
  const o = t.openrig;
  const k = state.kernel.state, up = state.daemon.state === 'running', rig = kernelRig(state);
  const tone: Tone = k === 'ready' ? 'ok' : k === 'starting' ? 'info' : 'off';
  return (
    <section className="or-card" aria-label={o.kernel}>
      <h3><Dot tone={tone} />{o.kernel}<Pill tone={tone}>{o.kernelState[k]}</Pill></h3>
      <p className="or-sub">{rig ? `${o.kernelLine} ${o.seats(rig.running, rig.seats)}` : o.kernelLine}</p>
      <div className="or-acts">
        {!up ? <small className="or-muted">{o.daemonFirst}</small>
          : k === 'ready' || k === 'starting' ? <>
            <Button size="sm" variant="primary" disabled={!operator} title={operator ? undefined : o.operatorNotYet} onClick={() => operator && onOpen(operator.id)}>{o.talkToOperator}</Button>
            <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'kernel.stop' })}><Icon d={ICONS.stop.d} size={12} />{o.stop}</Button>
            <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'kernel.restart' })}><Icon d={ICONS.refresh.d} size={12} />{o.restart}</Button>
          </> : rig ? <Button size="sm" variant="primary" disabled={busy} onClick={() => onAct({ kind: 'kernel.start' })}>{o.start}</Button> : null}
      </div>
      {up && rig && rig.nodes.length > 0 && (
        <ul className="or-kseats" aria-label={o.kernelSeats}>
          {rig.nodes.map(n => <SeatLine key={n.session} seat={n} session={sessionOf(n.session)} onOpen={onOpen} onSettings={() => onSettings(n, rig.name)} />)}
        </ul>
      )}
    </section>
  );
}

function RigRow({ rig, busy, working, onAct, onSeats, sessionOf, onOpen, onSettings, roleOf, onRole }: { rig: Rig; busy: boolean; working: boolean; onAct: (a: OpenRigAction) => void; onSeats: () => void; sessionOf: (seat: string) => Session | undefined; onOpen: (id: string) => void; onSettings: (seat: RigSeat, rig: string) => void } & RoleLink) {
  const { t } = useI18n();
  const o = t.openrig;
  const [open, setOpen] = useState(false);
  const seats = useId();
  const on = isRunning(rig);
  const tone: Tone = rig.attention > 0 ? 'warn' : rig.status === 'running' ? 'ok' : on ? 'info' : 'off';
  return (
    <li className={cls('or-rig', open && 'open', working && 'busy')}>
      <div className="or-row">
        <button type="button" className="or-fold" aria-expanded={open} aria-controls={seats} aria-label={o.showSeats(rig.name)} onClick={() => setOpen(!open)}>
          <Icon d={ICONS.chevronRight.d} size={12} />
          <strong>{rig.name}</strong>
        </button>
        <Pill tone={tone}>{o.rigStatus(rig.status)}</Pill>
        <span className="or-muted">{o.seats(rig.running, rig.seats)}</span>
        <span className={rig.attention > 0 ? 'or-attn' : 'or-muted'}>{rig.attention > 0 ? o.attention(rig.attention) : ''}</span>
        <span className="or-muted">{[rig.uptime && on && o.uptime(rig.uptime), rig.snapshot && o.snapshot(rig.snapshot)].filter(Boolean).join(' · ')}</span>
        <span className="or-acts">
          {on ? <>
            <Button size="sm" disabled={busy} aria-label={o.reseat.openLabel(rig.name)} onClick={onSeats}>{o.reseat.open}</Button>
            <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'rig.stop', rig: rig.name, snapshot: true })}><Icon d={ICONS.stop.d} size={12} />{o.stop}</Button>
            <Button size="sm" disabled={busy} aria-label={`${o.restart} ${rig.name}`} title={o.restart} onClick={() => onAct({ kind: 'rig.restart', rig: rig.name })}><Icon d={ICONS.refresh.d} size={12} /></Button>
          </> : <Button size="sm" disabled={busy} onClick={() => onAct({ kind: 'rig.start', rig: rig.name })}><Icon d={ICONS.play.d} size={12} />{o.start}</Button>}
        </span>
      </div>
      {open && (
        <ul id={seats} className="or-seats">
          {rig.nodes.length === 0 ? <li className="or-muted">{o.noSeats}</li> : rig.nodes.map(n => { const role = roleOf(rig.name, n); return <SeatLine key={n.session} seat={n} session={sessionOf(n.session)} onOpen={onOpen} onSettings={() => onSettings(n, rig.name)} work role={role} onRole={role ? () => onRole(rig.name, n, role) : undefined} />; })}
        </ul>
      )}
    </li>
  );
}

/** Stopping or restarting asks first, names the working seats, offers the stop's options and shows the command. */
function Confirm({ action, state, machine, onConfirm, onCancel }: { action: OpenRigAction; state: OpenRigState; machine: string; onConfirm: (a: OpenRigAction) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const c = t.openrig.confirm;
  const body = useId();
  const [a, setA] = useState(action);
  const target = targetOf(a);
  const what = a.kind.startsWith('daemon.') ? c.daemon : a.kind.startsWith('kernel.') ? c.kernel : c.rig(target);
  const stop = a.kind.endsWith('.stop');
  const working = workingSeats(state, a);
  const toggle = (k: 'snapshot' | 'force' | 'delete') => setA(x => (x.kind === 'rig.stop' ? { ...x, [k]: !x[k] } : x));
  return (
    <Modal title={(stop ? c.title : c.restartTitle)(what, machine)} role="alertdialog" describedBy={body} className="confirm-modal or-confirm" onClose={onCancel}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
        <p id={body}>{c.working(working.length)}{!stop && ` ${c.restartNote}`}</p>
        {working.length > 0 && (
          <ul className="or-working">
            {working.map(w => <li key={w.seat.session}><span className="mono">{w.seat.logicalId}</span><span className="or-muted">{a.kind.startsWith('daemon.') ? `${w.rig} · ` : ''}{t.openrig.activity(w.seat.activity)}{w.seat.work ? ` · ${t.openrig.work(w.seat.work)}` : ''}</span></li>)}
          </ul>
        )}
        {a.kind === 'rig.stop' && <div className="or-options">
          <label className="or-check"><input type="checkbox" checked={!!a.snapshot} onChange={() => toggle('snapshot')} />{c.snapshot}</label>
          <label className="or-check"><input type="checkbox" checked={!!a.force} onChange={() => toggle('force')} />{c.force}<code>--force</code></label>
          <label className="or-check"><input type="checkbox" checked={!!a.delete} onChange={() => toggle('delete')} />{c.del}<code>--delete</code></label>
        </div>}
        <p className="or-command">{c.command} : <code>{commandsOf(a).join(' && ')}</code></p>
        <div className="confirm-actions">
          <Button autoFocus onClick={onCancel}>{c.cancel}</Button>
          <Button variant="primary" className={a.kind === 'rig.stop' && a.delete ? 'danger-btn' : ''} onClick={() => onConfirm(a)}>{c.ok(stop, what)}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The Ledge session of the kernel's operator seat (`operator.agent`) on that machine, once Ledge follows it. */
export function operatorOf(state: OpenRigState | null, sessions: readonly Session[], machine: string): Session | undefined {
  const seat = state?.rigs.find(r => r.name === 'kernel')?.nodes.find(n => n.logicalId === 'operator.agent')?.session;
  if (!seat) return undefined;
  return sessionOfSeat(sessions, seat, machine);
}

/** The Ledge session that follows an OpenRig seat on that machine, if any. */
export const sessionOfSeat = (sessions: readonly Session[], seat: string, machine: string): Session | undefined =>
  sessions.find(x => x.rig?.seat === seat && x.state !== 'exited' && (x.machineId ?? 'local') === machine);

/** One seat: its role, harness and model, what it does, and « Ouvrir » once Ledge follows it (its thread, its terminal, its requests). */
function SeatLine({ seat: n, session, onOpen, onSettings, work = false, role, onRole }: { seat: RigSeat; session: Session | undefined; onOpen: (id: string) => void; onSettings: () => void; work?: boolean; role?: RoleSummary | undefined; onRole?: (() => void) | undefined }) {
  const { t } = useI18n();
  const o = t.openrig;
  const up = n.sessionStatus === 'running';
  return (
    <li className={cls('or-seat', work && 'or-seat-role')}>
      <span className="mono">{n.logicalId}</span>
      {work && <span className="or-role-cell">{role && onRole && <button type="button" className="or-rolelink" title={o.roles.roleLink(role.name, n.logicalId)} aria-label={o.roles.roleLink(role.name, n.logicalId)} onClick={onRole}>{role.name} ↗</button>}</span>}
      <span className="or-muted">{[n.runtime, n.model].filter(Boolean).join(' · ')}</span>
      <Pill tone={!up ? 'off' : n.activity === 'running' ? 'info' : n.activity === 'idle' ? 'ok' : 'off'}>{up ? o.activity(n.activity) : o.seatStatus(n.sessionStatus)}</Pill>
      <span className="or-muted">{work ? o.work(n.work) : ''}</span>
      <span className="or-seat-open">
        {session && <Button size="sm" onClick={() => onOpen(session.id)} aria-label={o.openSeat(n.logicalId)}>{o.open}</Button>}
        {(n.runtime === 'claude-code' || n.runtime === 'codex') && <Button size="sm" variant="ghost" className="or-gear" aria-label={o.seatSettings.open(n.logicalId)} title={o.seatSettings.open(n.logicalId)} onClick={onSettings}>⚙</Button>}
      </span>
    </li>
  );
}
