import { describe, expect, it } from 'vitest';
import type { OpenRigState, Rig, RigSeat } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';
import type { OpenRigSeen } from '@ledge/fleet/openrig';
import { rigCommands, type RigPaletteText } from '../../src/ide/palette/rigCommands';

const seat = (logicalId: string, rig: string): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const rig = (name: string, status: string): Rig => ({ id: name, name, status, lifecycleState: status, seats: 1, running: status === 'running' ? 1 : 0, attention: 0, uptime: null, snapshot: null, nodes: [seat('a.one', name)] });
const state = (rigs: Rig[]): OpenRigState => ({ installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-09T10:00:00.000Z', rigs });
const machine = (id: string, label: string) => ({ id, label, ready: true }) as unknown as MachineState;

const TEXT: RigPaletteText = {
  launchRig: 'Lancer un rig…', rigView: r => `Vue Rig : ${r}`, orSection: s => `OpenRig : ${s}`, showMachine: m => `Afficher la machine : ${m}`,
  sections: { overview: 'Vue d’ensemble', rigs: 'Rigs', roles: 'Rôles', machines: 'Machines', daemon: 'Daemon', output: 'Sortie' }, current: 'actuelle', stopped: 'arrêté'
};
const noop = { launch() {}, rigView() {}, section() {}, showMachine() {} };
const rows = (machines: MachineState[], seen: Map<string, OpenRigSeen>, shown = 'local') => rigCommands(machines, seen, shown, TEXT, noop).map((c): [string, string] => [c.label, c.hint ?? '']);

describe('the palette’s OpenRig commands', () => {
  it('launch, a Rig view per rig and the kernel with its machine (« arrêté » when stopped), the six OpenRig sections', () => {
    const seen = new Map<string, OpenRigSeen>([['local', { state: state([rig('kernel', 'running'), rig('ledge-dev', 'running'), rig('pilot', 'stopped')]) }]]);
    expect(rows([machine('local', 'WSL')], seen)).toEqual([
      ['Lancer un rig…', ''], ['Vue Rig : kernel', 'WSL'], ['Vue Rig : ledge-dev', 'WSL'], ['Vue Rig : pilot', 'WSL · arrêté'],
      ...['Vue d’ensemble', 'Rigs', 'Rôles', 'Machines', 'Daemon', 'Sortie'].map(s => [`OpenRig : ${s}`, ''])
    ]);
  });

  it('« Afficher la machine : X » only with two machines or more, the one shown « actuelle »; a machine not answering has no Rig view', () => {
    const seen = new Map<string, OpenRigSeen>([['local', { state: state([rig('kernel', 'running')]) }], ['srv', { state: null, error: 'offline' }]]);
    const r = rows([machine('local', 'WSL'), machine('srv', 'srv-build')], seen, 'srv');
    expect(r.filter(([l]) => l.startsWith('Vue Rig'))).toEqual([['Vue Rig : kernel', 'WSL']]);
    expect(r.slice(-2)).toEqual([['Afficher la machine : WSL', ''], ['Afficher la machine : srv-build', 'actuelle']]);
    expect(rows([machine('local', 'WSL')], seen).some(([l]) => l.startsWith('Afficher'))).toBe(false);
  });
});
