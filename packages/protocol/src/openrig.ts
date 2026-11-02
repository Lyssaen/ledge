import { z } from 'zod';

/**
 * OpenRig on a machine (mvschwarz/openrig): its daemon, its kernel (the rig named `kernel`, whose operator helps start a
 * team) and its rigs, read from `rig status --json` and `rig ps --json` by that machine's Ledge daemon, and driven by the
 * `rig` commands it runs there. Design: docs/mockups/ledge-openrig.html.
 */

/** A rig's name as `rig up` / `rig down` take it: never a leading `-`, which `rig` would read as a flag. */
export const RigNameSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'not a rig name');

/** The kernel's own rig, which OpenRig starts with its daemon unless told `--no-kernel`. */
export const KERNEL_RIG = 'kernel';

/** A seat of a rig, as `rig ps --nodes --json` reports it. `activity`: `agentActivity.state` (running, idle, unknown…). */
export const RigSeatSchema = z.object({
  logicalId: z.string(), session: z.string(), runtime: z.string(), model: z.string().nullable(),
  sessionStatus: z.string(), lifecycleState: z.string(), activity: z.string(),
  stopped: z.boolean(), work: z.number().int().min(0)
});
export type RigSeat = z.infer<typeof RigSeatSchema>;

/** A rig of the machine. `status`: running, stopped, partial… as OpenRig says; `uptime` and `snapshot` are its own words. */
export const RigSchema = z.object({
  id: z.string(), name: z.string(), status: z.string(), lifecycleState: z.string(),
  seats: z.number().int().min(0), running: z.number().int().min(0), attention: z.number().int().min(0),
  uptime: z.string().nullable(), snapshot: z.string().nullable(), nodes: z.array(RigSeatSchema)
});
export type Rig = z.infer<typeof RigSchema>;

export const RigDaemonStateSchema = z.enum(['running', 'stopped', 'stale', 'unknown']);
/** The kernel: `ready` its rig runs, `stopped` it does not, `skipped` the daemon was started without it, `absent` no such rig. */
export const RigKernelStateSchema = z.enum(['ready', 'starting', 'stopped', 'skipped', 'absent', 'unknown']);

/** OpenRig on one machine. `installed` false: no `rig` command there, and nothing else is known. */
export const OpenRigStateSchema = z.object({
  installed: z.boolean(), version: z.string().optional(),
  daemon: z.object({ state: RigDaemonStateSchema, pid: z.number().int().optional(), port: z.number().int().optional(), message: z.string().optional() }),
  kernel: z.object({ state: RigKernelStateSchema }),
  rigs: z.array(RigSchema),
  /** When it was read (ISO). */ at: z.string()
});
export type OpenRigState = z.infer<typeof OpenRigStateSchema>;

/** What Ledge can do to OpenRig on a machine. The rig ones name it in `rig`. */
export const OpenRigActionSchema = z.discriminatedUnion('kind', [
  /** `restore` `last`: `rig start --last` (the rigs that were running come back); `none`: `rig daemon start`. */
  z.object({ kind: z.literal('daemon.start'), restore: z.enum(['last', 'none']).optional(), noKernel: z.boolean().optional() }),
  z.object({ kind: z.literal('daemon.stop') }),
  z.object({ kind: z.literal('daemon.restart'), restore: z.enum(['last', 'none']).optional() }),
  z.object({ kind: z.literal('kernel.start') }),
  z.object({ kind: z.literal('kernel.stop') }),
  z.object({ kind: z.literal('kernel.restart') }),
  z.object({ kind: z.literal('rig.start'), rig: RigNameSchema }),
  z.object({ kind: z.literal('rig.stop'), rig: RigNameSchema, snapshot: z.boolean().optional(), force: z.boolean().optional(), delete: z.boolean().optional() }),
  z.object({ kind: z.literal('rig.restart'), rig: RigNameSchema })
]);
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
  commands: z.array(z.string()), output: z.string().optional(), error: z.string().optional()
});
export type OpenRigStatus = z.infer<typeof OpenRigStatusSchema>;
export type OpenRigAct = z.infer<typeof OpenRigActSchema>;
export type OpenRigStateMessage = z.infer<typeof OpenRigStateMessageSchema>;
export type OpenRigDone = z.infer<typeof OpenRigDoneSchema>;

/** The `rig` commands an action runs, in order; the first that fails stops the rest. */
export function rigCommands(a: OpenRigAction): string[][] {
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
    case 'rig.start': return [up(a.rig)];
    case 'rig.stop': return [down(a.rig, a)];
    case 'rig.restart': return [down(a.rig, { snapshot: true }), up(a.rig)];
  }
}

/** How a command reads in a front: `rig down starter --snapshot`, without the `--json` Ledge adds for itself. */
export const showRigCommand = (args: string[]): string => ['rig', ...args.filter(x => x !== '--json')].join(' ');


// ── Lot 2: launching a rig (docs/mockups/ledge-openrig.html, view 6) ──

/** A seat of a spec, as the launch form shows it: its role (`pod.member`), its harness, its model when the spec sets one, the agent it runs. */
export const RigSpecMemberSchema = z.object({ id: z.string(), runtime: z.string(), model: z.string().optional(), agent: z.string() });
export const RigSpecPodSchema = z.object({ id: z.string(), label: z.string().optional(), members: z.array(RigSpecMemberSchema) });
/** A rig spec of the machine's library: `source` `builtin` (shipped with OpenRig) or `user` (the person's own). */
export const RigSpecSchema = z.object({
  name: z.string(), source: z.string(), summary: z.string().optional(), path: z.string(),
  pods: z.array(RigSpecPodSchema), edges: z.number().int().min(0)
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
  delegation: z.enum(['pairs', 'all']).optional(), save: z.boolean().optional(), plan: z.boolean().optional()
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
