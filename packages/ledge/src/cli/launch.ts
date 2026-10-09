import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Session, Tool } from '@ledge/protocol';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { realTmux, type Tmux } from '../tmux.js';
import { ensureLedgeDir, paths } from '../paths.js';
import { pickName } from '../names.js';
import { log } from '../log.js';

const AGENT_BIN: Record<Tool, string> = { claude: 'claude', codex: 'codex', cursor: 'cursor-agent' };
const TMUX_SOCKET = 'ledge';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function parseLaunchArgs(argv: string[]): { name?: string; args: string[] } {
  const args: string[] = []; let name: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--name') { name = argv[++i]; continue; }
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    args.push(a);
  }
  return { name, args };
}

function portOpen(port: number): Promise<boolean> {
  return new Promise(res => { const s = createConnection({ host: '127.0.0.1', port }); s.once('connect', () => { s.end(); res(true); }); s.once('error', () => res(false)); });
}

/**
 * Starts `ledge daemon` detached from this terminal. It re-runs this very script
 * (process.execPath + argv[1]), so it needs the built CLI (dist/cli/index.js): under
 * `pnpm dev` (tsx) argv[1] is a .ts file and the spawned daemon dies. Not supported on purpose.
 */
function spawnDetachedDaemon(): void {
  const child = spawn(process.execPath, [process.argv[1]!, 'daemon'], { detached: true, stdio: 'ignore' });
  child.unref();
}

export type DaemonConnection = { client: Client } | { client: null; reason: 'foreign' | 'unresponsive' | 'unreachable' };

type Probe = { client: Client } | { client: null; state: 'refused' | 'timeout' | 'foreign' };

/** Bounded close: a hung peer must not stall the launcher for ws's 30 s close timeout. */
const closeQuietly = (c: Client) => Promise.race([c.close(), sleep(500)]);

/**
 * Connect and wait for the snapshot a Ledge daemon sends on connect. A refused connection means
 * nothing listens; a WebSocket that fails the handshake or never sends a valid snapshot is foreign;
 * a handshake that does not complete in time is a busy (or hung) listener, not proof of a foreign one.
 */
async function probe(port: number, timeoutMs: number): Promise<Probe> {
  let client: Client;
  try { client = await connect({ port, timeoutMs }); }
  catch (e) {
    if ((e as Error).message === 'connect timeout') return { client: null, state: 'timeout' };
    // The error code alone is not reliable (a refused connect can surface as ECONNRESET): ask TCP.
    return { client: null, state: (await portOpen(port)) ? 'foreign' : 'refused' };
  }
  try { await client.next('snapshot', timeoutMs); return { client }; }
  catch { void closeQuietly(client); return { client: null, state: 'foreign' }; }
}

export async function ensureDaemon(opts: { port?: number; spawnDaemon?: () => void; retryDelayMs?: number; timeoutMs?: number } = {}): Promise<DaemonConnection> {
  await ensureLedgeDir();
  const port = opts.port ?? PROTOCOL_PORT;
  const timeoutMs = opts.timeoutMs ?? 2000;
  const first = await probe(port, timeoutMs);
  if (first.client) return { client: first.client };
  if (first.state === 'foreign') { log(`port ${port} is open but does not speak the Ledge protocol`); return { client: null, reason: 'foreign' }; }
  if (first.state === 'timeout') { log(`port ${port} accepted a connection but did not answer within ${timeoutMs} ms`); return { client: null, reason: 'unresponsive' }; }
  (opts.spawnDaemon ?? spawnDetachedDaemon)();
  for (let i = 0; i < 3; i++) {
    await sleep(opts.retryDelayMs ?? 500);
    const r = await probe(port, timeoutMs);
    if (r.client) return { client: r.client };
  }
  return { client: null, reason: 'unreachable' };
}

/** Where the wrapped agent leaves its exit code (see createSession's `recordExit`). */
export function exitFile(id: string): string { return join(paths().dir, `exit-${id}`); }

/** The daemon accepted the connection but failed during session creation: launch untracked instead. */
export class DaemonError extends Error {}

export async function createSession(opts: { tool: Tool; args: string[]; command?: string[]; recordExit?: boolean; name?: string; cwd: string; tmux: Tmux; client: Client | null; now?: () => string }): Promise<Session> {
  const now = opts.now ?? (() => new Date().toISOString());
  const takenNames: string[] = []; const takenIds = new Set<string>();
  if (opts.client) {
    let snap;
    try { opts.client.send({ type: 'snapshot.request' }); snap = await opts.client.next('snapshot'); }
    catch (e) { throw new DaemonError(`daemon did not answer: ${(e as Error).message}`); }
    for (const s of snap.sessions) { takenNames.push(s.name); takenIds.add(s.id); }
  }
  let id: string; do id = randomBytes(2).toString('hex'); while (takenIds.has(id));
  const name = pickName(takenNames, opts.name);
  const project = basename(opts.cwd) || opts.cwd;
  const tmuxSession = `ledge-${id}`;
  // `command` replaces the agent binary entirely (tests run a fake agent); `args` are always agent args.
  const agent = opts.command ?? [AGENT_BIN[opts.tool], ...opts.args];
  // With recordExit, sh runs the agent with its argv untouched ("$@") and writes its exit code to
  // the file passed as $0, so the session can die naturally and the code is still readable.
  const command = opts.recordExit ? ['sh', '-c', '"$@"; echo $? > "$0"', exitFile(id), ...agent] : agent;
  await opts.tmux.newSession({ name: tmuxSession, cwd: opts.cwd, env: { LEDGE_SESSION: id, LEDGE_NAME: name }, command });
  const at = now();
  const session: Session = { id, name, tool: opts.tool, cwd: opts.cwd, project, title: `${name} · ${project}`, tmuxSession, state: 'starting', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' };
  // The agent already runs: a lost register only means an untracked session, never a failed launch.
  try { opts.client?.send({ type: 'session.register', session }); }
  catch (e) { log(`register failed for ${id}: ${(e as Error).message}`); }
  return session;
}

/** Environment for `tmux attach`: without $TMUX, so running the launcher inside tmux is not refused as nesting. */
export function attachEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { TMUX: _ignored, ...rest } = env;
  return rest;
}

function attachInherit(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(resolve => {
    const child = spawn('tmux', args, { stdio: 'inherit', env });
    child.on('error', () => resolve(1));
    child.on('exit', c => resolve(c ?? 1));
  });
}

async function readExitCode(id: string): Promise<number | null> {
  const file = exitFile(id);
  let raw: string | null = null;
  try { raw = await readFile(file, 'utf8'); } catch { /* the agent never finished writing it */ }
  await rm(file, { force: true });
  const t = raw?.trim();
  return t && /^\d+$/.test(t) ? Number(t) : null;
}

export interface LaunchOptions {
  port?: number;
  tmuxSocket?: string;
  cwd?: string;
  /** Replaces the agent binary (tests run a fake agent). */
  command?: string[];
  /** Runs `tmux <args>` attached to the user's terminal and resolves with its exit code. */
  attach?: (args: string[], env: NodeJS.ProcessEnv) => Promise<number>;
  spawnDaemon?: () => void;
  retryDelayMs?: number;
}

const UNTRACKED: Record<'foreign' | 'unresponsive' | 'unreachable', (port: number) => string> = {
  foreign: port => `ledge: port ${port} is used by another program, session not tracked`,
  unresponsive: () => 'ledge: daemon not responding, session not tracked',
  unreachable: () => 'ledge: daemon not running, session not tracked'
};

export async function launch(tool: Tool, argv: string[], opts: LaunchOptions = {}): Promise<number> {
  await ensureLedgeDir();
  const { name, args } = parseLaunchArgs(argv);
  const port = opts.port ?? PROTOCOL_PORT;
  const socket = opts.tmuxSocket ?? TMUX_SOCKET;
  const tmux = realTmux(socket);
  const cwd = opts.cwd ?? process.cwd();
  const daemon = await ensureDaemon({ port, spawnDaemon: opts.spawnDaemon, retryDelayMs: opts.retryDelayMs });
  let client = daemon.client;
  if (!daemon.client) console.error(UNTRACKED[daemon.reason](port));
  const create = (c: Client | null) => createSession({ tool, args, command: opts.command, recordExit: true, name, cwd, tmux, client: c });
  let session: Session;
  try { session = await create(client); }
  catch (e) {
    if (!(e instanceof DaemonError)) throw e;
    log(e.message);
    if (client) void closeQuietly(client);
    client = null;
    console.error(UNTRACKED.unresponsive(port));
    session = await create(null);
  }
  // The daemon broadcasts every update and preview: do not hold a connection for the agent's whole life.
  if (client) await closeQuietly(client);
  const tmuxName = session.tmuxSession!;
  if (process.stdout.isTTY) process.stdout.write(`\u001b]0;${session.title}\u0007`); // rename the Windows Terminal tab

  const attachCode = await (opts.attach ?? attachInherit)(tmux.attachArgs(tmuxName), attachEnv(process.env));
  if (await tmux.hasSession(tmuxName)) {
    // Detached (or the attach failed): the agent keeps running, tracked by the daemon.
    if (attachCode !== 0) console.error(`ledge: could not attach; ${session.name} keeps running in tmux session ${tmuxName} (tmux -L ${socket} attach -t ${tmuxName})`);
    return attachCode;
  }
  const exitCode = await readExitCode(session.id);
  if (client) {
    // A fresh connection: the daemon may have restarted while the agent ran.
    try {
      const c = await connect({ port, timeoutMs: 800 });
      c.send({ type: 'session.unregister', id: session.id, exitCode });
      await closeQuietly(c);
    } catch { /* daemon gone: the poller marks the session exited when it comes back */ }
  }
  return exitCode ?? 1;
}
