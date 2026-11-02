import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { reseatRig, useOpenRig, useOpenRigRoles } from '@ledge/fleet/openrig';
import type { OpenRigAction, OpenRigState, Rig, RoleSummary, Session } from '@ledge/protocol';
import { useScreenKeys, useTui } from '../context.js';
import {
  asksFirst, confirmOf, daemonToggle, daemonUp, keepRig, kernelToggle, listedRigs, rigLook, rigToggle, seatBusy, step, type Confirm, type RigLook
} from '../model/openrig.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { canReseat, changedCounts, countsOf, planOf, seatRows, withCount, type Delegation } from '../model/rigSeats.js';
import { Frame } from '../ui/Frame.js';
import { RigSeats } from '../ui/RigSeats.js';
import { TitledBox } from '../ui/TitledBox.js';
import { RolesScreen } from './Roles.js';

const LOOK: Record<RigLook, { glyph: string; color: () => string }> = {
  running: { glyph: '●', color: () => C.green }, starting: { glyph: '◌', color: () => C.blue },
  attention: { glyph: '▲', color: () => C.yellow }, stopped: { glyph: '○', color: () => C.faint }
};

/** The words of a confirmation's question. */
function question(t: Messages, a: OpenRigAction): string {
  const w = t.openrig.what;
  if (a.kind === 'rig.stop') return t.openrig.confirm(w['rig.stop'](a.rig));
  if (a.kind === 'rig.restart') return t.openrig.confirm(w['rig.restart'](a.rig));
  if (a.kind === 'daemon.stop' || a.kind === 'daemon.restart' || a.kind === 'kernel.stop' || a.kind === 'kernel.restart') return t.openrig.confirm(w[a.kind]);
  return '';
}

/**
 * OpenRig on a machine (docs/mockups/ledge-openrig.html, view 4, « Écran OpenRig (6) »): its daemon and kernel, then its
 * rigs, the selected one unfolded with ↵ to its seats. tab changes machine; s starts or stops the rig, R restarts it, D
 * and K start or stop the daemon and the kernel. A stop (a restart too) asks y / n first, with who it stops at work and
 * the commands it runs.
 */
export function OpenRigScreen() {
  const tui = useTui();
  // v switches Rigs ⇄ Rôles (docs/mockups/ledge-openrig-roles-tui.html); both are kept while the TUI runs, with the machine.
  const [view, setView] = useState<'rigs' | 'roles'>(tui.kept.rigView ?? 'rigs');
  const [machineId, setMachineId] = useState<string | null>(tui.kept.rigMachine ?? null);
  tui.kept.rigView = view;
  if (view === 'roles') return (
    <RolesScreen machineId={machineId} onRigs={() => setView('rigs')}
      onMachine={d => { const ms = tui.machines; const i = Math.max(0, ms.findIndex(m => m.id === (machineId ?? ms[0]?.id))); const n = ms[step(i, d, ms.length)]?.id ?? null; tui.kept.rigMachine = n; setMachineId(n); }} />
  );
  return <RigsView initialMachine={machineId} onRoles={(role, machine) => { tui.kept.role = role; setMachineId(machine); setView('roles'); }} />;
}

/** The Rigs view: OpenRig's daemon, kernel and rigs. `onRoles`: v (the role list) or i (a seat's role, seen from it). */
function RigsView({ initialMachine, onRoles }: { initialMachine: string | null; onRoles: (role: { id: string; seat?: string } | undefined, machine: string | null) => void }) {
  const tui = useTui();
  const { t, machines } = tui;
  const o = t.openrig;
  // The machine shown is kept while the TUI runs: « Lancer un rig » (+) launches on it, and coming back shows it again.
  const [machineId, setMachineId] = useState<string | null>(initialMachine ?? tui.kept.rigMachine ?? null);
  const machine = machines.find(m => m.id === machineId) ?? machines[0] ?? null;
  tui.kept.rigMachine = machine?.id ?? null;
  const rig = useOpenRig(tui.client, machine?.id ?? null);
  // Each seat's role, for its line and i (from the roles' `seatRefs`).
  const roles = useOpenRigRoles(tui.client, machine?.id ?? null);
  const roleOf = (rigName: string, logicalId: string): RoleSummary | undefined => roles.roles.find(x => x.seatRefs.some(s => s.rig === rigName && s.logicalId === logicalId));
  const state = rig.state;
  const rigs = listedRigs(state);
  const [at, setAt] = useState(0);
  const selectedId = useRef<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  /** On an unfolded rig, j k walk down its seats: the seat selected (null: the rig's own line). */
  const [seatAt, setSeatAt] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  /** « Sièges du rig » open (± on a running rig): the rig, the count asked per role, the role chosen, how added seats link. */
  const [seats, setSeats] = useState<{ rig: string; counts: Record<string, number>; at: number; delegation: Delegation; applying: boolean } | null>(null);

  // The selection follows its rig when the list changes (a rig started, stopped or gone).
  const ids = rigs.map(r => r.id).join(',');
  useEffect(() => { setAt(a => keepRig(rigs, a, selectedId.current)); }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const current: Rig | undefined = rigs[Math.min(at, rigs.length - 1)];
  selectedId.current = current?.id ?? null;
  const seatNodes = current && open.has(current.id) ? current.nodes : [];
  const seatSel = seatAt !== null && seatAt < seatNodes.length ? seatAt : null;
  const down = () => {
    if (seatSel !== null ? seatSel + 1 < seatNodes.length : seatNodes.length > 0) { setSeatAt((seatSel ?? -1) + 1); return; }
    const n = step(at, 1, rigs.length); setAt(n); setSeatAt(null);
  };
  const up = () => {
    if (seatSel !== null) { setSeatAt(seatSel > 0 ? seatSel - 1 : null); return; }
    const n = step(at, -1, rigs.length), prev = rigs[n];
    setAt(n); setSeatAt(prev && open.has(prev.id) && prev.nodes.length ? prev.nodes.length - 1 : null);
  };

  const run = (a: OpenRigAction) => {
    void rig.act(a).then(d => {
      if (d.error === 'cancelled') return;
      tui.toast(d.ok ? { text: o.done(d.commands.join(' && ')), tone: 'ok' } : { text: o.failed(o.why[d.error ?? ''] ?? d.error ?? ''), tone: 'error' });
    });
  };
  const ask = (a: OpenRigAction) => {
    if (!state) return;
    if (asksFirst(a)) setConfirm(confirmOf(state, a)); else run(a);
  };

  // The seats' window reads the rig as it is now; it closes when the rig goes or stops.
  const seatRig = seats ? rigs.find(r => r.name === seats.rig) : undefined;
  const rows = seatRig ? seatRows(seatRig) : [];
  useEffect(() => { if (seats && !seats.applying && !canReseat(seatRig)) setSeats(null); }, [seats, seatRig]);
  const apply = () => {
    if (!seats || !seatRig || !machine || seats.applying) return;
    const changed = changedCounts(rows, seats.counts);
    if (!Object.keys(changed).length) return;
    const adds = planOf(seatRig, rows, seats.counts).add.length > 0;
    setSeats(x => (x ? { ...x, applying: true } : x));
    void reseatRig(tui.client, machine.id, seatRig.name, changed, adds ? seats.delegation : undefined).then(r => {
      if (!r.ok) { setSeats(x => (x ? { ...x, applying: false } : x)); tui.toast({ text: t.rigSeats.why[r.error ?? ''] ?? r.error ?? '', tone: 'error' }); return; }
      setSeats(null); rig.refresh();
      const done = t.rigSeats.done(r.added.length, r.removed.length, r.links);
      tui.toast({ text: r.linksUnsupported ? `${done} · ${t.rigSeats.linksUnsupported}` : done, tone: r.linksUnsupported ? 'info' : 'ok' });
    });
  };

  useScreenKeys((input, key) => {
    if (seats) {
      if (seats.applying) return true;
      if (key.escape) { setSeats(null); return true; }
      if (key.return) { apply(); return true; }
      if (key.upArrow || input === 'k') { setSeats(x => (x ? { ...x, at: step(x.at, -1, rows.length) } : x)); return true; }
      if (key.downArrow || input === 'j') { setSeats(x => (x ? { ...x, at: step(x.at, 1, rows.length) } : x)); return true; }
      const role = rows[seats.at]?.role;
      if (role && (input === '+' || input === '=')) { setSeats(x => (x ? { ...x, counts: withCount(x.counts, role, 1) } : x)); return true; }
      if (role && input === '-') { setSeats(x => (x ? { ...x, counts: withCount(x.counts, role, -1) } : x)); return true; }
      if (key.leftArrow || key.rightArrow) { setSeats(x => (x ? { ...x, delegation: x.delegation === 'pairs' ? 'all' : 'pairs' } : x)); return true; }
      return true;
    }
    if (confirm) {
      if (input === 'y') { run(confirm.action); setConfirm(null); return true; }
      if (input === 'n' || key.escape) { setConfirm(null); return true; }
      return true;
    }
    if (key.tab) {
      const i = Math.max(0, machines.findIndex(m => m.id === machine?.id));
      const n = machines[step(i, key.shift ? -1 : 1, machines.length)]?.id ?? null; tui.kept.rigMachine = n; setMachineId(n); setOpen(new Set()); setSeatAt(null); return true;
    }
    if (input === 'v') { onRoles(undefined, machine?.id ?? null); return true; }
    if (input === 'i') {
      const n = current && seatSel !== null ? current.nodes[seatSel] : undefined;
      const role = n && current ? roleOf(current.name, n.logicalId) : undefined;
      if (role && current && n) onRoles({ id: role.id, seat: `${current.name}/${n.logicalId}` }, machine?.id ?? null);
      return true;
    }
    if (input === '+') { if (machine) tui.go('rigLaunch'); return true; }
    if (key.upArrow || input === 'k') { up(); return true; }
    if (key.downArrow || input === 'j') { down(); return true; }
    if (key.return) {
      if (current) { setOpen(s => { const n = new Set(s); if (n.has(current.id)) n.delete(current.id); else n.add(current.id); return n; }); setSeatAt(null); }
      return true;
    }
    // One action at a time on a machine: the keys wait for the one running.
    const busy = rig.pending !== null;
    if (input === 'D') { if (state?.installed && !busy) ask(daemonToggle(state)); return true; }
    if (input === 'K') { if (daemonUp(state) && !busy) ask(kernelToggle(state!)); return true; }
    // The kernel's operator, a seat Ledge follows: its session screen, to talk to it.
    if (input === 'O') {
      const op = operatorSession(state, tui.d.sessions, machine?.id ?? 'local');
      if (op) { tui.select(op.id); tui.go('session'); } else if (daemonUp(state)) tui.toast({ text: o.operatorNotYet, tone: 'info' });
      return true;
    }
    if (input === 's') { if (daemonUp(state) && current && !busy) ask(rigToggle(current)); return true; }
    if (input === 'R') { if (daemonUp(state) && current && !busy) ask({ kind: 'rig.restart', rig: current.name }); return true; }
    if (input === '±' || input === '=') {
      if (!busy && canReseat(current)) setSeats({ rig: current.name, counts: countsOf(seatRows(current)), at: 0, delegation: 'pairs', applying: false });
      else if (current) tui.toast({ text: t.rigSeats.notRunning, tone: 'info' });
      return true;
    }
    return false;
  });

  const keys: Array<[string, string]> = seats
    ? [['↑ ↓', t.rigSeats.role], ['- +', t.rigSeats.count], ['← →', t.rigSeats.delegationKey], ['↵', t.rigSeats.apply], ['esc', t.rigSeats.cancel]]
    : confirm
    ? [['y', o.yes], ['n', o.no]]
    : [['tab', o.machine], ['v', t.roles.k.view], ['j k', t.keys.navigate], ['↵', o.unfold], ...(seatSel !== null ? [['i', t.roles.k.role] as [string, string]] : []), ['s', o.toggle], ['R', o.restart], ['± =', t.rigSeats.key], ['+', t.rigLaunch.launchKey], ['D', o.daemonKey], ['K', o.kernelKey], ['O', o.operatorKey], ['esc', t.keys.back]];
  const crumb = [state?.version ? o.version(state.version) : o.title, machine?.label, t.roles.rigs].filter(Boolean).join(' · ');

  return (
    <Frame crumb={crumb} crumbShort={o.title} keys={keys}>
      {!machine ? null
        : rig.error ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.yellow}>{rig.error === 'offline' ? o.offline : o.outdated}</Text></TitledBox>
        : !state ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.faint}>{o.loading}</Text></TitledBox>
        : !state.installed ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.dim}>{o.notInstalled}</Text></TitledBox>
        : seats && seatRig ? <RigSeats rig={seatRig} machine={machine.label} rows={rows} counts={seats.counts} at={seats.at} delegation={seats.delegation} plan={planOf(seatRig, rows, seats.counts)} applying={seats.applying} />
        : <Body state={state} rigs={rigs} at={at} seatAt={seatSel} open={open} machineLabel={machine.label} roleOf={roleOf} />}
      {confirm ? <ConfirmBox confirm={confirm} /> : null}
      {rig.pending ? <Box paddingX={1} height={1}><Text wrap="truncate" color={C.blue}>{o.running(confirmOf(state ?? EMPTY, rig.pending).commands.join(' && '))}</Text></Box> : null}
    </Frame>
  );
}

const EMPTY: OpenRigState = { installed: true, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: '' };

function Body({ state, rigs, at, seatAt, open, machineLabel, roleOf }: { state: OpenRigState; rigs: Rig[]; at: number; seatAt: number | null; open: ReadonlySet<string>; machineLabel: string; roleOf: (rig: string, seat: string) => RoleSummary | undefined }) {
  const { t } = useTui();
  const o = t.openrig;
  const up = daemonUp(state);
  const kernelColor = state.kernel.state === 'ready' ? C.green : state.kernel.state === 'starting' ? C.blue : C.faint;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box>
        <TitledBox title={`${o.daemon} · ${machineLabel}`} flexGrow={1} width="50%">
          <Text wrap="truncate"><Text color={up ? C.green : C.faint}>{up ? '● ' : '○ '}{o.daemonState[state.daemon.state] ?? state.daemon.state}</Text><Text color={C.dim}>{'   '}{up ? o.daemonMeta(state.daemon.port, state.daemon.pid) : state.daemon.message ?? ''}</Text></Text>
          <Text wrap="truncate" color={C.faint}>{up ? o.restoreHint : o.stoppedDaemon}</Text>
        </TitledBox>
        <TitledBox title={o.kernel} flexGrow={1} width="50%">
          <Text wrap="truncate" color={up ? kernelColor : C.faint}>{state.kernel.state === 'ready' ? '● ' : '○ '}{o.kernelState[state.kernel.state] ?? state.kernel.state}</Text>
          <Text wrap="truncate" color={C.faint}>{o.kernelHint}</Text>
          {up && (state.rigs.find(r => r.name === 'kernel')?.nodes ?? []).map(n => (
            <Text key={n.session} wrap="truncate">
              <Text color={n.sessionStatus !== 'running' ? C.faint : n.activity === 'running' ? C.blue : C.green}>{'◆ '}</Text>
              <Text color={C.fg}>{n.logicalId.padEnd(16)}</Text>
              <Text color={C.dim}>{n.runtime.padEnd(13)}</Text>
              <Text color={C.dim}>{n.sessionStatus === 'running' ? o.activity(n.activity) : n.sessionStatus}</Text>
              {n.logicalId === 'operator.agent' && <Text color={C.faint}>{'  '}{o.operatorHint}</Text>}
            </Text>
          ))}
        </TitledBox>
      </Box>
      <TitledBox title={`${o.rigs} · ${rigs.length}`} flexGrow={1}>
        {!up ? <Text color={C.faint}>{o.stoppedDaemon}</Text>
          : !rigs.length ? <Text color={C.faint}>{o.noRigs}</Text>
          : rigs.map((r, i) => <RigRow key={r.id} rig={r} selected={i === at && seatAt === null} seatAt={i === at ? seatAt : null} open={open.has(r.id)} roleOf={roleOf} />)}
      </TitledBox>
    </Box>
  );
}

function RigRow({ rig, selected, seatAt, open, roleOf }: { rig: Rig; selected: boolean; seatAt: number | null; open: boolean; roleOf: (rig: string, seat: string) => RoleSummary | undefined }) {
  const { t } = useTui();
  const o = t.openrig;
  const look = rigLook(rig), l = LOOK[look];
  const onPurpose = look === 'stopped' && rig.nodes.length > 0 && rig.nodes.every(n => n.stopped);
  const note = rig.attention > 0 ? { text: o.attention(rig.attention), color: C.yellow } : onPurpose ? { text: o.stoppedOnPurpose, color: C.dim } : null;
  const when = [rig.uptime ? o.since(rig.uptime) : '', rig.snapshot ? o.snapshot(rig.snapshot) : ''].filter(Boolean).join(' · ');
  return (
    <Box flexDirection="column">
      <Box backgroundColor={selected ? C.sel : undefined}>
        <Text wrap="truncate">
          <Text color={selected ? C.coral : C.faint}>{selected ? '▌' : ' '}</Text>
          <Text color={C.dim}>{open ? '▾ ' : '▸ '}</Text>
          <Text color={C.fg} bold>{rig.name.padEnd(16)}</Text>
          <Text color={l.color()}>{` ${l.glyph} ${o.look[look]}`.padEnd(18)}</Text>
          <Text color={C.fg}>{o.seats(rig.running, rig.seats).padEnd(7)}</Text>
          {note ? <Text color={note.color}>{note.text.padEnd(34)}</Text> : <Text>{''.padEnd(34)}</Text>}
          <Text color={C.dim}>{when}</Text>
        </Text>
      </Box>
      {open ? rig.nodes.map((n, i) => {
        // A seat shows its role; the one selected says i opens it (docs/mockups/ledge-openrig-roles-tui.html, view Rigs).
        const s = i === seatAt, bg = s ? C.sel : undefined, role = roleOf(rig.name, n.logicalId);
        return (
          <Box key={n.logicalId} backgroundColor={bg}>
            <Text wrap="truncate">
              <Text color={C.coral}>{s ? '▌' : ' '}</Text>
              <Text color={seatBusy(n) ? C.blue : C.faint}>{'    ◆ '}</Text>
              <Text color={C.fg} bold={s}>{n.logicalId.padEnd(14)}</Text>
              <Text color={s ? C.blue : C.dim} bold={s}>{(role?.name ?? '').padEnd(18)}</Text>
              <Text color={C.dim}>{[n.runtime, n.model].filter(Boolean).join(' · ').padEnd(32)}</Text>
              <Text color={n.activity === 'running' ? C.blue : C.dim}>{o.activity(n.activity).padEnd(12)}</Text>
              <Text color={C.dim}>{o.work(n.work).padEnd(5)}</Text>
              {s && role ? <Text color={C.faint}>{`i  ${t.roles.seeRole}`}</Text> : null}
            </Text>
          </Box>
        );
      }) : null}
    </Box>
  );
}

function ConfirmBox({ confirm }: { confirm: Confirm }) {
  const { t } = useTui();
  const o = t.openrig;
  return (
    <TitledBox title={o.confirmTitle} color={C.coral} titleColor={C.coral} titleBold double>
      <Text wrap="truncate" color={C.fg} bold>{question(t, confirm.action)}</Text>
      <Text wrap="wrap" color={confirm.busy.length ? C.yellow : C.dim}>{o.busy(confirm.busy.join(', '), confirm.busy.length)}</Text>
      {confirm.commands.map(c => <Text key={c} wrap="truncate" color={C.faint}>{c}</Text>)}
      <Text><Text color={C.fg} bold> y </Text><Text color={C.dim}>{o.yes}   </Text><Text color={C.fg} bold> n </Text><Text color={C.dim}>{o.no}</Text></Text>
    </TitledBox>
  );
}

/** The Ledge session of the kernel's operator seat (`operator.agent`) on that machine, once Ledge follows it. */
export function operatorSession(state: OpenRigState | null, sessions: readonly Session[], machine: string): Session | undefined {
  const seat = state?.rigs.find(r => r.name === 'kernel')?.nodes.find(n => n.logicalId === 'operator.agent')?.session;
  return seat ? sessions.find(x => x.rig?.seat === seat && x.state !== 'exited' && (x.machineId ?? 'local') === machine) : undefined;
}
