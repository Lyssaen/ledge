import { launchCommands, RigNameSchema, showRigCommand, type OpenRigAction, type OpenRigState, type RigLaunch, type RigSpec } from '@ledge/protocol';
import { commandsOf, emptyForm, isRunning, kernelRig, launchOf, listedRigs, rolesOf, seatTotal, type LaunchForm } from '../../openrig/model';
import { policyOf, type PermLevel } from '../rig/model';

/** What the launch modal starts from: a stopped rig (relaunch), a library spec, the empty rig, or the operator. */
export type LaunchFrom = { kind: 'rig'; rig: string } | { kind: 'spec'; spec: string } | { kind: 'empty' } | { kind: 'operator' };

export interface FromChoice {
  from: LaunchFrom; title: string; seats: number; running: boolean; source?: 'builtin' | 'user';
  disabled: false | 'running' | 'kernel' | 'noFactory';
}

/** The built-in spec the empty rig is made from (R4). */
export const EMPTY_SPEC = 'factory';

/** The cards of « Partir de » (R1): the machine's rigs (kernel out), the specs no rig is named after, the empty rig, the operator. */
export function fromChoices(specs: readonly RigSpec[], state: OpenRigState, kernelReady: boolean): FromChoice[] {
  const rigs = listedRigs(state);
  const taken = new Set(rigs.map(r => r.name));
  const factory = specs.find(s => s.name === EMPTY_SPEC);
  return [
    ...rigs.map((r): FromChoice => ({ from: { kind: 'rig', rig: r.name }, title: r.name, seats: r.seats, running: isRunning(r), disabled: isRunning(r) ? 'running' : false })),
    ...specs.filter(s => !taken.has(s.name)).map((s): FromChoice => ({
      from: { kind: 'spec', spec: s.name }, title: s.name, seats: rolesOf(s).length, running: false, disabled: false, ...(s.source === 'builtin' || s.source === 'user' ? { source: s.source } : {})
    })),
    { from: { kind: 'empty' }, title: EMPTY_SPEC, seats: factory ? Object.values(emptySeats(factory)).reduce((n, c) => n + c, 0) : 0, running: false, disabled: factory ? false : 'noFactory' },
    { from: { kind: 'operator' }, title: 'operator', seats: 0, running: false, disabled: kernelReady ? false : 'kernel' }
  ];
}

/** The empty rig's seats (R4), computed on its spec: `orch.lead` and `dev.build` at 1, every other role at 0. */
export const emptySeats = (spec: RigSpec): Record<string, number> =>
  Object.fromEntries(rolesOf(spec).map(r => [r.role, r.role === 'orch.lead' || r.role === 'dev.build' ? 1 : 0]));

const sameFrom = (a: LaunchFrom, b: LaunchFrom): boolean =>
  a.kind === b.kind && (a.kind === 'rig' ? a.rig === (b as typeof a).rig : a.kind === 'spec' ? a.spec === (b as typeof a).spec : true);

/** The choice to show: the current one while it is on the grid and not greyed, else the first active card. */
export function pickFrom(choices: readonly FromChoice[], current: LaunchFrom | null): LaunchFrom | null {
  const active = choices.filter(c => !c.disabled);
  return active.find(c => current && sameFrom(c.from, current))?.from ?? active[0]?.from ?? null;
}

/** The launch a new rig sends: the form, with the level as its policy (`spec`: the spec's own, nothing to pass). */
export function newLaunch(spec: RigSpec, form: LaunchForm, level: PermLevel, plan: boolean): RigLaunch {
  const p = policyOf(level);
  return launchOf(spec, { ...form, policy: p === 'spec' ? null : p }, plan);
}

/** Why the form cannot launch, first one first. `spec`: lets a role the form does not mention count for its default seat. */
export function launchProblem(form: LaunchForm, state: OpenRigState, spec?: RigSpec): 'cwd' | 'name' | 'exists' | 'noSeat' | null {
  const name = form.name.trim();
  if (!RigNameSchema.safeParse(name).success) return 'name';
  if (state.rigs.some(r => r.name === name)) return 'exists';
  if (!form.cwd.trim()) return 'cwd';
  const seats = spec ? seatTotal(spec, form) : Object.values(form.seats).reduce((n, c) => n + c, 0);
  const none = spec ? seats === 0 : Object.keys(form.seats).length > 0 && seats === 0;
  return none ? 'noSeat' : null;
}

/** What « Relancer » sends (R2): the permission level first when it changes, then the start (fresh seats when not resuming). `seats`: logical ids. */
export function relaunchActions(rig: string, level: PermLevel | null, current: PermLevel | 'mixed' | null, seats: readonly string[], resume: boolean): OpenRigAction[] {
  return [
    ...(level && level !== current && seats.length ? [{ kind: 'rig.policy' as const, rig, policy: policyOf(level), seats: seats.map(s => `${s}@${rig}`) }] : []),
    resume || !seats.length ? { kind: 'rig.start', rig } : { kind: 'rig.start', rig, fresh: [...seats] }
  ];
}

/** The command line the modal shows: what runs, joined by ` && `, after the daemon's start when it is down. */
export function liveCommand(input: { daemonUp: boolean; startAction: OpenRigAction } & ({ launch: RigLaunch; spec: RigSpec } | { actions: readonly OpenRigAction[] })): string {
  const run = 'launch' in input
    ? launchCommands(input.launch, input.spec, { rigsDir: '~/.ledge/rigs', name: true }).map(showRigCommand)
    : input.actions.flatMap(commandsOf);
  return [...(input.daemonUp ? [] : commandsOf(input.startAction)), ...run].join(' && ');
}
