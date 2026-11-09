import type { MachineState } from '@ledge/fleet';
import type { OpenRigSeen } from '@ledge/fleet/openrig';
import { OPENRIG_SECTIONS, type OpenRigSection } from '../../nav/state';
import { rigsViewOf } from '../rigs/model';
import type { PaletteCommand } from './model';

export interface RigPaletteText {
  launchRig: string; rigView(rig: string): string; orSection(section: string): string; showMachine(machine: string): string;
  sections: Record<OpenRigSection, string>; current: string; stopped: string;
}
export interface RigPaletteActions { launch(): void; rigView(machine: string, rig: string): void; section(s: OpenRigSection): void; showMachine(id: string): void }

/** The palette's OpenRig commands (states mockup, « Palette · rigs, OpenRig et machines »), flat — the filter does the rest:
 *  « Lancer un rig… », a « Vue Rig : X » per rig and one for the kernel of every machine OpenRig answers on (the machine, and
 *  « arrêté », at the right), the six sections of the OpenRig page (« OpenRig : … ») and, with two machines or more, an
 *  « Afficher la machine : X » per machine, the one shown marked « actuelle ». */
export function rigCommands(machines: readonly MachineState[], seen: ReadonlyMap<string, OpenRigSeen>, shown: string, text: RigPaletteText, act: RigPaletteActions): PaletteCommand[] {
  const out: PaletteCommand[] = [{ kind: 'command', id: 'rig:launch', label: text.launchRig, run: act.launch }];
  for (const m of machines) {
    const s = seen.get(m.id);
    const view = rigsViewOf({ state: s?.state ?? undefined, ...(s?.error ? { error: s.error } : {}), machine: m.id, sessions: [], asks: [] });
    for (const r of [...(view.kernel ? [view.kernel] : []), ...view.rigs]) {
      out.push({ kind: 'command', id: `rig:${m.id}:${r.name}`, label: text.rigView(r.name), hint: r.running ? m.label : `${m.label} · ${text.stopped}`, run: () => act.rigView(m.id, r.name) });
    }
  }
  for (const k of OPENRIG_SECTIONS) out.push({ kind: 'command', id: `openrig:${k}`, label: text.orSection(text.sections[k]), run: () => act.section(k) });
  if (machines.length >= 2) {
    for (const m of machines) out.push({ kind: 'command', id: `machine:${m.id}`, label: text.showMachine(m.label), ...(m.id === shown ? { hint: text.current } : {}), run: () => act.showMachine(m.id) });
  }
  return out;
}
