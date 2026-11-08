import { execFile } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdir, open as openFile, readFile, stat as statFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { changesSpec, composeSpec, fragmentOf, linksFor, memberOf, readSpec, specSeats } from './rigSpec.js';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { KERNEL_RIG, QitemIdSchema, RIG_ROW_REFRESH_MS, ROLE_FILE_MAX, type RigRow, type RoleDetail, type RoleSummary, rigCommands as planAction, showRigCommand as showCommand, type OpenRigAction, type OpenRigState, type Rig, type RigGraph, type RigGraphSeat, type RigSnapshot, RIG_SNAPSHOTS_MAX, type RigLink, type RigLaunch, type RigSeat, type RigSpec, roleOf, seatPlan, seatsByRole } from '@ledge/protocol';
import { log } from '../log.js';
import { buildDetail, declaredPlugins, parseSpec, readLibrary, readPlugin, resolveImports, rigMembers, seatCounts, summarize, writtenMember, type KnownSeat, type LibraryEntry, type PluginInfo, type RoleIo } from './openrigRoles.js';

/**
 * OpenRig on this machine (docs/mockups/ledge-openrig.html): its state read from `rig status --json` and `rig ps --json`,
 * and the `rig` commands an action runs. Every command is `rig` with an argument list, never a shell; a rig's name was
 * checked by the protocol (no leading `-`). One action at a time: a second one is refused `busy`.
 */

/** Runs `rig args` without a shell; `code` null when `rig` could not start (not installed). Never throws. */
export type RigRun = (args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const STATUS_MS = 15_000;
/** How long one command of an action may take: starting a rig waits for its agents. */
const ACTION_MS: Record<string, number> = { start: 120_000, up: 300_000, restore: 300_000, snapshot: 120_000, down: 120_000, stop: 60_000, seat: 240_000 };
/** A state read this recently is answered again, so several fronts polling do not each run `rig`. */
export const STATE_TTL_MS = 2_000;
/** How long the `rig --version` read stands before it is asked again. */
export const VERSION_TTL_MS = 5 * 60_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };

/** Where a spec of `rig specs ls` comes from, as the fronts read it: `builtin` shipped with OpenRig (`builtin`, `builtin_*`), every
 *  other kind the person's own (`user`; OpenRig 0.7.7 says `user_file`). The fronts know these two only, and a new kind is more
 *  likely the person's file than a shipped spec. */
export function specSource(raw: unknown): 'user' | 'builtin' {
  const s = str(raw);
  return s === 'builtin' || s?.startsWith('builtin_') ? 'builtin' : 'user';
}

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

export const execRun = (env: () => Promise<NodeJS.ProcessEnv>): RigRun => async (args, timeoutMs) => {
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
  /** Files the roles are read from, for tests. */ roleIo?: RoleIo & { head(p: string, max: number): Promise<string | null> };
  /** A GET on the OpenRig daemon's HTTP API (its node detail has no CLI); undefined when it does not answer. */ http?: (path: string) => Promise<unknown>;
  /** OpenRig's home (`$OPENRIG_HOME`, `~/.openrig`). */ openrigHome?: string;
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
  /** The machine's roles (agent specs), read-only. */
  roles(): Promise<RolesResult>;
  /** One role by library id: from its spec and from each seat that runs it. */
  role(id: string): Promise<RoleResult>;
  /** A file of a role: only a path its detail lists (`not_allowed` otherwise), `ROLE_FILE_MAX` bytes at most. */
  roleFile(id: string, path: string): Promise<RoleFileResult>;
  /** A queue row's state (`rig queue show <id> --json`), for the OpenRig task cards of a thread: reused under `ROW_TTL_MS`,
   *  one read at a time per row. `error`: `not_found`, `not_installed`, `daemon_stopped`, or what `rig` said. */
  row(qitem: string): Promise<{ row?: RigRow; error?: string }>;
  /** A rig's topology (pods, seats, links), running or stopped, by rig name: from the daemon's `/graph`, else from `rig spec show`
   *  (no state, no context). Reused under `SEATS_TTL_MS`. `error`: `unknown_rig`, `not_installed`, `daemon_stopped`, or what `rig` said. */
  graph(rig: string): Promise<{ graph?: RigGraph; error?: string }>;
  /** A rig's snapshots by rig name, newest first, `RIG_SNAPSHOTS_MAX` at most, never their `data`: from the daemon's `/snapshots`, else
   *  from the text of `rig snapshot list`. Read at each ask (no cache: a snapshot just taken shows). Same `error`s as `graph`. */
  snapshots(rig: string): Promise<{ snapshots?: RigSnapshot[]; error?: string }>;
}
export interface RolesResult { roles: RoleSummary[]; openrigVersion?: string; error?: string }
export interface RoleResult { role?: RoleDetail; error?: string }
export interface RoleFileResult { content?: string; size?: number; truncated?: boolean; error?: string }
export interface ReseatResult { ok: boolean; commands: string[]; added: string[]; removed: string[]; output?: string; error?: string; links?: number; linksUnsupported?: boolean }

const realRoleIo = {
  read: (p: string) => readFile(p, 'utf8').catch(() => null),
  stat: (p: string) => statFile(p).then(st => ({ size: st.size, mtimeMs: st.mtimeMs, file: st.isFile() })).catch(() => null),
  head: async (p: string, max: number): Promise<string | null> => {
    const h = await openFile(p, 'r').catch(() => null);
    if (!h) return null;
    try { const buf = Buffer.alloc(max); const { bytesRead } = await h.read(buf, 0, max, 0); return buf.subarray(0, bytesRead).toString('utf8'); } finally { await h.close(); }
  }
};

/** A JSON GET on this machine's OpenRig daemon, through node:http: never through an `http_proxy` (Node's fetch takes one
 *  with `NODE_USE_ENV_PROXY`, and a corporate proxy cannot reach 127.0.0.1). Undefined when it does not answer JSON. */
export function localGet(port: number, path: string, timeoutMs: number): Promise<unknown> {
  return new Promise(resolve => {
    const req = httpGet({ host: '127.0.0.1', port, path, timeout: timeoutMs, agent: false }, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(undefined); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(parse(Buffer.concat(chunks).toString('utf8'))));
      res.on('error', () => resolve(undefined));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
  });
}

/** How long a read of the rigs' members, and the files a role detail listed, are reused. */
const SEATS_TTL_MS = 5_000;
const FILES_TTL_MS = 5 * 60_000;
const HTTP_MS = 3_000;

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
  const roleIo = deps.roleIo ?? realRoleIo;
  const openrigHome = deps.openrigHome ?? process.env.OPENRIG_HOME ?? join(home, '.openrig');
  const http = deps.http ?? (async (path: string) => {
    const port = (await state()).daemon.port;
    if (!port) return undefined;
    return localGet(port, path, HTTP_MS);
  });
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
      const spec = text === null ? null : readSpec(text, { name, source: specSource(e.sourceType), path, ...(str(e.summary) ? { summary: str(e.summary)!.trim() } : {}) });
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

  // ── Roles (docs/superpowers/specs/2026-11-02-openrig-roles-data.md) ──

  async function library(): Promise<{ entries: LibraryEntry[]; error?: string }> {
    const r = await run(['specs', 'ls', '--kind', 'agent', '--json'], STATUS_MS);
    if (r.code === null) return { entries: [], error: 'not_installed' };
    if (r.code !== 0) return { entries: [], error: /daemon not running/i.test(`${r.stdout}${r.stderr}`) ? 'daemon_stopped' : failure(r) };
    return { entries: readLibrary(parse(r.stdout)) };
  }

  /** The members of the rigs known to the daemon, each with the agent folder it runs. */
  let seatsRead: { at: number; seats: KnownSeat[] } | undefined;
  async function knownSeats(): Promise<KnownSeat[]> {
    if (seatsRead && now() - seatsRead.at < SEATS_TTL_MS) return seatsRead.seats;
    const st = await state();
    const out: KnownSeat[] = [];
    for (const rig of st.rigs) {
      const r = await run(['spec', 'show', rig.id, '--json'], STATUS_MS);
      if (r.code !== 0) continue;
      const root = rig.name === KERNEL_RIG ? null : await rootOf(rig.name).catch(() => null);
      const specFile = root ? join(root, 'rig.yaml') : null;
      const text = specFile ? await roleIo.read(specFile) : null;
      const written = parseSpec(text);
      const shown = obj(parse(r.stdout));
      const rigDoc = written.ok ? written.doc : shown;
      for (const m of rigMembers(shown, root)) {
        const n = rig.nodes.find(x => x.logicalId === m.logicalId);
        out.push({ rig: rig.name, rigId: rig.id, rigRoot: root ? resolve(root) : null, ...(written.ok && specFile ? { rigSpecPath: specFile } : {}),
          composed: !!root && (resolve(root) + sep).startsWith(resolve(rigsDir) + sep),
          rigDoc, pod: m.pod, member: m.member, written: written.ok ? writtenMember(written.doc, m.logicalId) : null,
          logicalId: m.logicalId, agentDir: m.agentDir, ...(n ? { session: n.session } : {}),
          running: !!n && !n.stopped && n.sessionStatus === 'running', activity: n?.activity ?? 'unknown', node: undefined, loadout: undefined });
      }
    }
    seatsRead = { at: now(), seats: out };
    return out;
  }
  const seatsOf = (entry: LibraryEntry, seats: KnownSeat[]) => seatsFor(dirname(resolve(entry.path)), seats);
  const seatsFor = (dir: string, seats: KnownSeat[]) => seats.filter(s => s.agentDir === dir);

  async function roles(): Promise<RolesResult> {
    const lib = await library();
    if (lib.error) return { roles: [], error: lib.error };
    const seats = await knownSeats();
    const out: RoleSummary[] = [];
    for (const e of lib.entries) {
      const mine = seatsOf(e, seats);
      out.push(summarize(e, parseSpec(await roleIo.read(e.path)), seatCounts(mine)));
    }
    return { roles: out, ...(version ? { openrigVersion: version } : {}) };
  }

  const pluginCache = new Map<string, PluginInfo | null>();
  async function plugin(id: string): Promise<PluginInfo | null> {
    if (pluginCache.has(id)) return pluginCache.get(id)!;
    const r = await run(['plugin', 'show', id, '--json'], STATUS_MS);
    const info = r.code === 0 ? readPlugin(parse(r.stdout)) : null;
    pluginCache.set(id, info);
    return info;
  }

  const allowed = new Map<string, { at: number; files: Set<string> }>();
  async function role(id: string): Promise<RoleResult> {
    const lib = await library();
    if (lib.error) return { error: lib.error };
    const entry = lib.entries.find(e => e.id === id);
    if (!entry) return { error: 'role_not_found' };
    const text = await roleIo.read(entry.path);
    const parsed = parseSpec(text);
    const plugins = new Map<string, PluginInfo>();
    if (parsed.ok) {
      const imports = await resolveImports({ path: entry.path, dir: dirname(entry.path), doc: parsed.doc }, roleIo);
      for (const p of declaredPlugins(parsed.doc, entry.path, imports, home, openrigHome)) { const info = await plugin(p); if (info) plugins.set(p, info); }
    }
    const seats = await Promise.all(seatsOf(entry, await knownSeats()).map(async s => ({
      ...s,
      node: await http(`/api/rigs/${encodeURIComponent(s.rigId)}/nodes/${encodeURIComponent(s.logicalId)}`),
      loadout: s.session ? await run(['skill', 'loadout', '--seat', s.session, '--json'], STATUS_MS).then(r => (r.code === 0 ? parse(r.stdout) : undefined)) : undefined
    })));
    const others = await Promise.all(lib.entries.filter(e => e.id !== id).map(async e => ({ entry: e, parsed: parseSpec(await roleIo.read(e.path)) })));
    const { detail, files } = await buildDetail({ entry, text, seats, library: others, plugins, home, openrigHome, ...(version ? { openrigVersion: version } : {}), io: roleIo });
    allowed.set(id, { at: now(), files });
    return { role: detail };
  }

  async function roleFile(id: string, path: string): Promise<RoleFileResult> {
    if (!isAbsolute(path)) return { error: 'not_allowed' };
    let known = allowed.get(id);
    // A path the last detail did not list is checked again against a fresh one (a seat started, a copy appeared) once it is a few seconds old.
    if (!known || now() - known.at > FILES_TTL_MS || (!known.files.has(resolve(path)) && now() - known.at > SEATS_TTL_MS)) {
      const r = await role(id);
      if (r.error) return { error: r.error };
      known = allowed.get(id);
    }
    if (!known?.files.has(resolve(path))) return { error: 'not_allowed' };
    const st = await roleIo.stat(path);
    if (!st) return { error: 'missing' };
    if (!st.file) return { error: 'not_a_file' };
    const content = await roleIo.head(path, ROLE_FILE_MAX);
    if (content === null) return { error: 'missing' };
    return { content, size: st.size, ...(st.size > ROLE_FILE_MAX ? { truncated: true } : {}) };
  }

  const rows = new Map<string, { at: number; read: Promise<{ row?: RigRow; error?: string }> }>();
  async function row(qitem: string): Promise<{ row?: RigRow; error?: string }> {
    const hit = rows.get(qitem);
    if (hit && now() - hit.at < ROW_TTL_MS) return hit.read;
    const read = (async () => {
      const r = await run(['queue', 'show', qitem, '--json'], STATUS_MS);
      if (r.code === null) return { error: 'not_installed' };
      const said = `${r.stdout}${r.stderr}`;
      if (r.code !== 0) return { error: /qitem_not_found/.test(said) ? 'not_found' : /daemon not running/i.test(said) ? 'daemon_stopped' : failure(r) };
      const out = readRow(r.stdout, new Date(now()).toISOString());
      return out ? { row: out } : { error: 'failed' };
    })();
    rows.delete(qitem); rows.set(qitem, { at: now(), read });
    while (rows.size > ROWS_MAX) rows.delete(rows.keys().next().value!);
    return read;
  }

  const graphs = new Map<string, { at: number; read: Promise<{ graph?: RigGraph; error?: string }> }>();
  async function graph(name: string): Promise<{ graph?: RigGraph; error?: string }> {
    const st = await state();
    if (!st.installed) return { error: 'not_installed' };
    const known = st.rigs.find(r => r.name === name);
    if (!known) return { error: st.daemon.state === 'running' ? 'unknown_rig' : 'daemon_stopped' };
    const hit = graphs.get(known.id);
    if (hit && now() - hit.at < SEATS_TTL_MS) return hit.read;
    const read = (async () => {
      const live = await http(`/api/rigs/${encodeURIComponent(known.id)}/graph`).then(readGraph, () => undefined);
      if (live) return { graph: live };
      const r = await run(['spec', 'show', known.id, '--json'], STATUS_MS);
      if (r.code === null) return { error: 'not_installed' };
      const spec = r.code === 0 ? graphFromSpec(parse(r.stdout)) : undefined;
      return spec ? { graph: spec } : { error: r.code === 0 ? 'failed' : failure(r) };
    })();
    graphs.delete(known.id); graphs.set(known.id, { at: now(), read });
    // A failure is not kept: the next ask reads again.
    void read.then(x => { if (!x.graph && graphs.get(known.id)?.read === read) graphs.delete(known.id); });
    while (graphs.size > ROWS_MAX) graphs.delete(graphs.keys().next().value!);
    return read;
  }

  async function snapshots(name: string): Promise<{ snapshots?: RigSnapshot[]; error?: string }> {
    const st = await state();
    if (!st.installed) return { error: 'not_installed' };
    const known = st.rigs.find(r => r.name === name);
    if (!known) return { error: st.daemon.state === 'running' ? 'unknown_rig' : 'daemon_stopped' };
    const live = await http(`/api/rigs/${encodeURIComponent(known.id)}/snapshots`).then(readSnapshots, () => undefined);
    if (live) return { snapshots: live };
    const r = await run(['snapshot', 'list', known.name], STATUS_MS);
    if (r.code === null) return { error: 'not_installed' };
    return r.code === 0 ? { snapshots: readSnapshotTable(r.stdout).slice(0, RIG_SNAPSHOTS_MAX) } : { error: failure(r) };
  }

  return { state, act, specs, launch, reseat, roles, role, roleFile, row, graph, snapshots };
}

/** The snapshots of `GET /api/rigs/<id>/snapshots` (`[{ id, rigId, kind, status, createdAt, data }]`, not a contract): only
 *  `id`, `kind`, `status` and `createdAt` are kept (`data` is heavy), the newest first, `RIG_SNAPSHOTS_MAX` of them.
 *  Undefined when it is not an array. */
export function readSnapshots(raw: unknown): RigSnapshot[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RigSnapshot[] = [];
  for (const s of raw.map(obj)) {
    const id = str(s.id), kind = str(s.kind), status = str(s.status), createdAt = str(s.createdAt);
    if (id && kind && status && createdAt) out.push({ id, kind, status, createdAt });
  }
  return newestFirst(out);
}

/** The text of `rig snapshot list <rig>` (`ID  Kind  Status  Created`, a row per snapshot, `Created` as `2026-11-08 14:54:01`):
 *  rows that do not have that shape (the header, a « no snapshots » line) are skipped. */
export function readSnapshotTable(text: string): RigSnapshot[] {
  const out: RigSnapshot[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*([0-9A-Z]{26})\s+(\S+)\s+(\S+)\s+(\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d\S*)\s*$/.exec(line);
    if (m) out.push({ id: m[1]!, kind: m[2]!, status: m[3]!, createdAt: m[4]! });
  }
  return newestFirst(out);
}

/** Newest first (`createdAt` reads in time order as text), the most recent `RIG_SNAPSHOTS_MAX`; ties keep OpenRig's order. */
const newestFirst = (all: RigSnapshot[]): RigSnapshot[] =>
  all.map((s, i) => ({ s, i })).sort((a, b) => (a.s.createdAt < b.s.createdAt ? 1 : a.s.createdAt > b.s.createdAt ? -1 : a.i - b.i)).map(x => x.s).slice(0, RIG_SNAPSHOTS_MAX);

/** A rig's topology from the daemon's `GET /api/rigs/<id>/graph` (`{ nodes, edges }`, not a contract): the `podGroup` nodes are the
 *  pods, the `rigNode` ones the seats (`data.logicalId`), and an edge's `source` / `target` are node ids, told back as `logicalId`.
 *  Undefined when it is not that shape. */
export function readGraph(raw: unknown): RigGraph | undefined {
  const j = obj(raw);
  if (!Array.isArray(j.nodes) || !Array.isArray(j.edges)) return undefined;
  const pods: RigGraph['pods'] = [], seats: RigGraphSeat[] = [], logical = new Map<string, string>();
  for (const n of j.nodes.map(obj)) {
    const d = obj(n.data), id = str(n.id), lid = str(d.logicalId);
    if (n.type === 'podGroup') { const ns = str(d.podNamespace) ?? lid; if (ns) pods.push({ id: ns, label: str(d.podLabel) ?? ns }); continue; }
    if (n.type !== 'rigNode' || !id || !lid) continue;
    logical.set(id, lid);
    const pod = str(d.podNamespace) ?? lid.split('.')[0]!, role = str(d.resolvedSpecName), model = str(d.model), session = str(d.canonicalSessionName);
    seats.push({ logicalId: lid, pod, ...(role ? { role } : {}), runtime: str(d.runtime) ?? 'unknown', ...(model ? { model } : {}), status: str(d.status) ?? 'unknown',
      ...(session ? { session } : {}), attention: d.needsAttention === true, ...(typeof d.contextUsedPercentage === 'number' ? { context: d.contextUsedPercentage } : {}) });
  }
  const links: RigLink[] = [];
  for (const e of j.edges.map(obj)) {
    const from = logical.get(str(e.source) ?? ''), to = logical.get(str(e.target) ?? ''), kind = str(e.label);
    if (from && to && kind) links.push({ from, to, kind });
  }
  return { pods, seats, links };
}

/** The same from `rig spec show <id> --json` (the fallback, where nothing is said of state or context): `pods[].members[]` as
 *  `pod.member`, `pods[].edges[]` told with their pod's prefix, and the top-level `edges[]` (already `pod.member`). */
export function graphFromSpec(raw: unknown): RigGraph | undefined {
  const j = obj(raw);
  if (!Array.isArray(j.pods)) return undefined;
  const pods: RigGraph['pods'] = [], seats: RigGraphSeat[] = [], links: RigLink[] = [];
  const link = (e: unknown, prefix: string) => { const x = obj(e), from = str(x.from), to = str(x.to), kind = str(x.kind); if (from && to && kind) links.push({ from: prefix + from, to: prefix + to, kind }); };
  for (const p of j.pods.map(obj)) {
    const id = str(p.id);
    if (!id) continue;
    pods.push({ id, label: str(p.label) ?? id });
    for (const m of (Array.isArray(p.members) ? p.members : []).map(obj)) {
      const mid = str(m.id), model = str(m.model);
      if (mid) seats.push({ logicalId: `${id}.${mid}`, pod: id, runtime: str(m.runtime) ?? 'unknown', ...(model ? { model } : {}), status: 'unknown', attention: false });
    }
    for (const e of Array.isArray(p.edges) ? p.edges : []) link(e, `${id}.`);
  }
  for (const e of Array.isArray(j.edges) ? j.edges : []) link(e, '');
  return { pods, seats, links };
}

/** How long a row's read is reused: under the fronts' 30 s cadence, so a card is never more than one cadence late. */
export const ROW_TTL_MS = RIG_ROW_REFRESH_MS / 2;
const ROWS_MAX = 500;

/** A row from `rig queue show <id> --json`; undefined when it is not one. */
export function readRow(output: string, at: string): RigRow | undefined {
  const j = obj(parse(output));
  const id = str(j.qitemId), state = str(j.state), from = str(j.sourceSession), to = str(j.destinationSession), createdAt = str(j.tsCreated);
  if (!id || !state || from === null || to === null || !createdAt || !QitemIdSchema.safeParse(id).success) return undefined;
  const summary = str(j.summary), handedOffTo = str(j.handedOffTo), blockedOn = str(j.blockedOn), claimedAt = str(j.claimedAt);
  return { id, state, from, to, createdAt, updatedAt: str(j.tsUpdated) ?? createdAt, at,
    ...(summary ? { summary } : {}), ...(handedOffTo ? { handedOffTo } : {}), ...(blockedOn ? { blockedOn } : {}), ...(claimedAt ? { claimedAt } : {}) };
}
