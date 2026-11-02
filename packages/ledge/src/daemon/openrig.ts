import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { changesSpec, composeSpec, fragmentOf, linksFor, memberOf, readSpec, specSeats } from './rigSpec.js';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { KERNEL_RIG, rigCommands as planAction, showRigCommand as showCommand, type OpenRigAction, type OpenRigState, type Rig, type RigLaunch, type RigSeat, type RigSpec, roleOf, seatPlan, seatsByRole } from '@ledge/protocol';
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
/** How long the `rig --version` read stands before it is asked again. */
export const VERSION_TTL_MS = 5 * 60_000;

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
  const said = str(json.error) ?? str(obj(json.error).message) ?? str(json.message);
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

export interface OpenRigDeps {
  run?: RigRun; env?: () => Promise<NodeJS.ProcessEnv>; now?: () => number;
  /** Where Ledge writes the specs it composes (`~/.ledge/rigs`), one folder per rig. */ rigsDir?: string;
  /** The person's home, for a `~` in a launch's folder. */ home?: string;
  /** Files, for tests. */ fs?: { read(p: string): Promise<string>; exists(p: string): boolean; copyDir(from: string, to: string): Promise<void>; write(p: string, text: string): Promise<void> };
}
export interface LaunchResult { ok: boolean; plan: boolean; commands: string[]; yaml?: string; seats?: number; output?: string; error?: string; check?: { status: string; errors: string[]; warnings: string[] } }

/** What `rig up --plan --json` concluded, from its JSON: status, errors, warnings (each as text, 30 at most). */
export function readCheck(output: string): { status: string; errors: string[]; warnings: string[] } | undefined {
  const j = obj(parse(output));
  const status = str(j.status);
  if (!status) return undefined;
  const texts = (v: unknown) => (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x : str(obj(x).message) ?? JSON.stringify(x))).slice(0, 30);
  return { status, errors: texts(j.errors), warnings: texts(j.warnings) };
}
export interface ActResult { ok: boolean; commands: string[]; output?: string; error?: string }
export interface OpenRig {
  /** This machine's OpenRig, read again unless a read is under `STATE_TTL_MS` old (`fresh` forces it). */
  state(fresh?: boolean): Promise<OpenRigState>;
  act(action: OpenRigAction): Promise<ActResult>;
  /** The machine's rig specs (the kernel's left out). */
  specs(): Promise<{ specs: RigSpec[]; error?: string }>;
  /** Checks (`plan`) or launches a rig from a spec, composed when the counts, harnesses or models change. */
  launch(l: RigLaunch): Promise<LaunchResult>;
  /** Brings a running rig's roles to `seats` (role -> count): copies of each role's first seat added, the last copies removed,
   *  the spec's links ensured where this OpenRig can, then a snapshot so a restart keeps the new size. */
  reseat(rig: string, seats: Record<string, number>, delegation?: 'pairs' | 'all'): Promise<ReseatResult>;
}
export interface ReseatResult { ok: boolean; commands: string[]; added: string[]; removed: string[]; output?: string; error?: string; links?: number; linksUnsupported?: boolean }

const realFs = {
  read: (p: string) => readFile(p, 'utf8'),
  exists: (p: string) => existsSync(p),
  copyDir: (from: string, to: string) => cp(from, to, { recursive: true, force: true, filter: src => basename(src) !== 'rig.yaml' }),
  write: async (p: string, text: string) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, text); }
};

export function createOpenRig(deps: OpenRigDeps = {}): OpenRig {
  const run = deps.run ?? execRun(deps.env ?? (async () => process.env));
  const files = deps.fs ?? realFs;
  const home = deps.home ?? homedir();
  const rigsDir = deps.rigsDir ?? join(home, '.ledge', 'rigs');
  const now = deps.now ?? Date.now;
  let version: string | undefined, versionAt = 0, last: { at: number; state: OpenRigState } | undefined;
  let reading: Promise<OpenRigState> | undefined, acting = false;
  const absent = (): OpenRigState => ({ installed: false, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: new Date(now()).toISOString() });

  async function read(): Promise<OpenRigState> {
    const at = new Date(now()).toISOString();
    const status = await run(['status', '--json'], STATUS_MS);
    if (status.code === null) { version = undefined; return absent(); }
    // Read again now and then: an OpenRig upgraded under a running Ledge shows its new version and features.
    if (!version || now() - versionAt > VERSION_TTL_MS) { const v = await run(['--version'], STATUS_MS); version = v.code === 0 ? v.stdout.trim().split(/\s+/)[0] || undefined : undefined; versionAt = now(); }
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

  /** What this `rig` can do, read once from its help: `rig up --name` and `rig edge` came with 0.7. */
  let can: { for: string; name: boolean; edge: boolean } | undefined;
  async function features(): Promise<{ name: boolean; edge: boolean }> {
    if (can && can.for === (version ?? '')) return can;
    if (!version) { const v = await run(['--version'], STATUS_MS); version = v.code === 0 ? v.stdout.trim().split(/\s+/)[0] || undefined : undefined; }
    const [up, all] = await Promise.all([run(['up', '--help'], STATUS_MS), run(['help'], STATUS_MS)]);
    can = { for: version ?? '', name: /--name\b/.test(up.stdout), edge: /^\s+edge\b/m.test(`${all.stdout}${all.stderr}`) };
    return can;
  }

  async function specs(): Promise<{ specs: RigSpec[]; error?: string }> {
    const r = await run(['specs', 'ls', '--json'], STATUS_MS);
    if (r.code === null) return { specs: [], error: 'not_installed' };
    if (r.code !== 0) return { specs: [], error: /daemon not running/i.test(`${r.stdout}${r.stderr}`) ? 'daemon_stopped' : failure(r) };
    const listed = parse(r.stdout);
    const out: RigSpec[] = [];
    for (const raw of Array.isArray(listed) ? listed : []) {
      const e = obj(raw), name = str(e.name), path = str(e.resolvedSourcePath) ?? str(e.sourcePath);
      if (e.kind !== 'rig' || !name || !path || name === KERNEL_RIG) continue;
      const text = await files.read(path).catch(() => null);
      const spec = text === null ? null : readSpec(text, { name, source: str(e.sourceType) ?? 'unknown', path, ...(str(e.summary) ? { summary: str(e.summary)!.trim() } : {}) });
      if (spec) out.push(spec);
    }
    return { specs: out.sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'user' ? -1 : 1)) };
  }

  async function launch(l: RigLaunch): Promise<LaunchResult> {
    const plan = l.plan === true;
    if (acting) return { ok: false, plan, commands: [], error: 'busy' };
    acting = true;
    try {
      const cwd = l.cwd === '~' ? home : l.cwd.startsWith('~/') ? join(home, l.cwd.slice(2)) : l.cwd;
      if (!isAbsolute(cwd) || !files.exists(cwd)) return { ok: false, plan, commands: [], error: 'cwd_missing' };
      const listed = await specs();
      if (listed.error) return { ok: false, plan, commands: [], error: listed.error };
      const spec = listed.specs.find(s => s.name === l.spec);
      if (!spec) return { ok: false, plan, commands: [], error: 'spec_not_found' };
      let source = spec.name, yaml: string, seats: number, dir: string | undefined;
      const text = await files.read(spec.path);
      const can = await features();
      // Before 0.7 OpenRig named a rig after its spec's `name:` only (no `rig up --name`): another name was a composed copy too.
      const rename = l.name !== spec.name;
      if (changesSpec(l) || l.save || (rename && !can.name)) {
        const composed = composeSpec(parseYaml(text), dirname(spec.path), l);
        dir = join(rigsDir, l.name);
        await files.copyDir(dirname(spec.path), dir);
        await files.write(join(dir, 'rig.yaml'), composed.yaml);
        source = join(dir, 'rig.yaml'); yaml = composed.yaml; seats = composed.seats;
      } else { yaml = text; seats = specSeats(spec); }
      if (!dir && rename && !plan) await files.write(join(rigsDir, l.name, 'source.json'), JSON.stringify({ spec: spec.name, path: spec.path }));
      const commands: string[][] = [['up', source, ...(!dir && rename ? ['--name', l.name] : []), '--cwd', cwd, ...(l.nonInterruptive ? ['--non-interruptive'] : []), ...(plan ? ['--plan'] : ['--yes']), '--json']];
      if (!plan && l.save && dir) commands.push(['specs', 'add', dir, '--json']);
      const shown = commands.map(showCommand);
      let output = '';
      for (const args of commands) {
        const r = await run(args, plan ? STATUS_MS * 4 : ACTION_MS.up!);
        if (r.code === null) return { ok: false, plan, commands: shown, yaml, seats, error: 'not_installed' };
        output = `${r.stdout}${r.stderr}`.trim().slice(-4000);
        if (r.code !== 0) { const error = failure(r); log(`openrig: ${showCommand(args)} failed: ${error}`); return { ok: false, plan, commands: shown, yaml, seats, output, error }; }
      }
      log(`openrig: ${shown.join(' && ')}`);
      const check = plan ? readCheck(output) : undefined;
      return { ok: true, plan, commands: shown, yaml, seats, ...(output ? { output } : {}), ...(check ? { check } : {}) };
    } finally {
      acting = false;
      if (!plan) last = undefined;
    }
  }

  /** The folder a rig's `local:` agents are relative to: the spec Ledge composed for it, the library spec it launched under
   *  another name, or the library spec of its name; null when none is known. */
  async function rootOf(rig: string): Promise<string | null> {
    const mine = join(rigsDir, rig);
    if (files.exists(join(mine, 'rig.yaml'))) return mine;
    const marker = await files.read(join(mine, 'source.json')).catch(() => null);
    const path = marker === null ? undefined : str(obj(parse(marker)).path);
    if (path) return dirname(path);
    const listed = await specs();
    const spec = listed.specs.find(s => s.name === rig);
    return spec ? dirname(spec.path) : null;
  }

  async function reseat(rigName: string, seats: Record<string, number>, delegation: 'pairs' | 'all' = 'pairs'): Promise<ReseatResult> {
    const none = { added: [] as string[], removed: [] as string[] };
    const st = await state(true);
    const rig = st.rigs.find(r => r.name === rigName);
    if (!rig || (rig.status !== 'running' && rig.status !== 'partial' && rig.running === 0)) return { ok: false, commands: [], ...none, error: 'rig_not_running' };
    const plan = seatPlan(rig.nodes, seats);
    if (plan.add.length === 0 && plan.remove.length === 0) return { ok: true, commands: [], ...none };
    if (acting) return { ok: false, commands: [], ...none, error: 'busy' };
    acting = true;
    try {
      const can = await features();
      const commands: string[][] = [];
      let show: unknown;
      if (plan.add.length) {
        const r = await run(['spec', 'show', rig.id, '--json'], STATUS_MS);
        if (r.code === null) return { ok: false, commands: [], ...none, error: 'not_installed' };
        if (r.code !== 0) return { ok: false, commands: [], ...none, error: failure(r) };
        show = parse(r.stdout);
        const root = await rootOf(rigName);
        for (const a of plan.add) {
          const member = memberOf(show, a.pod, a.from.slice(a.pod.length + 1));
          const fragment = member ? fragmentOf(member, a.id, root) : null;
          if (!fragment) return { ok: false, commands: [], ...none, error: 'rig_root_unknown' };
          const path = join(rigsDir, rigName, 'seats', `${a.pod}.${a.id}.json`);
          await files.write(path, JSON.stringify(fragment, null, 2));
          commands.push(['add', rig.id, a.pod, path, ...(root ? ['--rig-root', root] : []), '--json']);
        }
      }
      for (const id of plan.remove) commands.push(['remove', rig.id, id, '--json']);
      // The links of the roles that grew, between the seats they will have: `rig edge add` leaves one already there unchanged.
      let links = 0;
      if (plan.add.length && can.edge) {
        const after = seatsByRole([...rig.nodes.filter(n => !plan.remove.includes(n.logicalId)).map(n => ({ logicalId: n.logicalId })), ...plan.add.map(a => ({ logicalId: `${a.pod}.${a.id}` }))]);
        for (const l of linksFor(show, after, new Set(plan.add.map(a => a.role)), delegation)) { commands.push(['edge', 'add', rig.id, l.from, l.to, '--kind', l.kind, '--json']); links++; }
      }
      commands.push(['snapshot', rig.id]);
      const shown = commands.map(showCommand);
      const added = plan.add.map(a => `${a.pod}.${a.id}`), removed = plan.remove;
      let output = '';
      for (const args of commands) {
        const r = await run(args, args[0] === 'add' ? ACTION_MS.up! : ACTION_MS.down!);
        if (r.code === null) return { ok: false, commands: shown, added, removed, error: 'not_installed' };
        output = `${r.stdout}${r.stderr}`.trim().slice(-2000);
        if (r.code !== 0) { const error = failure(r); log(`openrig: ${showCommand(args)} failed: ${error}`); return { ok: false, commands: shown, added, removed, output, error }; }
      }
      log(`openrig: ${rigName} reseated (+${added.length} -${removed.length}, ${links} links)`);
      return { ok: true, commands: shown, added, removed, ...(output ? { output } : {}), ...(plan.add.length ? (can.edge ? { links } : { linksUnsupported: true }) : {}) };
    } finally {
      acting = false;
      last = undefined;
    }
  }

  return { state, act, specs, launch, reseat };
}
