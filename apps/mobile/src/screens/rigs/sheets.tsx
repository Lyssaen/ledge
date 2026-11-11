import { useState, type ReactNode } from 'react';
import { ModelIdSchema, rigActNeedsCheck, seatPlan, type OpenRigAction, type PhoneOpenRigState, type PhoneSession, type RigGraph, type RigGraphSeat, type RigSnapshot } from '@ledge/protocol';
import { copy, locale } from '../../copy';
import {
  PERM_LEVELS, SEAT_DOT, daysAgo, isWorking, newestFirst, parseRigTime, roleCounts, seatLinks, seatName, seatState, specLevel, toolOf,
  type PermLevel, type RigStatus, type SeatState
} from '../../model/rigs';
import { href } from '../../router';
import type { PermissionsData, Read, RigsStore } from '../../state/rigs';
import { Icon } from '../../ui/icons';
import { Dot, Pill, RuntimeTag } from '../../ui/kit/marks';
import { isApple } from '../device';
import { CheckRow, Conseq, IconLabel, Opt, ReadFail, RigSheet, Seg, Stepper, rigButtonClass } from './kit';

/*
 * The sheets of a rig's view (m4-rigs.html, §3 to §7): « Plus d'actions », stop and restart, the seats per role, the rig's
 * permissions, a seat and its settings, the snapshots. Each sends one OpenRig action and closes; the view shows the run.
 */

const C = copy.rigs;
type Rig = PhoneOpenRigState['rigs'][number];

/** A snapshot's time: today's time, yesterday's, or the day (OpenRig gives UTC, the phone shows its own zone). */
export function snapWhen(createdAt: string, now = new Date()): { short: string; long: string } {
  const d = parseRigTime(createdAt);
  if (!d) return { short: createdAt, long: createdAt };
  const t = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const ago = daysAgo(d, now);
  if (ago === 0) return { short: t, long: C.snapshots.today(t) };
  if (ago === 1) return { short: C.snapshots.yesterday(t), long: C.snapshots.yesterday(t) };
  const day = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return { short: day, long: `${day} ${t}` };
}

/** The button that sends an action asking the device's check: « Arrêter avec Face ID », filled red; or, without a passkey, why not. */
export function CheckedButton({ verb, confirm, disabled, onClick }: { verb: string; confirm: boolean; disabled: boolean; onClick: () => void }) {
  const apple = isApple();
  if (!confirm) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-muted">{C.protectFirst}</p>
        <a href={href({ name: 'connection' })} className={rigButtonClass({ className: 'w-full' })}>{C.openSettings}</a>
      </div>
    );
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={rigButtonClass({ tone: 'dangerfill', className: 'w-full' })}>
      <IconLabel icon={apple ? 'face' : 'passkey'} size="size-[18px]">{C.withCheck(verb, apple)}</IconLabel>
    </button>
  );
}

export const Cancel = ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose} className={rigButtonClass({ className: 'w-full' })}>{C.confirm.cancel}</button>;

/** A confirmation that asks the device's check (§8: the kernel's and the daemon's restart and stop): what it costs, then the button. */
export function ConfirmSheet({ title, conseq, note, verb, confirm, live, onConfirm, onClose }: {
  title: string; conseq?: { title: string; body?: string } | undefined; note?: string | undefined; verb: string; confirm: boolean; live: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <RigSheet title={title} onClose={onClose}>
      {conseq && <Conseq title={conseq.title} {...(conseq.body ? { body: conseq.body } : {})} />}
      {note && <p className="text-[12.5px] leading-[18px] text-muted">{note}</p>}
      <CheckedButton verb={verb} confirm={confirm} disabled={!live} onClick={() => { onClose(); onConfirm(); }} />
      <Cancel onClose={onClose} />
    </RigSheet>
  );
}

/** A line of a menu sheet: its glyph, its words, what it holds on the right. */
function MenuItem({ icon, label, aside, onClick, disabled = false, danger = false }: { icon: 'camera' | 'list' | 'shield' | 'refresh' | 'power'; label: string; aside?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick} className={`flex min-h-12 items-center gap-3 border-b border-line px-3.5 text-left text-[15px] last:border-b-0 disabled:opacity-45 ${danger ? 'text-approval' : ''}`}>
      <Icon name={icon} className={`size-[18px] ${danger ? '' : 'text-muted'}`} /><span className="min-w-0 flex-1">{label}</span>
      {aside && <span className="text-[13px] text-muted">{aside}</span>}
    </button>
  );
}

/** « Plus d'actions » of a rig: a snapshot now, the snapshots, the permissions, read again. */
export function MoreSheet({ rig, live, running, snapshots, level, onSnapshot, onSnapshots, onPermissions, onRefresh, onClose }: {
  rig: string; live: boolean; running: boolean; snapshots: number | null; level: string | null;
  onSnapshot: () => void; onSnapshots: () => void; onPermissions: () => void; onRefresh: () => void; onClose: () => void;
}) {
  return (
    <RigSheet title={rig} onClose={onClose}>
      <div role="menu" aria-label={C.more} className="flex flex-col overflow-hidden rounded-[10px] border border-line">
        <MenuItem icon="camera" label={C.actions.snapshot} disabled={!live || running} onClick={onSnapshot} />
        <MenuItem icon="list" label={C.actions.snapshots} {...(snapshots !== null ? { aside: String(snapshots) } : {})} onClick={onSnapshots} />
        <MenuItem icon="shield" label={C.actions.permissions} {...(level ? { aside: level } : {})} onClick={onPermissions} />
        <MenuItem icon="refresh" label={C.actions.refresh} disabled={!live} onClick={onRefresh} />
      </div>
    </RigSheet>
  );
}

/** The kernel's « ⋯ » (Q73): read again, then its restart and stop, which open the same sheets as the buttons below. */
export function KernelMenuSheet({ live, up, onRefresh, onRestart, onStop, onClose }: {
  live: boolean; up: boolean; onRefresh: () => void; onRestart: () => void; onStop: () => void; onClose: () => void;
}) {
  return (
    <RigSheet title={C.kernel} onClose={onClose}>
      <div role="menu" aria-label={C.more} className="flex flex-col overflow-hidden rounded-[10px] border border-line">
        <MenuItem icon="refresh" label={C.kernelView.menu.refresh} disabled={!live} onClick={onRefresh} />
        <MenuItem icon="refresh" label={C.kernelView.menu.restart} disabled={!live || !up} onClick={onRestart} />
        <MenuItem icon="power" label={C.kernelView.menu.stop} danger disabled={!live || !up} onClick={onStop} />
      </div>
    </RigSheet>
  );
}

/** §4: stop or restart the rig. What stops (the seats at work), the stop's two options, then the device's check. */
export function StopSheet({ rig, pc, verb, confirm, live, onAct, onClose }: {
  rig: Rig; pc: string; verb: 'stop' | 'restart'; confirm: boolean; live: boolean; onAct: (a: OpenRigAction) => void; onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState(true);
  const [force, setForce] = useState(false);
  const working = rig.nodes.filter(n => !n.stopped && isWorking(n)).map(n => seatName(n.logicalId, n.session));
  const stop = verb === 'stop';
  const conseq = working.length ? C.confirm.working(working.length) : C.confirm.noneWorking;
  const act: OpenRigAction = stop
    ? { kind: 'rig.stop', rig: rig.name, ...(snapshot ? { snapshot: true } : {}), ...(force ? { force: true } : {}) }
    : { kind: 'rig.restart', rig: rig.name };
  return (
    <RigSheet title={stop ? C.confirm.stop(rig.name, pc) : C.confirm.restart(rig.name, pc)} onClose={onClose}>
      <Conseq title={conseq} body={stop ? (working.length ? working.join(', ') : undefined) : C.confirm.restartNote} />
      {stop && (
        <div className="overflow-hidden rounded-[10px] border border-line">
          <CheckRow on={snapshot} label={C.confirm.snapshot} onChange={setSnapshot} />
          <CheckRow on={force} label={C.confirm.force} onChange={setForce} />
        </div>
      )}
      <CheckedButton verb={stop ? C.actions.stop : C.actions.restart} confirm={confirm} disabled={!live} onClick={() => { onClose(); onAct(act); }} />
      <Cancel onClose={onClose} />
    </RigSheet>
  );
}

/**
 * §6: the seats per role of a running rig, each from 0 to 9; adding asks nothing, removing asks the device's check. In a sheet on a
 * phone; inline on a wide screen (§10, « Sièges par rôle »), where each role shows its seats' context.
 */
export function ReseatForm({ rig, confirm, live, onReseat, onDone, context }: {
  rig: Rig; confirm: boolean; live: boolean; onReseat: (seats: Record<string, number>, delegation: 'pairs' | 'all' | undefined) => void; onDone?: () => void;
  /** Wide: each seat's context (%), by logical id. */
  context?: Record<string, number | undefined>;
}) {
  const roles = roleCounts(rig);
  const [want, setWant] = useState<Record<string, number>>({});
  const [delegation, setDelegation] = useState<'pairs' | 'all'>('pairs');
  const changed = Object.fromEntries(Object.entries(want).filter(([role, n]) => roles.find(r => r.role === role)?.count !== n));
  const plan = seatPlan(rig.nodes, changed);
  const add = plan.add.length, remove = plan.remove.length;
  const leaving = rig.nodes.filter(n => plan.remove.includes(n.logicalId) && isWorking(n)).map(n => n.logicalId);
  const label = add && remove ? C.reseat.change(add, remove) : add ? C.reseat.add(add) : remove ? C.reseat.remove(remove) : C.reseat.noChange;
  const send = () => { onDone?.(); setWant({}); onReseat(changed, add ? delegation : undefined); };
  const inline = context !== undefined;
  return (
    <>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {roles.map(r => {
            const n = want[r.role] ?? r.count;
            const adds = plan.add.filter(a => a.role === r.role).map(a => C.reseat.adds(`${a.pod}.${a.id}`));
            const removes = plan.remove.filter(id => r.ids.includes(id)).map(C.reseat.removes);
            const names = r.ids.map(id => seatName(id, rig.nodes.find(x => x.logicalId === id)?.session)).join(', ');
            const ctx = inline ? r.ids.map(id => context[id]).filter((c): c is number => c !== undefined).map(c => `${Math.round(c)} %`).join(', ') : '';
            const sub = inline ? [...adds, ...removes].join(' · ') : [names, ...adds, ...removes].join(removes.length ? ' → ' : ' · ');
            return (
              <tr key={r.role} className="border-b border-line last:border-b-0">
                <td className="px-1 py-[7px] font-mono text-[12.5px]">
                  {r.role}
                  {sub && <small className="block font-sans text-[11.5px] text-muted">{sub}</small>}
                </td>
                {inline && <td className="px-1 py-[7px] text-[12px] text-muted">{ctx}</td>}
                <td className="px-1 py-[7px] text-right">
                  <Stepper value={n} changed={n !== r.count} disabled={!live} fewer={C.reseat.fewer(r.role)} more={C.reseat.more(r.role)} onChange={v => setWant({ ...want, [r.role]: v })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {add > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="flex-1 text-[12.5px] text-muted">{C.reseat.delegation}</span>
          <Seg label={C.reseat.delegation} value={delegation} onChange={setDelegation} options={[{ value: 'pairs', label: C.reseat.pairs }, { value: 'all', label: C.reseat.all }]} />
        </div>
      )}
      {remove > 0 && <Conseq title={leaving.length ? C.reseat.working(leaving) : C.reseat.lastFirst} {...(leaving.length ? { body: C.reseat.lastFirst } : {})} />}
      {(!inline || add + remove > 0) && (remove > 0
        ? <CheckedButton verb={label} confirm={confirm} disabled={!live} onClick={send} />
        : <button type="button" disabled={!live || add === 0} onClick={send} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{label}</button>)}
      {inline && add + remove > 0 && <button type="button" onClick={() => setWant({})} className={rigButtonClass({ className: 'w-full' })}>{C.confirm.cancel}</button>}
    </>
  );
}

export function ReseatSheet({ rig, pc, confirm, live, onReseat, onClose }: {
  rig: Rig; pc: string; confirm: boolean; live: boolean; onReseat: (seats: Record<string, number>, delegation: 'pairs' | 'all' | undefined) => void; onClose: () => void;
}) {
  return (
    <RigSheet title={C.reseat.title(rig.name, pc)} onClose={onClose}>
      <p className="text-[12px] leading-4 text-muted">{C.reseat.today(roleCounts(rig).map(r => C.reseat.part(r.count, r.role)).join(', '))}</p>
      <ReseatForm rig={rig} confirm={confirm} live={live} onReseat={onReseat} onDone={onClose} />
      <Cancel onClose={onClose} />
    </RigSheet>
  );
}

/** §7: the rig's permission level, Desktop's five and « Spec »; YOLO and Spec ask the device's check. */
export function PermissionsSheet({ rig, read, level, confirm, live, onAct, onClose }: {
  rig: Rig; read: Read<PermissionsData> | undefined; level: PermLevel | 'mixed' | null; confirm: boolean; live: boolean; onAct: (a: OpenRigAction) => void; onClose: () => void;
}) {
  const [chosen, setChosen] = useState<PermLevel | null>(level === 'mixed' ? null : level);
  const apple = isApple();
  const spec = specLevel(read?.data?.policy);
  const seats = (read?.data?.seats.map(s => s.session) ?? rig.nodes.map(n => n.session)).filter(s => s.endsWith(`@${rig.name}`));
  const action: OpenRigAction | null = chosen && seats.length ? { kind: 'rig.policy', rig: rig.name, policy: chosen, seats } : null;
  const check = !!action && rigActNeedsCheck(action);
  const send = () => { if (action) { onClose(); onAct(action); } };
  const disabled = !live || !action || chosen === level;
  return (
    <RigSheet title={C.permissions.title(rig.name)} onClose={onClose}>
      <p className="text-[12px] leading-4 text-muted">{[C.permissions.sub, spec ? C.permissions.spec(C.level[spec]) : ''].filter(Boolean).join(' ')}</p>
      {read?.error && !read.data && <p role="alert" className="text-[12.5px] text-attention">{C.permissions.unavailable}</p>}
      <div className="flex flex-col gap-1.5">
        {PERM_LEVELS.map(l => (
          <Opt
            key={l} pressed={chosen === l} disabled={!live} onClick={() => setChosen(l)} sub={C.permissions.hint[l]}
            title={<>{C.level[l]}{(l === 'yolo' || l === 'spec') && <span className="ml-1.5 inline-flex align-middle"><Pill tone="perm">{apple ? C.permissions.faceId : C.permissions.check}</Pill></span>}</>}
          />
        ))}
      </div>
      {check
        ? <CheckedButton verb={C.permissions.apply} confirm={confirm} disabled={disabled} onClick={send} />
        : <button type="button" disabled={disabled} onClick={send} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{C.permissions.apply}</button>}
    </RigSheet>
  );
}

/** A seat's line in the sheet's « Liens »: the other seat's name. */
const linkWords = (id: string, graph: RigGraph): string => {
  const words = seatLinks(id, graph.links).map(l => {
    const who = seatName(l.who, graph.seats.find(s => s.logicalId === l.who)?.session);
    return l.kind === 'linked' ? C.seat.linked(who, l.label) : C.seat[l.kind](who);
  });
  return words.length ? words.join(' · ') : C.seat.noLink;
};

/** Q39: a seat of the topology, from the graph and the state; its session, its settings. */
export function SeatSheet({ rig, seat, graph, node, session, status, near, onSettings, onClose }: {
  rig: string; seat: RigGraphSeat; graph: RigGraph; node: Rig['nodes'][number] | undefined; session: PhoneSession | undefined; status: RigStatus; near: number;
  onSettings: () => void; onClose: () => void;
}) {
  const state: SeatState = seatState({ session, node, graph: seat, rigStatus: status });
  const tool = toolOf(seat.runtime);
  const name = seatName(seat.logicalId, seat.session);
  const harness = [tool ? copy.tools[tool] : seat.runtime, seat.model ?? node?.model ?? ''].filter(Boolean).join(' · ');
  const now = session?.pending ? C.seat.prompt(C.seatState[state]) : C.seatState[state];
  const work = node && node.work > 0 ? C.seat.tasks(node.work) : C.seat.noTask;
  const kv: [string, ReactNode][] = [
    [C.seat.harness, harness],
    ...(seat.context !== undefined ? [[C.seat.context, <span key="c" className={`font-mono ${seat.context >= near ? 'text-attention' : ''}`}>{`${Math.round(seat.context)} %`}</span>] as [string, ReactNode]] : []),
    [C.seat.now, now],
    [C.seat.work, work],
    [C.seat.links, linkWords(seat.logicalId, graph)]
  ];
  return (
    <RigSheet title={name} onClose={onClose}>
      <div className="-mt-2 flex items-center gap-2">
        <Dot state={SEAT_DOT[state]} />{tool && <RuntimeTag tool={tool} />}
        <span className="flex-1" /><span className="text-[12.5px] text-muted">{C.seat.of(seat.logicalId, rig)}</span>
      </div>
      <dl className="m-0 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {kv.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="m-0 [overflow-wrap:anywhere]">{v}</dd></div>)}
      </dl>
      {session
        ? <a href={href({ name: 'thread', sessionId: session.id })} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{C.seat.openSession}</a>
        : (
          // A disabled line keeps its place and says why (m4-complement.html, §1).
          <>
            <button type="button" disabled className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{C.seat.openSession}</button>
            <p className="-mt-1 text-[12px] text-muted">{C.seat.noSession}</p>
          </>
        )}
      <button type="button" onClick={onSettings} className={rigButtonClass({ className: 'w-full' })}><IconLabel icon="gear">{C.seat.settings}</IconLabel></button>
    </RigSheet>
  );
}

type Harness = 'claude-code' | 'codex';
type Effort = 'medium' | 'high' | 'xhigh';
type SeatPerm = 'inherit' | 'auto' | 'full_bypass';

/** §7: a seat's settings (`seat.set`), each with when it applies; moving harness or going YOLO asks the device's check. */
export function SeatSettingsSheet({ rig, seat, node, selection, confirm, live, onAct, onClose }: {
  rig: string; seat: RigGraphSeat; node: Rig['nodes'][number] | undefined; selection: string | undefined; confirm: boolean; live: boolean;
  onAct: (a: OpenRigAction) => void; onClose: () => void;
}) {
  const S = C.seatSettings;
  const runtime: Harness | null = seat.runtime === 'codex' ? 'codex' : seat.runtime === 'claude-code' || seat.runtime === 'claude' ? 'claude-code' : null;
  const model0 = seat.model ?? node?.model ?? '';
  const perm0: SeatPerm | null = selection === 'inherit' || selection === 'auto' || selection === 'full_bypass' ? selection : null;
  const [harness, setHarness] = useState<Harness | null>(runtime);
  const [model, setModel] = useState(model0);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [perm, setPerm] = useState<SeatPerm | null>(perm0);
  const name = seatName(seat.logicalId, seat.session);
  const session = seat.session ?? node?.session ?? `${name}@${rig}`;
  const modelOk = model.trim() === '' || ModelIdSchema.safeParse(model.trim()).success;
  const moved = harness !== null && harness !== runtime;
  const action: OpenRigAction = {
    kind: 'seat.set', seat: session,
    ...(moved ? { runtime: harness } : {}),
    ...(model.trim() && model.trim() !== model0 ? { model: model.trim() } : {}),
    ...(effort ? { effort } : {}),
    ...(perm && perm !== perm0 ? { permissions: perm } : {})
  };
  const changes = Object.keys(action).length > 2;
  const check = rigActNeedsCheck(action);
  const tool = toolOf(seat.runtime);
  const today = [tool ? copy.tools[tool] : seat.runtime, model0, perm0 ? S.perm[perm0] : ''].filter(Boolean);
  const disabled = !live || !changes || !modelOk;
  const send = () => { onClose(); onAct(action); };
  const row = (label: string, when: string, control: ReactNode) => (
    <div className="flex flex-col gap-1.5"><span className="text-[12.5px] text-muted">{`${label} · ${when}`}</span>{control}</div>
  );
  return (
    <RigSheet title={S.title(name, rig)} onClose={onClose}>
      <p className="text-[12px] leading-4 text-muted">{S.today(today)}</p>
      {row(S.harness, S.whenNow, <Seg label={S.harness} value={harness} disabled={!live} onChange={setHarness} options={[{ value: 'claude-code', label: copy.tools.claude }, { value: 'codex', label: copy.tools.codex }]} />)}
      {row(S.model, S.whenResume, (
        <input
          aria-label={S.modelLabel} value={model} disabled={!live} onChange={e => setModel(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          className={`h-11 rounded-[10px] border bg-surface px-3 text-base outline-none focus:border-ring ${modelOk ? 'border-input' : 'border-approval/60'}`}
        />
      ))}
      {row(S.effort, S.whenResume, <Seg label={S.effort} value={effort} disabled={!live} onChange={setEffort} options={(['medium', 'high', 'xhigh'] as const).map(v => ({ value: v, label: S.effortLevel[v] }))} />)}
      {row(S.permissions, S.whenLaunch, <Seg label={S.permissions} value={perm} disabled={!live} onChange={setPerm} options={(['inherit', 'auto', 'full_bypass'] as const).map(v => ({ value: v, label: S.perm[v] }))} />)}
      {moved && <p className="text-[12.5px] text-attention">{S.moveNote}</p>}
      {check
        ? <CheckedButton verb={S.save} confirm={confirm} disabled={disabled} onClick={send} />
        : <button type="button" disabled={disabled} onClick={send} className={rigButtonClass({ tone: 'primary', className: 'w-full' })}>{S.save}</button>}
    </RigSheet>
  );
}

/** The snapshots, newest first: when, what kind, how it went. */
export function SnapshotList({ read, kindOnly = false, retry }: { read: Read<RigSnapshot[]> | undefined; kindOnly?: boolean; retry?: () => void }) {
  const list = newestFirst(read?.data ?? []);
  const box = 'overflow-hidden rounded-[10px] border border-line bg-surface dark:bg-transparent';
  if (read?.error && !read.data) return <div className={box}><ReadFail retry={retry} retryLabel={C.unavailable.retry}>{C.snapshots.unavailable}</ReadFail></div>;
  if (read?.data && list.length === 0) return <div className={box}><ReadFail>{C.snapshots.none}</ReadFail></div>;
  if (!list.length) return <p role="status" className="text-[13px] text-muted">{C.loading}</p>;
  return (
    <div className="flex max-h-[45dvh] flex-col overflow-y-auto rounded-[10px] border border-line bg-surface dark:bg-transparent">
      {list.map(s => (
        <div key={s.id} className="flex min-h-[46px] items-center gap-2.5 border-b border-line px-3 py-1.5 text-[13px] last:border-b-0">
          <Icon name="camera" className="size-4 text-muted" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span>{snapWhen(s.createdAt).long}</span>
            <small className="text-[11.5px] text-muted">{kindOnly ? C.snapshots.kind[s.kind] ?? s.kind : [C.snapshots.kind[s.kind] ?? s.kind, C.snapshots.status[s.status] ?? s.status].join(' · ')}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

/** §7: the rig's 20 last snapshots, and one now (no check). */
export function SnapshotsSheet({ rig, read, live, running, onSnapshot, onRetry, onClose }: {
  rig: string; read: Read<RigSnapshot[]> | undefined; live: boolean; running: boolean; onSnapshot: () => void; onRetry: () => void; onClose: () => void;
}) {
  return (
    <RigSheet title={C.snapshots.title(rig)} onClose={onClose}>
      <SnapshotList read={read} retry={onRetry} />
      <button type="button" disabled={!live || running} onClick={() => { onClose(); onSnapshot(); }} className={rigButtonClass({ className: 'w-full' })}>
        <IconLabel icon="camera">{C.snapshots.take}</IconLabel>
      </button>
      <p className="text-[12px] leading-4 text-muted">{C.snapshots.utc}</p>
    </RigSheet>
  );
}
