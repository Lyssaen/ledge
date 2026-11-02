import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { KERNEL_RIG, rigCommands as planAction, showRigCommand as showCommand, type OpenRigAction, type OpenRigState, type Rig, type RigSeat } from '@ledge/protocol';
import { log } from '../log.js';

/**
 * OpenRig on this machine (docs/mockups/ledge-openrig.html): its state read from `rig status --json` and `rig ps --json`,
 * and the `rig` commands an action runs. Every command is `rig` with an argument list, never a shell; a rig's name was
 * checked by the protocol (no leading `-`). One action at a time: a second one is refused `busy`.
 */

/** Runs `rig args` without a shell; `code` null when `rig` could not start (not installed). Never throws. */
export type RigRun = (args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const STATUS_MS = 15_000;
/** How long one command of an action may take: starting a rig waits for its agents. */
const ACTION_MS: Record<string, number> = { start: 120_000, up: 300_000, down: 120_000, stop: 60_000 };
/** A state read this recently is answered again, so several fronts polling do not each run `rig`. */
export const STATE_TTL_MS = 2_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

/** One seat of `rig ps --nodes --json`. */
export function toSeat(raw: unknown): RigSeat | null {
  const n = obj(raw);
  const logicalId = str(n.logicalId), session = str(n.canonicalSessionName);
  if (!logicalId || !session) return null;
  return {
    logicalId, session, runtime: str(n.runtime) ?? 'unknown', model: str(n.model),
    sessionStatus: str(n.sessionStatus) ?? 'unknown', lifecycleState: str(n.lifecycleState) ?? 'unknown',
    activity: str(obj(n.agentActivity).state) ?? 'unknown', stopped: n.intentionallyStopped === true,
    work: int(n.assignedWorkCount)
  };
}

/**
 * The machine's OpenRig from what `rig` printed: `status` (`rig status --json`), `rigs` (`rig ps --json`, a bare array)
 * and `nodes` (`rig ps --nodes -A --json`), the last two only while the daemon runs. Unknown fields are ignored, missing
 * ones read as nothing: OpenRig's JSON grows between versions.
 */
export function readState(input: { status: unknown; rigs?: unknown; nodes?: unknown; version?: string; at: string }): OpenRigState {
  const status = obj(input.status), daemon = obj(status.daemon);
  const raw = str(daemon.state);
  const state = raw === 'running' || raw === 'stopped' || raw === 'stale' ? raw : 'unknown';
  const running = state === 'running' && daemon.reachable !== false;
  const seats = new Map<string, RigSeat[]>();
  for (const n of Array.isArray(input.nodes) ? input.nodes : []) {
    const seat = toSeat(n), rigId = str(obj(n).rigId);
    if (seat && rigId) seats.set(rigId, [...(seats.get(rigId) ?? []), seat]);
  }
  const rigs: Rig[] = [];
  for (const r of running && Array.isArray(input.rigs) ? input.rigs : []) {
    const o = obj(r), id = str(o.rigId), name = str(o.name) ?? str(o.rigName);
    if (!id || !name || o.isArchived === true) continue;
    rigs.push({
      id, name, status: str(o.status) ?? 'unknown', lifecycleState: str(o.lifecycleState) ?? 'unknown',
      seats: int(o.nodeCount), running: int(o.runningCount), attention: int(o.attentionCount),
      uptime: str(o.uptime), snapshot: str(o.latestSnapshot), nodes: seats.get(id) ?? []
    });
  }
  const kernelRig = rigs.find(r => r.name === KERNEL_RIG);
  const told = str(obj(status.kernel).state);
  const kernel: OpenRigState['kernel']['state'] = !running ? 'stopped'
    : kernelRig?.status === 'running' ? 'ready'
    : told === 'skipped' ? 'skipped'
    : kernelRig && kernelRig.running > 0 ? 'starting'
    : kernelRig ? 'stopped' : 'absent';
  const pid = typeof daemon.pid === 'number' ? daemon.pid : undefined, port = typeof daemon.port === 'number' ? daemon.port : undefined;
  const message = str(daemon.message);
  return {
    installed: true, ...(input.version ? { version: input.version } : {}),
    daemon: { state, ...(running && pid !== undefined ? { pid } : {}), ...(running && port !== undefined ? { port } : {}), ...(!running && message ? { message } : {}) },
    kernel: { state: kernel }, rigs: rigs.sort((a, b) => (a.name === KERNEL_RIG ? 1 : b.name === KERNEL_RIG ? -1 : a.name.localeCompare(b.name))), at: input.at
  };
}

export { planAction, showCommand };

/** The line that says why a command failed: the last one it printed, an error field of its JSON, or its exit code. */
export function failure(r: { code: number | null; stdout: string; stderr: string }): string {
  const json = obj(parse(r.stdout.trim()));
  const said = str(json.error) ?? str(json.message);
  if (said) return said.slice(0, 300);
  const lines = `${r.stderr}\n${r.stdout}`.split('\n').map(l => l.trim()).filter(Boolean);
  return (lines.at(-1) ?? `exit ${r.code}`).slice(0, 300);
}

/** `v26.7.0` before `v22.1.0`: the newest Node first. */
const byVersionDesc = (a: string, b: string): number => {
  const v = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const x = v(a), y = v(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

/**
 * Where `rig` is: on the PATH, else where a Node version manager put it. npm installs OpenRig with the Node that runs it,
 * and nvm (bash or fish) puts that Node on the PATH of interactive shells only: neither the daemon nor a login shell has it.
 * `rig` starts with `#!/usr/bin/env node`, so it runs with its folder first on the PATH, which holds the right Node.
 */
export function findRig(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync, list: (dir: string) => string[] = dir => { try { return readdirSync(dir); } catch { return []; } }): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) if (dir && exists(join(dir, 'rig'))) return dir;
  const home = env.HOME ?? homedir();
  const managed = (root: string, sub: string) => list(root).filter(v => /^v?\d/.test(v)).sort(byVersionDesc).map(v => join(root, v, sub));
  const candidates = [
    ...managed(join(home, '.local', 'share', 'nvm'), 'bin'), ...managed(join(env.NVM_DIR ?? join(home, '.nvm'), 'versions', 'node'), 'bin'),
    join(home, '.volta', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.local', 'share', 'pnpm')
  ];
  return candidates.find(dir => exists(join(dir, 'rig'))) ?? null;
}

const execRun = (env: () => Promise<NodeJS.ProcessEnv>): RigRun => async (args, timeoutMs) => {
  const base = await env(), dir = findRig(base);
  if (!dir) return { code: null, stdout: '', stderr: 'rig: command not found' };
  const e = { ...base, PATH: [dir, base.PATH].filter(Boolean).join(delimiter), NO_COLOR: '1', CLICOLOR: '0', FORCE_COLOR: '0' };
  return new Promise(res => {
    execFile(join(dir, 'rig'), args, { env: e, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = !err ? 0 : (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : typeof err.code === 'number' ? err.code : 1;
      res({ code, stdout: String(stdout), stderr: String(stderr) || (err && code !== 0 ? err.message : '') });
    });
  });
};

export interface OpenRigDeps { run?: RigRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => number }
export interface ActResult { ok: boolean; commands: string[]; output?: string; error?: string }
export interface OpenRig {
  /** This machine's OpenRig, read again unless a read is under `STATE_TTL_MS` old (`fresh` forces it). */
  state(fresh?: boolean): Promise<OpenRigState>;
  act(action: OpenRigAction): Promise<ActResult>;
}

export function createOpenRig(deps: OpenRigDeps = {}): OpenRig {
  const run = deps.run ?? execRun(deps.env ?? (async () => process.env));
  const now = deps.now ?? Date.now;
  let version: string | undefined, last: { at: number; state: OpenRigState } | undefined;
  let reading: Promise<OpenRigState> | undefined, acting = false;
  const absent = (): OpenRigState => ({ installed: false, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: new Date(now()).toISOString() });

  async function read(): Promise<OpenRigState> {
    const at = new Date(now()).toISOString();
    const status = await run(['status', '--json'], STATUS_MS);
    if (status.code === null) { version = undefined; return absent(); }
    if (!version) { const v = await run(['--version'], STATUS_MS); version = v.code === 0 ? v.stdout.trim().split(/\s+/)[0] || undefined : undefined; }
    const parsed = parse(status.stdout);
    if (parsed === undefined) log(`openrig: rig status printed no JSON (${failure(status)})`);
    const daemon = obj(obj(parsed).daemon);
    if (daemon.state !== 'running' || daemon.reachable === false) return readState({ status: parsed, version, at });
    const [rigs, nodes] = await Promise.all([run(['ps', '--json'], STATUS_MS), run(['ps', '--nodes', '-A', '--json'], STATUS_MS)]);
    return readState({ status: parsed, rigs: parse(rigs.stdout), nodes: parse(nodes.stdout), version, at });
  }

  function state(fresh = false): Promise<OpenRigState> {
    if (!fresh && last && now() - last.at < STATE_TTL_MS) return Promise.resolve(last.state);
    if (reading) return reading;
    reading = read().then(s => { last = { at: now(), state: s }; return s; }).finally(() => { reading = undefined; });
    return reading;
  }

  async function act(action: OpenRigAction): Promise<ActResult> {
    const plan = planAction(action), commands = plan.map(showCommand);
    if (acting) return { ok: false, commands, error: 'busy' };
    acting = true;
    try {
      let output = '';
      for (const args of plan) {
        const verb = args[0] === 'daemon' ? args[1]! : args[0]!;
        const r = await run(args, ACTION_MS[verb] ?? 120_000);
        if (r.code === null) return { ok: false, commands, error: 'not_installed' };
        output = `${r.stdout}${r.stderr}`.trim().slice(-2000);
        if (r.code !== 0) { const error = failure(r); log(`openrig: ${showCommand(args)} failed: ${error}`); return { ok: false, commands, output, error }; }
      }
      log(`openrig: ${commands.join(' && ')}`);
      return { ok: true, commands, ...(output ? { output } : {}) };
    } finally {
      acting = false;
      last = undefined;
    }
  }

  return { state, act };
}
