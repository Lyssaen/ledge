import { z } from 'zod';
import { EffortSchema, ModelIdSchema } from './models.js';

/**
 * OpenRig on a machine (mvschwarz/openrig): its daemon, its kernel (the rig named `kernel`, whose operator helps start a
 * team) and its rigs, read from `rig status --json` and `rig ps --json` by that machine's Ledge daemon, and driven by the
 * `rig` commands it runs there. Design: docs/mockups/ledge-openrig.html.
 */

/** A rig's name as `rig up` / `rig down` take it: never a leading `-`, which `rig` would read as a flag. */
export const RigNameSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'not a rig name');

/** An OpenRig seat's session name, `pod-member@rig` (`dev-build@starter`). */
export const RigSeatNameSchema = z.string().min(3).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/, 'not a seat');

/** A seat's permissions at its next launch (`rig seat set-permissions --mode`): `inherit` its rig's, `floor` the default posture,
 *  `auto` Claude's auto mode, `full_bypass` no prompt at all. */
export const SeatPermissionsSchema = z.enum(['inherit', 'floor', 'auto', 'full_bypass']);
export type SeatPermissions = z.infer<typeof SeatPermissionsSchema>;

/** The kernel's own rig, which OpenRig starts with its daemon unless told `--no-kernel`. */
export const KERNEL_RIG = 'kernel';

/** An OpenRig snapshot's id: a ULID, as `rig restore` takes it (never a leading `-`, which `rig` would read as a flag). */
export const RigSnapshotIdSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'not a snapshot id');

/** A seat of a rig, as `rig ps --nodes --json` reports it. `activity`: `agentActivity.state` (running, idle, unknown…). */
export const RigSeatSchema = z.object({
  logicalId: z.string(), session: z.string(), runtime: z.string(), model: z.string().nullable(),
  sessionStatus: z.string(), lifecycleState: z.string(), activity: z.string(),
  stopped: z.boolean(), work: z.number().int().min(0),
  /** OpenRig's `needsAttention` for the seat, when it says. */ attention: z.boolean().optional()
});
export type RigSeat = z.infer<typeof RigSeatSchema>;

/** A rig of the machine. `status`: running, stopped, partial… as OpenRig says; `uptime` and `snapshot` are its own words. */
export const RigSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), lifecycleState: z.string(),
  seats: z.number().int().min(0), running: z.number().int().min(0), attention: z.number().int().min(0),
  uptime: z.string().nullable(), snapshot: z.string().nullable(), nodes: z.array(RigSeatSchema),
  /** The spec file of a rig Ledge launched, when it is on the machine. */ specPath: z.string().optional()
});
export type Rig = z.infer<typeof RigSchema>;

export const RigDaemonStateSchema = z.enum(['running', 'stopped', 'stale', 'unknown']);
/** The kernel: `ready` its rig runs, `stopped` it does not, `skipped` the daemon was started without it, `absent` no such rig. */
export const RigKernelStateSchema = z.enum(['ready', 'starting', 'stopped', 'skipped', 'absent', 'unknown']);

/** OpenRig on one machine. `installed` false: no `rig` command there, and nothing else is known. */
export const OpenRigStateSchema = z.object({
  installed: z.boolean(), version: z.string().optional(),
  daemon: z.object({ state: RigDaemonStateSchema, pid: z.number().int().optional(), port: z.number().int().optional(), message: z.string().optional(),
    /** When the running daemon started (ISO), from OpenRig's `daemon.json`. */ startedAt: z.string().optional() }),
  kernel: z.object({ state: RigKernelStateSchema }),
  rigs: z.array(RigSchema),
  /** When it was read (ISO). */ at: z.string()
});
export type OpenRigState = z.infer<typeof OpenRigStateSchema>;

/** What Ledge can do to OpenRig on a machine. The rig ones name it in `rig`. */
/** OpenRig's built-in permission policies (`builtin:<name>`): `auto` Claude's auto mode, `yolo` no prompt at all, `open` / `standard`
 *  / `locked` recorded rules (applied once translated into the harness's settings). */
export const RigPolicySchema = z.enum(['auto', 'standard', 'open', 'yolo', 'locked']);
export type RigPolicy = z.infer<typeof RigPolicySchema>;
export const RIG_POLICIES: readonly RigPolicy[] = RigPolicySchema.options;
const OpenRigActionUnion = z.discriminatedUnion('kind', [
  /** `restore` `last`: `rig start --last` (the rigs that were running come back); `none`: `rig daemon start`. */
  z.object({ kind: z.literal('daemon.start'), restore: z.enum(['last', 'none']).optional(), noKernel: z.boolean().optional() }),
  z.object({ kind: z.literal('daemon.stop') }),
  z.object({ kind: z.literal('daemon.restart'), restore: z.enum(['last', 'none']).optional() }),
  z.object({ kind: z.literal('kernel.start') }),
  z.object({ kind: z.literal('kernel.stop') }),
  z.object({ kind: z.literal('kernel.restart') }),
  /** `snapshot`: brings the rig back from that snapshot (`rig restore <id> --rig <rig>`); without it, from the last usable one (`rig up --existing`). */
  z.object({ kind: z.literal('rig.start'), rig: RigNameSchema, snapshot: RigSnapshotIdSchema.optional() }),
  /** Takes a snapshot of the rig now (`rig snapshot <rig>`, kind `manual`). */
  z.object({ kind: z.literal('rig.snapshot'), rig: RigNameSchema }),
  z.object({ kind: z.literal('rig.stop'), rig: RigNameSchema, snapshot: z.boolean().optional(), force: z.boolean().optional(), delete: z.boolean().optional() }),
  z.object({ kind: z.literal('rig.restart'), rig: RigNameSchema }),
  /** A seat's settings (docs/mockups/ledge-openrig-groups.html, view 2). `runtime`: moves it now to the other harness (a successor
   *  takes its context, `rig seat set-runtime`), `model` and `effort` going with it; without it, `model`, `effort` and `permissions`
   *  apply at its next resume. `dryRun`: the move's plan only. */
  z.object({ kind: z.literal('seat.set'), seat: RigSeatNameSchema, runtime: z.enum(['claude-code', 'codex']).optional(), model: ModelIdSchema.optional(),
    effort: EffortSchema.optional(), permissions: SeatPermissionsSchema.optional(), dryRun: z.boolean().optional() }),
  /** Every listed seat's permissions, at its next launch (`rig seat set-permissions` one by one, stopping at the first failure): OpenRig
   *  has no permission of the rig itself to change. Each seat belongs to `rig` (`...@<rig>`: checked below). */
  z.object({ kind: z.literal('rig.permissions'), rig: RigNameSchema, mode: SeatPermissionsSchema, seats: z.array(RigSeatNameSchema).min(1).max(200) }),
  /** One of the six permission levels on every listed seat, at its next launch: per seat, the explicit mode goes back to `inherit`
   *  (`rig seat set-permissions`, else it would win over the policy), then `rig policy apply <policy> --seat` stores the policy on it.
   *  `spec`: what the rig's spec gives each seat (its member's `permission_policy`, else the rig's), resolved by the daemon (OpenRig
   *  cannot clear a seat's stored policy); refused (`spec_unknown`, `spec_no_policy`, `spec_policy_unsupported`) before anything runs.
   *  Stops at the first failure. Each seat belongs to `rig`. */
  z.object({ kind: z.literal('rig.policy'), rig: RigNameSchema, policy: z.union([RigPolicySchema, z.literal('spec')]), seats: z.array(RigSeatNameSchema).min(1).max(200) })
]);
export const OpenRigActionSchema = OpenRigActionUnion.superRefine((a, ctx) => {
  if (a.kind !== 'rig.permissions' && a.kind !== 'rig.policy') return;
  a.seats.forEach((s, i) => { if (!s.endsWith(`@${a.rig}`)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['seats', i], message: `not a seat of ${a.rig}` }); });
});
export type OpenRigAction = z.infer<typeof OpenRigActionSchema>;

/** A front asks a machine for its OpenRig. */
export const OpenRigStatusSchema = z.object({ type: z.literal('openrig.status'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
/** A front asks a machine to act on its OpenRig. */
export const OpenRigActSchema = z.object({ type: z.literal('openrig.act'), requestId: z.string().min(1).max(100), action: OpenRigActionSchema, machineId: z.string().optional() });

/** Why a machine could not answer: `offline` it dropped, `outdated` its daemon does not know OpenRig. */
export const OpenRigUnreachableSchema = z.enum(['offline', 'outdated']);
/** A machine's OpenRig. `requestId` answers a status; absent, it follows an action and goes to every front. `machineId`
 *  is set by the fleet. `error`: the machine could not answer, and `state` is then absent. */
export const OpenRigStateMessageSchema = z.object({
  type: z.literal('openrig.state'), requestId: z.string().optional(), machineId: z.string().optional(),
  state: OpenRigStateSchema.optional(), error: OpenRigUnreachableSchema.optional()
});
/** An action ended. `commands`: what was run, in order. `error`: why it failed (the last line `rig` printed, `busy` when
 *  another action runs on that machine, `not_installed`), plus the fleet's `offline` / `outdated`. */
export const OpenRigDoneSchema = z.object({
  type: z.literal('openrig.done'), requestId: z.string(), machineId: z.string().optional(), ok: z.boolean(),
  commands: z.array(z.string()), output: z.string().optional(), error: z.string().optional(),
  /** On a failed `rig.permissions` or `rig.policy`: how many seats (in order) went through before the one that failed. For `rig.policy`,
   *  the failed seat may already have lost its explicit selection (`--mode inherit` ran, `policy apply` did not). */
  completed: z.number().int().min(0).optional()
});
/** A rig's topology (lot 7a): one seat of a pod, keyed by `logicalId` (`dev.build`). `status` is OpenRig's own word (`running`,
 *  `exited`…; `unknown` when only the spec could be read); `attention` is its `needsAttention`; `role` the agent spec it runs
 *  (`resolvedSpecName`), `session` its canonical session name, `context` the used share of its context window (percent). */
export const RigGraphSeatSchema = z.object({
  logicalId: z.string(), pod: z.string(), role: z.string().optional(), runtime: z.string(), model: z.string().optional(),
  status: z.string(), session: z.string().optional(), attention: z.boolean(), context: z.number().optional()
});
/** A typed link between two seats, both as `logicalId`; `kind` is the edge's label (`delegates_to`, `escalates_to`, `collaborates_with`…). */
export const RigLinkSchema = z.object({ from: z.string(), to: z.string(), kind: z.string() });
/** A rig's pods, seats and links, for a running rig and a stopped one. */
export const RigGraphSchema = z.object({
  pods: z.array(z.object({ id: z.string(), label: z.string() })), seats: z.array(RigGraphSeatSchema), links: z.array(RigLinkSchema)
});
export type RigGraphSeat = z.infer<typeof RigGraphSeatSchema>;
export type RigLink = z.infer<typeof RigLinkSchema>;
export type RigGraph = z.infer<typeof RigGraphSchema>;

/** A front asks a machine for a rig's topology. */
export const OpenRigGraphSchema = z.object({ type: z.literal('openrig.graph'), requestId: z.string().min(1).max(100), machineId: z.string().optional(), rig: RigNameSchema });
/** The topology, or why not: `unknown_rig`, `not_installed`, `daemon_stopped`, or the fleet's `offline` / `outdated`. */
export const OpenRigGraphStateSchema = z.object({
  type: z.literal('openrig.graphState'), requestId: z.string(), machineId: z.string().optional(), rig: z.string(),
  graph: RigGraphSchema.optional(), error: z.string().optional()
});
export type OpenRigGraph = z.infer<typeof OpenRigGraphSchema>;
export type OpenRigGraphState = z.infer<typeof OpenRigGraphStateSchema>;

/** One snapshot of a rig, as the list tells it (never its `data`, which is heavy). `kind`: `manual`, `auto-pre-down`, `auto-periodic`,
 *  `pre_restore`… and `createdAt`, as OpenRig writes it (`2026-11-08 14:54:01`, UTC). */
export const RigSnapshotSchema = z.object({ id: z.string(), kind: z.string(), status: z.string(), createdAt: z.string() });
export type RigSnapshot = z.infer<typeof RigSnapshotSchema>;
/** How many snapshots a list carries: the most recent. */
export const RIG_SNAPSHOTS_MAX = 20;

/** A front asks a machine for a rig's snapshots. */
export const OpenRigSnapshotsSchema = z.object({ type: z.literal('openrig.snapshots'), requestId: z.string().min(1).max(100), machineId: z.string().optional(), rig: RigNameSchema });
/** The snapshots, newest first (`RIG_SNAPSHOTS_MAX` at most), or why not: `unknown_rig`, `not_installed`, `daemon_stopped`, what `rig` said, or the fleet's `offline` / `outdated`. */
export const OpenRigSnapshotListSchema = z.object({
  type: z.literal('openrig.snapshotList'), requestId: z.string(), machineId: z.string().optional(), rig: z.string(),
  snapshots: z.array(RigSnapshotSchema), error: z.string().optional()
});
/** One seat's permissions as OpenRig tells them (`rig seat status`): `mode` the effective mode (`acceptEdits`…), `source` where it comes from
 *  (`kernel_default`, `team_default`, `seat`…), `posture` the launch posture (`floor`…), `selection` the seat's own choice (`inherit`…),
 *  `summary` one sentence. What OpenRig does not say is absent; `error`: this seat's status could not be read (the others are). */
export const RigSeatPermissionSchema = z.object({
  logicalId: z.string(), session: z.string(), mode: z.string().optional(), source: z.string().optional(), posture: z.string().optional(),
  selection: z.string().optional(), summary: z.string().optional(), error: z.string().optional(),
  /** The member policy OpenRig's summary names (`builtin:<name>` or `none`): read from its sentence, not a contract; absent otherwise. */
  policy: z.string().optional(),
  /** OpenRig's `permissions.account.source` (`member_policy`, `rig_policy`, `team_default`, `floor`, `explicit`, `kernel_default`). */
  policySource: z.string().optional()
});
export type RigSeatPermission = z.infer<typeof RigSeatPermissionSchema>;

/** A front asks a machine for a rig's permissions: the spec's policy and each seat's effective mode. */
export const OpenRigPermissionsSchema = z.object({ type: z.literal('openrig.permissions'), requestId: z.string().min(1).max(100), machineId: z.string().optional(), rig: RigNameSchema });
/** `policy`: the rig's `permission_policy` when its spec is known to the machine's Ledge; absent otherwise. `error`: `unknown_rig`, `not_installed`,
 *  `daemon_stopped`, what `rig` said, or the fleet's `offline` / `outdated`. */
export const OpenRigPermissionListSchema = z.object({
  type: z.literal('openrig.permissionList'), requestId: z.string(), machineId: z.string().optional(), rig: z.string(),
  policy: z.string().optional(), seats: z.array(RigSeatPermissionSchema), error: z.string().optional()
});
export type OpenRigPermissions = z.infer<typeof OpenRigPermissionsSchema>;
export type OpenRigPermissionList = z.infer<typeof OpenRigPermissionListSchema>;

export type OpenRigSnapshots = z.infer<typeof OpenRigSnapshotsSchema>;
export type OpenRigSnapshotList = z.infer<typeof OpenRigSnapshotListSchema>;

export type OpenRigStatus = z.infer<typeof OpenRigStatusSchema>;
export type OpenRigAct = z.infer<typeof OpenRigActSchema>;
export type OpenRigStateMessage = z.infer<typeof OpenRigStateMessageSchema>;
export type OpenRigDone = z.infer<typeof OpenRigDoneSchema>;

/** The `rig` commands an action runs, in order; the first that fails stops the rest. `specPolicies`: per seat, the policy its spec gives it (`builtin:x`), for `rig.policy` with `spec`; without it the preview shows `<spec>`. */
export function rigCommands(a: OpenRigAction, specPolicies?: Record<string, string>): string[][] {
  // OpenRig 0.7 refuses a seat change from outside a managed seat without an operator (400 « Sender identity is required »).
  const who = ['--reason', 'Ledge', '--operator', 'ledge@external'];
  const start = (restore?: 'last' | 'none', noKernel?: boolean): string[] =>
    restore === 'last' ? ['start', '--last', '--json'] : ['daemon', 'start', ...(noKernel ? ['--no-kernel'] : [])];
  const up = (rig: string) => ['up', rig, '--existing', '--yes', '--json'];
  const down = (rig: string, o: { snapshot?: boolean; force?: boolean; delete?: boolean } = {}) =>
    ['down', rig, ...(o.snapshot ? ['--snapshot'] : []), ...(o.force ? ['--force'] : []), ...(o.delete ? ['--delete'] : []), '--json'];
  switch (a.kind) {
    case 'daemon.start': return [start(a.restore, a.noKernel)];
    case 'daemon.stop': return [['daemon', 'stop']];
    case 'daemon.restart': return [['daemon', 'stop'], start(a.restore)];
    case 'kernel.start': return [up(KERNEL_RIG)];
    case 'kernel.stop': return [down(KERNEL_RIG)];
    case 'kernel.restart': return [down(KERNEL_RIG, { snapshot: true }), up(KERNEL_RIG)];
    case 'rig.start': return [a.snapshot ? ['restore', a.snapshot, '--rig', a.rig] : up(a.rig)];
    case 'rig.snapshot': return [['snapshot', a.rig]];
    case 'rig.stop': return [down(a.rig, a)];
    case 'rig.restart': return [down(a.rig, { snapshot: true }), up(a.rig)];
    case 'rig.permissions': return a.seats.map(seat => ['seat', 'set-permissions', seat, '--mode', a.mode, ...who, '--json']);
    case 'rig.policy': return a.seats.flatMap(seat => {
      const name = a.policy === 'spec' ? (specPolicies?.[seat]?.replace(/^builtin:/, '') ?? '<spec>') : a.policy;
      return [['seat', 'set-permissions', seat, '--mode', 'inherit', ...who, '--json'], ['policy', 'apply', name, '--seat', seat, ...who, '--json']];
    });
    case 'seat.set': {
      const why = ['--reason', 'Ledge'];
      // `set-runtime` has no `--operator` in OpenRig 0.7; the other three do.
      if (a.runtime) return [['seat', 'set-runtime', a.seat, '--runtime', a.runtime, ...(a.model ? ['--model', a.model] : []), ...(a.effort ? ['--effort', a.effort] : []),
        ...(a.permissions && a.permissions !== 'inherit' ? ['--permission-mode', a.permissions] : []), ...(a.dryRun ? ['--dry-run'] : []), ...why]];
      return [
        ...(a.model ? [['seat', 'set-model', a.seat, '--model', a.model, ...who, '--json']] : []),
        ...(a.effort ? [['seat', 'set-effort', a.seat, '--effort', a.effort, ...who, '--json']] : []),
        ...(a.permissions ? [['seat', 'set-permissions', a.seat, '--mode', a.permissions, ...who, '--json']] : [])
      ];
    }
  }
}

/** How a command reads in a front: `rig down starter --snapshot`, without the `--json` Ledge adds for itself. */
export const showRigCommand = (args: string[]): string => ['rig', ...args.filter(x => x !== '--json')].join(' ');


// ── Lot 2: launching a rig (docs/mockups/ledge-openrig.html, view 6) ──

/** A seat of a spec, as the launch form shows it: its role (`pod.member`), its harness, its model when the spec sets one, the agent it runs. */
export const RigSpecMemberSchema = z.object({ id: z.string(), runtime: z.string(), model: z.string().optional(), agent: z.string(), /** Its `permission_policy`, as written. */ policy: z.string().optional() });
export const RigSpecPodSchema = z.object({ id: z.string(), label: z.string().optional(), members: z.array(RigSpecMemberSchema) });
/** A rig spec of the machine's library: `source` `builtin` (shipped with OpenRig) or `user` (the person's own). */
export const RigSpecSchema = z.object({
  name: z.string(), source: z.string(), summary: z.string().optional(), path: z.string(),
  /** The rig's `permission_policy`, as written (`builtin:auto`, a file…). */ policy: z.string().optional(),
  pods: z.array(RigSpecPodSchema), edges: z.number().int().min(0),
  /** The spec's links between its seats as `pod.member` (a pod's edges, then the top-level ones), `kind` as written. */ links: z.array(RigLinkSchema).optional()
});
export type RigSpec = z.infer<typeof RigSpecSchema>;

/** A front asks a machine for its rig specs. */
export const OpenRigSpecsSchema = z.object({ type: z.literal('openrig.specs'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
/** The machine's rig specs; `error`: `daemon_stopped` (OpenRig must run to list them), `not_installed`, or the fleet's `offline` / `outdated`. */
export const OpenRigSpecListSchema = z.object({
  type: z.literal('openrig.specList'), requestId: z.string(), machineId: z.string().optional(), specs: z.array(RigSpecSchema), error: z.string().optional()
});

/** A role as `pod.member`. */
export const RigRoleSchema = z.string().min(3).max(201).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/, 'not a role');
const RuntimeSchema = z.enum(['claude-code', 'codex']);
/** What the launch form asks for. `seats`: how many of each role (1 when absent, 0 drops it); `runtimes` / `models` replace the spec's
 *  for a role; `delegation`: how added seats delegate (`pairs`: build-2 → review-2, `all`: each to each); `save`: keep the composed
 *  spec in the person's OpenRig library; `plan`: check only (`rig up --plan`). */
export const RigLaunchSchema = z.object({
  spec: RigNameSchema, cwd: z.string().min(1).max(4096), name: RigNameSchema,
  seats: z.record(RigRoleSchema, z.number().int().min(0).max(9)).optional(),
  runtimes: z.record(RigRoleSchema, RuntimeSchema).optional(),
  models: z.record(RigRoleSchema, z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@[\]=,+-]*$/)).optional(),
  delegation: z.enum(['pairs', 'all']).optional(), save: z.boolean().optional(), plan: z.boolean().optional(),
  /** The rig's permission policy, in place of the spec's; `policies`: a role's, over the rig's. */
  policy: RigPolicySchema.optional(), policies: z.record(RigRoleSchema, RigPolicySchema).optional(),
  /** Accept the harnesses' first-launch warnings (`rig up --non-interruptive`), so a bypassing seat does not stop on Claude's dialog. */
  nonInterruptive: z.boolean().optional()
});
export type RigLaunch = z.infer<typeof RigLaunchSchema>;
export const OpenRigLaunchSchema = z.object({ type: z.literal('openrig.launch'), requestId: z.string().min(1).max(100), launch: RigLaunchSchema, machineId: z.string().optional() });
/** A launch (or its check) ended. `yaml`: the spec launched (composed or the library's); `seats`: how many; `output`: what `rig` printed
 *  (the plan, for a check); `commands`: what was run; `error`: why it failed. */
export const OpenRigLaunchedSchema = z.object({
  type: z.literal('openrig.launched'), requestId: z.string(), machineId: z.string().optional(), ok: z.boolean(), plan: z.boolean(),
  commands: z.array(z.string()), yaml: z.string().optional(), seats: z.number().int().optional(), output: z.string().optional(), error: z.string().optional(),
  /** What `rig up --plan` concluded: its status (`planned`…), its errors and its warnings (one per seat without a permission policy…). */
  check: z.object({ status: z.string(), errors: z.array(z.string()), warnings: z.array(z.string()) }).optional()
});
export type OpenRigLaunched = z.infer<typeof OpenRigLaunchedSchema>;
export type OpenRigSpecList = z.infer<typeof OpenRigSpecListSchema>;

// ── Lot 3: changing a running rig's seats (docs/mockups/ledge-openrig.html, view 7) ──

/** A seat's role, `pod.member` without the copy's number: `dev.build-3` is `dev.build`. */
export const roleOf = (logicalId: string): string => logicalId.replace(/-\d+$/, '');
/** A copy's number: 1 for the role's first seat (`build`), 3 for `build-3`. */
const copyOf = (logicalId: string): number => { const m = /-(\d+)$/.exec(logicalId); return m ? Number(m[1]) : 1; };

/** A running rig's seats by role, each role's seats in copy order. */
export function seatsByRole(nodes: readonly { logicalId: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of nodes) out.set(roleOf(n.logicalId), [...(out.get(roleOf(n.logicalId)) ?? []), n.logicalId]);
  for (const [role, ids] of out) out.set(role, ids.sort((a, b) => copyOf(a) - copyOf(b)));
  return out;
}

/** What reaching `seats` (role -> count) does to a rig: the seats to add (each a copy of its role's first, under the next free
 *  number) and those to remove (the last copies first; the first seat only when its role goes to 0). A role not named keeps its count. */
export function seatPlan(nodes: readonly { logicalId: string }[], seats: Record<string, number>): { add: Array<{ role: string; pod: string; id: string; from: string }>; remove: string[] } {
  const by = seatsByRole(nodes);
  const add: Array<{ role: string; pod: string; id: string; from: string }> = [], remove: string[] = [];
  for (const [role, want] of Object.entries(seats)) {
    const have = by.get(role) ?? [];
    if (have.length === 0) continue;
    if (want < have.length) { remove.push(...have.slice(want).reverse()); continue; }
    const [pod, member] = role.split('.') as [string, string];
    let next = Math.max(...have.map(copyOf));
    for (let i = have.length; i < want; i++) add.push({ role, pod, id: `${member}-${++next}`, from: have[0]! });
  }
  return { add, remove };
}

/** A front asks a machine to change a running rig's seats. */
export const OpenRigSeatsSchema = z.object({
  type: z.literal('openrig.seats'), requestId: z.string().min(1).max(100), machineId: z.string().optional(),
  rig: RigNameSchema, seats: z.record(RigRoleSchema, z.number().int().min(0).max(9)),
  /** How the added seats are linked, where OpenRig can add links to a running rig (0.7+): like a launch's. */ delegation: z.enum(['pairs', 'all']).optional()
});
/** The seats changed (or not). `added` / `removed`: the seats, as `pod.member`; `error`: `rig_not_running`, `rig_root_unknown` (its
 *  agents cannot be found to copy a seat), `busy`, the fleet's `offline` / `outdated`, or what `rig` said. */
export const OpenRigReseatedSchema = z.object({
  type: z.literal('openrig.reseated'), requestId: z.string(), machineId: z.string().optional(), ok: z.boolean(),
  commands: z.array(z.string()), added: z.array(z.string()), removed: z.array(z.string()), output: z.string().optional(), error: z.string().optional(),
  /** The links ensured between the seats; `linksUnsupported`: this OpenRig cannot add links to a running rig (before 0.7). */
  links: z.number().int().optional(), linksUnsupported: z.boolean().optional()
});
export type OpenRigReseated = z.infer<typeof OpenRigReseatedSchema>;

// ── « À toi » : what OpenRig asks or tells the person (docs/vision/ledge-human-channel-contract.md, docs/mockups/ledge-human-operator-ab.html) ──

/** The longest request text a front receives; a longer one is cut and says so. */
export const HUMAN_ASK_BODY_MAX = 16_000;
/** At most this many open requests are sent, the most recent first. */
export const HUMAN_ASKS_MAX = 200;

/** A question's answer: the option chosen (`option`, its id), or the person's own words (`words`, OpenRig's typed reply); null while it waits. */
export const HumanQuestionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), id: z.string() }),
  z.object({ kind: z.literal('words'), text: z.string() })
]);
export type HumanQuestionAnswer = z.infer<typeof HumanQuestionAnswerSchema>;
/** A question with buttons (`--human-questions-file`). */
export const HumanQuestionSchema = z.object({
  id: z.string(), question: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), recommended: z.boolean() })),
  answer: HumanQuestionAnswerSchema.nullable()
});
/** A team Max proposes for a goal (the ```ledge-team``` block of his ask, docs/vision/ledge-goal-contract.md). */
export const TeamProposalSchema = z.object({
  /** `existing`: the goal goes to a team that exists; `launch`: a new rig is launched, with what that does in `launch`. */
  kind: z.enum(['existing', 'launch']),
  rig: z.string(), running: z.boolean().nullable(), folder: z.string().nullable(),
  seats: z.array(z.object({ seat: z.string(), name: z.string().nullable(), role: z.string().nullable(), note: z.string().nullable() })),
  reason: z.string().nullable(),
  /** For a launch, before any yes: agents, runtimes, `rig up --plan`'s summary, what it writes in the folder, the seats' permissions. */
  launch: z.object({ agents: z.number().int().nullable(), runtimes: z.array(z.string()), plan: z.string().nullable(), writes: z.array(z.string()), permissions: z.string().nullable() }).nullable()
});
export type TeamProposal = z.infer<typeof TeamProposalSchema>;

/** One open OpenRig row for the person. `decision`: an ask addressed to them; `update`: a piece of news, closed by « Vu »;
 *  `parked`: a seat's own row blocked on them, settled with their words. `from.seat`: who asked (the parked row's owner). */
export const HumanAskSchema = z.object({
  id: z.string(), kind: z.enum(['decision', 'update', 'parked']), alert: z.boolean(), priority: z.enum(['routine', 'urgent', 'critical']),
  from: z.object({ seat: z.string(), rig: z.string().nullable(), role: z.string().nullable() }),
  summary: z.string(), body: z.string(), bodyTruncated: z.boolean(), detail: z.string().nullable(),
  /** The detail was cut (on the phone, to fit its message): its end, which may decide, is not shown. */ detailTruncated: z.literal(true).optional(),
  evidenceRef: z.string().nullable(),
  questions: z.array(HumanQuestionSchema), createdAt: z.string(), updatedAt: z.string(),
  /** Max's proposal for this goal (the ask's `ledge-goal:<id>` tag), and the team it names when its block reads. */
  goalId: z.string().optional(), team: TeamProposalSchema.optional()
});
export type HumanAsk = z.infer<typeof HumanAskSchema>;

/** Whether the rigs can reach the person through Ledge: `ready` OpenRig runs and a person is registered; `no_person` none is (Ledge is
 *  not OpenRig's human channel yet); `openrig_stopped`; `not_installed`; `unreachable` its daemon runs but its API does not answer. */
export const HumanChannelSchema = z.object({
  /** `no_default`: several people are registered and none is the default, so whose asks they are is unknown (nothing is shown). */
  state: z.enum(['ready', 'no_person', 'no_default', 'openrig_stopped', 'not_installed', 'unreachable']),
  person: z.object({ address: z.string(), name: z.string() }).nullable(),
  /** Slack still posts the person's asks too. */ slack: z.boolean(),
  message: z.string().optional()
});
export type HumanChannel = z.infer<typeof HumanChannelSchema>;

/** A front asks a machine for what waits on the person. */
export const OpenRigAsksSchema = z.object({ type: z.literal('openrig.asks'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
/** What waits on the person, whole: the answer to `openrig.asks` (`requestId`), or pushed to every front when it changes. `error`: the
 *  fleet's `offline` / `outdated`, and then nothing else is known. */
export const OpenRigAsksChangedSchema = z.object({
  type: z.literal('openrig.asksChanged'), requestId: z.string().optional(), machineId: z.string().optional(),
  channel: HumanChannelSchema.optional(), asks: z.array(HumanAskSchema), truncated: z.boolean().optional(),
  /** A read failed (OpenRig unreachable, a row or a source not read): the asks known before are kept; none missing is settled. */
  partial: z.boolean().optional(),
  error: z.enum(['offline', 'outdated']).optional()
});

/** The person's answer: a button (`choice`, once per question), their words on an ask (`words`), « Vu » on a piece of news (`seen`),
 *  or their decision on a row parked on them (`resolve`). */
export const HumanAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), questionId: z.string().min(1).max(200), optionId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('words'), text: z.string().trim().min(1).max(8000) }),
  z.object({ kind: z.literal('seen') }),
  z.object({ kind: z.literal('resolve'), text: z.string().trim().min(1).max(8000) })
]);
export type HumanAnswer = z.infer<typeof HumanAnswerSchema>;
export const OpenRigAnswerSchema = z.object({
  type: z.literal('openrig.answer'), requestId: z.string().min(1).max(100), machineId: z.string().optional(),
  qitemId: z.string().min(1).max(200), answer: HumanAnswerSchema
});
/** Why an answer was not taken. `closed`: the row is already closed (drop it, no retry); `not_closed`: the answer went back but the
 *  row changed meanwhile (retry is safe); `refused`: OpenRig refused it (`message` says why); `unreachable` / `openrig_stopped`: not
 *  sent, retry; `uncertain`: it may have gone (OpenRig's answer was lost or unreadable): sending it again is safe and says what became
 *  of it; `offline` / `outdated`: the fleet's. */
export const HumanAnswerErrorSchema = z.enum(['not_found', 'closed', 'refused', 'not_closed', 'unreachable', 'openrig_stopped', 'uncertain', 'offline', 'outdated']);
export type HumanAnswerError = z.infer<typeof HumanAnswerErrorSchema>;
/** An answer's end. `recorded`: a choice kept, other questions wait (`remaining`, their ids; absent when they could not be told); `answered`: returned to the seat as `replyId`, which
 *  is woken, and the row closed; `already`: answered before, nothing new went. Retrying is sending the same answer again. */
export const OpenRigAnsweredSchema = z.object({
  type: z.literal('openrig.answered'), requestId: z.string(), machineId: z.string().optional(), qitemId: z.string(), ok: z.boolean(),
  outcome: z.enum(['recorded', 'answered', 'already']).optional(), remaining: z.array(z.string()).optional(), replyId: z.string().optional(),
  error: HumanAnswerErrorSchema.optional(), message: z.string().optional()
});
export type OpenRigAsks = z.infer<typeof OpenRigAsksSchema>;
export type OpenRigAsksChanged = z.infer<typeof OpenRigAsksChangedSchema>;
export type OpenRigAnswer = z.infer<typeof OpenRigAnswerSchema>;
export type OpenRigAnswered = z.infer<typeof OpenRigAnsweredSchema>;


// ── Lot 2 : the goal written to Ledge, Max proposes the team (docs/vision/ledge-goal-contract.md) ──

/** Why a goal (or a word to Max about it) did not go: `no_operator` there is no Max (the kernel does not run, or has no operator.agent);
 *  `uncertain` it may have gone (sending the same id again is safe); the others as for an answer. */
export const GoalErrorSchema = z.enum(['no_operator', 'openrig_stopped', 'unreachable', 'uncertain', 'refused', 'offline', 'outdated']);
export type GoalError = z.infer<typeof GoalErrorSchema>;
const GoalIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'not a goal id');

export const GoalSchema = z.object({
  goalId: z.string(), qitemId: z.string(), text: z.string(), folder: z.string().nullable(), sentAt: z.string(), to: z.string(),
  state: z.enum(['sent', 'taken', 'asking', 'proposed', 'running', 'done', 'closed']),
  /** The latest proposal: after « Changer d'équipe » Max makes a new one. */
  proposal: z.object({
    askId: z.string(), team: TeamProposalSchema.nullable(), text: z.string(),
    answer: HumanQuestionAnswerSchema.nullable(), answeredAt: z.string().nullable()
  }).nullable(),
  /** Max's question still open (no folder, no fitting team): it waits in « À toi ». */
  question: z.object({ askId: z.string(), text: z.string() }).nullable(),
  trail: z.array(z.object({
    at: z.string(), kind: z.enum(['sent', 'taken', 'note', 'handed', 'closed']), seat: z.string(),
    to: z.string().optional(), text: z.string().optional(), qitemId: z.string()
  })),
  current: z.object({ qitemId: z.string(), seat: z.string(), state: z.string() }).nullable()
});
export type Goal = z.infer<typeof GoalSchema>;

/** The person gives Ledge a goal, which goes to Max as a queue row. `goalId`: the front's, the same for a retry. */
export const OpenRigGoalSendSchema = z.object({
  type: z.literal('openrig.goal.send'), requestId: z.string().min(1).max(100), machineId: z.string().optional(),
  goalId: GoalIdSchema, text: z.string().trim().min(1).max(8000), folder: z.string().min(1).max(4096).optional()
});
export const OpenRigGoalSentSchema = z.object({
  type: z.literal('openrig.goal.sent'), requestId: z.string(), machineId: z.string().optional(), goalId: z.string(), ok: z.boolean(),
  qitemId: z.string().optional(), error: GoalErrorSchema.optional(), message: z.string().optional()
});
/** A front asks for the goals given to Max; the answer is also pushed when they change. */
export const OpenRigGoalsSchema = z.object({ type: z.literal('openrig.goals'), requestId: z.string().min(1).max(100), machineId: z.string().optional() });
export const OpenRigGoalsChangedSchema = z.object({
  type: z.literal('openrig.goalsChanged'), requestId: z.string().optional(), machineId: z.string().optional(),
  goals: z.array(GoalSchema), partial: z.boolean().optional(), error: z.enum(['offline', 'outdated']).optional()
});
/** The person writes to Max about a goal: a new row to him (a note would wake no one). `replyId`: the front's, the same for a retry. */
export const OpenRigGoalReplySchema = z.object({
  type: z.literal('openrig.goal.reply'), requestId: z.string().min(1).max(100), machineId: z.string().optional(),
  goalId: GoalIdSchema, replyId: GoalIdSchema, text: z.string().trim().min(1).max(8000)
});
export const OpenRigGoalRepliedSchema = z.object({
  type: z.literal('openrig.goal.replied'), requestId: z.string(), machineId: z.string().optional(), goalId: z.string(),
  /** The reply's own id, always: sending it again after `uncertain` reuses it, and never wakes Max twice. */ replyId: z.string(), ok: z.boolean(),
  qitemId: z.string().optional(), error: GoalErrorSchema.optional(), message: z.string().optional()
});
export type OpenRigGoalSend = z.infer<typeof OpenRigGoalSendSchema>;
export type OpenRigGoalSent = z.infer<typeof OpenRigGoalSentSchema>;
export type OpenRigGoalsChanged = z.infer<typeof OpenRigGoalsChangedSchema>;
export type OpenRigGoalReply = z.infer<typeof OpenRigGoalReplySchema>;
export type OpenRigGoalReplied = z.infer<typeof OpenRigGoalRepliedSchema>;
