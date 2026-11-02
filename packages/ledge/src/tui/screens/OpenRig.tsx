import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useOpenRig } from '@ledge/fleet/openrig';
import type { OpenRigAction, OpenRigState, Rig } from '@ledge/protocol';
import { useScreenKeys, useTui } from '../context.js';
import {
  asksFirst, confirmOf, daemonToggle, daemonUp, keepRig, kernelToggle, listedRigs, rigLook, rigToggle, seatBusy, step, type Confirm, type RigLook
} from '../model/openrig.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { Frame } from '../ui/Frame.js';
import { TitledBox } from '../ui/TitledBox.js';

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
  const { t, machines } = tui;
  const o = t.openrig;
  // The machine shown is kept while the TUI runs: « Lancer un rig » (+) launches on it, and coming back shows it again.
  const [machineId, setMachineId] = useState<string | null>(tui.kept.rigMachine ?? null);
  const machine = machines.find(m => m.id === machineId) ?? machines[0] ?? null;
  tui.kept.rigMachine = machine?.id ?? null;
  const rig = useOpenRig(tui.client, machine?.id ?? null);
  const state = rig.state;
  const rigs = listedRigs(state);
  const [at, setAt] = useState(0);
  const selectedId = useRef<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // The selection follows its rig when the list changes (a rig started, stopped or gone).
  const ids = rigs.map(r => r.id).join(',');
  useEffect(() => { setAt(a => keepRig(rigs, a, selectedId.current)); }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const current: Rig | undefined = rigs[Math.min(at, rigs.length - 1)];
  selectedId.current = current?.id ?? null;

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

  useScreenKeys((input, key) => {
    if (confirm) {
      if (input === 'y') { run(confirm.action); setConfirm(null); return true; }
      if (input === 'n' || key.escape) { setConfirm(null); return true; }
      return true;
    }
    if (key.tab) {
      const i = Math.max(0, machines.findIndex(m => m.id === machine?.id));
      setMachineId(machines[step(i, key.shift ? -1 : 1, machines.length)]?.id ?? null); setOpen(new Set()); return true;
    }
    if (input === '+') { if (machine) tui.go('rigLaunch'); return true; }
    if (key.upArrow || input === 'k') { setAt(i => step(i, -1, rigs.length)); return true; }
    if (key.downArrow || input === 'j') { setAt(i => step(i, 1, rigs.length)); return true; }
    if (key.return) {
      if (current) setOpen(s => { const n = new Set(s); if (n.has(current.id)) n.delete(current.id); else n.add(current.id); return n; });
      return true;
    }
    // One action at a time on a machine: the keys wait for the one running.
    const busy = rig.pending !== null;
    if (input === 'D') { if (state?.installed && !busy) ask(daemonToggle(state)); return true; }
    if (input === 'K') { if (daemonUp(state) && !busy) ask(kernelToggle(state!)); return true; }
    if (input === 's') { if (daemonUp(state) && current && !busy) ask(rigToggle(current)); return true; }
    if (input === 'R') { if (daemonUp(state) && current && !busy) ask({ kind: 'rig.restart', rig: current.name }); return true; }
    return false;
  });

  const keys: Array<[string, string]> = confirm
    ? [['y', o.yes], ['n', o.no]]
    : [['tab', o.machine], ['j k', t.keys.navigate], ['↵', o.unfold], ['s', o.toggle], ['R', o.restart], ['+', t.rigLaunch.launchKey], ['D', o.daemonKey], ['K', o.kernelKey], ['esc', t.keys.back]];
  const crumb = [state?.version ? o.version(state.version) : o.title, machine?.label].filter(Boolean).join(' · ');

  return (
    <Frame crumb={crumb} crumbShort={o.title} keys={keys}>
      {!machine ? null
        : rig.error ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.yellow}>{rig.error === 'offline' ? o.offline : o.outdated}</Text></TitledBox>
        : !state ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.faint}>{o.loading}</Text></TitledBox>
        : !state.installed ? <TitledBox title={o.title} mark={{ text: machine.label, color: C.dim }} flexGrow={1}><Text color={C.dim}>{o.notInstalled}</Text></TitledBox>
        : <Body state={state} rigs={rigs} at={at} open={open} machineLabel={machine.label} />}
      {confirm ? <ConfirmBox confirm={confirm} /> : null}
      {rig.pending ? <Box paddingX={1} height={1}><Text wrap="truncate" color={C.blue}>{o.running(confirmOf(state ?? EMPTY, rig.pending).commands.join(' && '))}</Text></Box> : null}
    </Frame>
  );
}

const EMPTY: OpenRigState = { installed: true, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: '' };

function Body({ state, rigs, at, open, machineLabel }: { state: OpenRigState; rigs: Rig[]; at: number; open: ReadonlySet<string>; machineLabel: string }) {
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
        </TitledBox>
      </Box>
      <TitledBox title={`${o.rigs} · ${rigs.length}`} flexGrow={1}>
        {!up ? <Text color={C.faint}>{o.stoppedDaemon}</Text>
          : !rigs.length ? <Text color={C.faint}>{o.noRigs}</Text>
          : rigs.map((r, i) => <RigRow key={r.id} rig={r} selected={i === at} open={open.has(r.id)} />)}
      </TitledBox>
    </Box>
  );
}

function RigRow({ rig, selected, open }: { rig: Rig; selected: boolean; open: boolean }) {
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
      {open ? rig.nodes.map(n => (
        <Text key={n.logicalId} wrap="truncate">
          <Text color={seatBusy(n) ? C.blue : C.faint}>{'     ◆ '}</Text>
          <Text color={C.fg}>{n.logicalId.padEnd(18)}</Text>
          <Text color={C.dim}>{[n.runtime, n.model].filter(Boolean).join(' · ').padEnd(26)}</Text>
          <Text color={n.activity === 'running' ? C.blue : C.dim}>{o.activity(n.activity).padEnd(12)}</Text>
          <Text color={C.dim}>{o.work(n.work)}</Text>
        </Text>
      )) : null}
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
