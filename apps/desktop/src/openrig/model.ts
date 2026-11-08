import { KERNEL_RIG, RIG_POLICIES, RigNameSchema, rigCommands, showRigCommand, type OpenRigAction, type OpenRigState, type Projects, type Rig, type RigLaunch, type RigPolicy, type RigSeat, type RigSpec, type Session } from '@ledge/protocol';

/**
 * What the OpenRig page (docs/mockups/ledge-openrig.html, views 1, 2 and 5) shows and offers, as pure functions: the
 * React page only draws them. Every stop asks first and names who works; a start does not ask.
 */

export const isRunning = (r: Rig): boolean => r.status === 'running' || r.status === 'partial' || r.running > 0;
/** The rigs of the list: the kernel has its own card. */
export const listedRigs = (s: OpenRigState): Rig[] => s.rigs.filter(r => r.name !== KERNEL_RIG);
export const kernelRig = (s: OpenRigState): Rig | undefined => s.rigs.find(r => r.name === KERNEL_RIG);
/** A seat that would lose work if it stopped now: it is running a turn, or holds tasks. */
export const isWorking = (seat: RigSeat): boolean => seat.activity === 'running' || seat.work > 0;

/** What stopping would interrupt: every working seat of the rig (the kernel's for the kernel, every rig's for the daemon). */
export function workingSeats(s: OpenRigState, action: OpenRigAction): Array<{ rig: string; seat: RigSeat }> {
  const of = (rigs: Rig[]) => rigs.flatMap(r => r.nodes.filter(isWorking).map(seat => ({ rig: r.name, seat })));
  switch (action.kind) {
    case 'rig.stop': case 'rig.restart': return of(s.rigs.filter(r => r.name === action.rig));
    case 'kernel.stop': case 'kernel.restart': return of(s.rigs.filter(r => r.name === KERNEL_RIG));
    case 'daemon.stop': case 'daemon.restart': return of(s.rigs);
    default: return [];
  }
}

/** Whether an action stops something, and so asks first. */
export const asksFirst = (a: OpenRigAction): boolean => a.kind.endsWith('.stop') || a.kind.endsWith('.restart');

/** The commands as the page shows them, `rig down starter --snapshot`. */
export const commandsOf = (a: OpenRigAction): string[] => rigCommands(a).map(showRigCommand);

/** The rig an action is about, for the row that shows it busy; null for the daemon and the kernel. */
export const rigOf = (a: OpenRigAction | null): string | null => (a && 'rig' in a ? a.rig : null);

/** `kernel` for kernel actions, `daemon` for daemon ones, the rig's name otherwise. */
export const targetOf = (a: OpenRigAction): string => (a.kind.startsWith('daemon.') ? 'daemon' : a.kind.startsWith('kernel.') ? KERNEL_RIG : (a as { rig: string }).rig);

// ── Launching a rig (view 6) ──

export interface RigRole { role: string; pod: string; id: string; runtime: string; model?: string; agent: string }
/** Each `pod.member` of a spec, in its order. */
export const rolesOf = (spec: RigSpec): RigRole[] => spec.pods.flatMap(p => p.members.map(m => ({ role: `${p.id}.${m.id}`, pod: p.id, id: m.id, runtime: m.runtime, ...(m.model ? { model: m.model } : {}), agent: m.agent })));

export interface LaunchForm { cwd: string; name: string; seats: Record<string, number>; runtimes: Record<string, 'claude-code' | 'codex'>; models: Record<string, string>; delegation: 'pairs' | 'all'; save: boolean;
  /** The rig's policy, null: the spec's. */ policy: RigPolicy | null; /** A role's, over the rig's. */ policies: Record<string, RigPolicy>; nonInterruptive: boolean }
export const emptyForm = (spec: RigSpec | undefined, cwd = ''): LaunchForm => ({ cwd, name: spec?.name ?? '', seats: {}, runtimes: {}, models: {}, delegation: 'pairs', save: false, policy: null, policies: {}, nonInterruptive: false });

/** How many seats the form launches. */
export const seatTotal = (spec: RigSpec, f: LaunchForm): number => rolesOf(spec).reduce((n, r) => n + (f.seats[r.role] ?? 1), 0);
/** Whether a role has more than one seat, so the delegation choice matters. */
export const multiplies = (f: LaunchForm): boolean => Object.values(f.seats).some(n => n > 1);

/** The launch the form sends: only what differs from the spec (a harness or model equal to the spec's is not a change). */
export function launchOf(spec: RigSpec, f: LaunchForm, plan: boolean): RigLaunch {
  const roles = rolesOf(spec);
  const seats = Object.fromEntries(roles.filter(r => (f.seats[r.role] ?? 1) !== 1).map(r => [r.role, f.seats[r.role]!]));
  const runtimes = Object.fromEntries(roles.filter(r => f.runtimes[r.role] && f.runtimes[r.role] !== r.runtime).map(r => [r.role, f.runtimes[r.role]!]));
  const models = Object.fromEntries(roles.filter(r => f.models[r.role]?.trim() && f.models[r.role]!.trim() !== r.model).map(r => [r.role, f.models[r.role]!.trim()]));
  return {
    spec: spec.name, cwd: f.cwd.trim(), name: f.name.trim(),
    ...(Object.keys(seats).length ? { seats } : {}), ...(Object.keys(runtimes).length ? { runtimes } : {}), ...(Object.keys(models).length ? { models } : {}),
    ...(multiplies(f) ? { delegation: f.delegation } : {}), ...(f.save ? { save: true } : {}), ...(plan ? { plan: true } : {}),
    ...(f.policy ? { policy: f.policy } : {}), ...(Object.keys(f.policies).length ? { policies: f.policies } : {}), ...(f.nonInterruptive && bypasses(f) ? { nonInterruptive: true } : {})
  };
}

/** Whether the form can be sent: a folder, and a name `rig` takes. */
export const launchable = (f: LaunchForm): boolean => f.cwd.trim().length > 0 && RigNameSchema.safeParse(f.name.trim()).success;

/** The Ledge projects' folders on a machine, for the folder field. */
export const folderChoices = (projects: Projects | null, machine: string): Array<{ label: string; path: string }> =>
  (projects?.projects ?? []).flatMap(p => p.repos.filter(r => r.machine === machine).map(r => ({ label: p.name, path: r.path })));

/** Whether a seat would launch with every prompt bypassed (YOLO), so Claude's first-launch warning would stop it. */
export const bypasses = (f: LaunchForm): boolean => f.policy === 'yolo' || Object.values(f.policies).includes('yolo');
/** `builtin:auto` -> `auto`; null for a custom policy file or none. */
export const builtinOf = (policy: string | undefined): RigPolicy | null => { const m = /^builtin:(\w+)$/.exec(policy ?? ''); return m && (RIG_POLICIES as readonly string[]).includes(m[1]!) ? m[1] as RigPolicy : null; };

/** The Ledge session of the kernel's operator seat (`operator.agent`) on that machine, once Ledge follows it. */
export function operatorOf(state: OpenRigState | null, sessions: readonly Session[], machine: string): Session | undefined {
  const seat = state?.rigs.find(r => r.name === 'kernel')?.nodes.find(n => n.logicalId === 'operator.agent')?.session;
  if (!seat) return undefined;
  return sessionOfSeat(sessions, seat, machine);
}

/** The Ledge session that follows an OpenRig seat on that machine, if any. */
export const sessionOfSeat = (sessions: readonly Session[], seat: string, machine: string): Session | undefined =>
  sessions.find(x => x.rig?.seat === seat && x.state !== 'exited' && (x.machineId ?? 'local') === machine);
