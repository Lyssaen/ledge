import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import type { Session, Tool } from '@ledge/protocol';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { realTmux, run, type Tmux } from '../tmux.js';
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

export type DaemonConnection = { client: Client } | { client: null; reason: 'foreign' | 'unreachable' };

export async function ensureDaemon(opts: { port?: number; spawnDaemon?: () => void; retryDelayMs?: number } = {}): Promise<DaemonConnection> {
  await ensureLedgeDir();
  const port = opts.port ?? PROTOCOL_PORT;
  try { return { client: await connect({ port, timeoutMs: 400 }) }; } catch { /* not running or not ours */ }
  if (await portOpen(port)) { log(`port ${port} is open but does not speak the Ledge protocol`); return { client: null, reason: 'foreign' }; }
  (opts.spawnDaemon ?? spawnDetachedDaemon)();
  for (let i = 0; i < 3; i++) {
    await sleep(opts.retryDelayMs ?? 500);
    try { return { client: await connect({ port, timeoutMs: 400 }) }; } catch { /* retry */ }
  }
  return { client: null, reason: 'unreachable' };
}

export async function createSession(opts: { tool: Tool; args: string[]; command?: string[]; name?: string; cwd: string; tmux: Tmux; client: Client | null; now?: () => string }): Promise<Session> {
  const now = opts.now ?? (() => new Date().toISOString());
  const takenNames: string[] = []; const takenIds = new Set<string>();
  if (opts.client) {
    opts.client.send({ type: 'snapshot.request' });
    const snap = await opts.client.next('snapshot');
    for (const s of snap.sessions) { takenNames.push(s.name); takenIds.add(s.id); }
  }
  let id: string; do id = randomBytes(2).toString('hex'); while (takenIds.has(id));
  const name = pickName(takenNames, opts.name);
  const project = basename(opts.cwd) || opts.cwd;
  const tmuxSession = `ledge-${id}`;
  // `command` replaces the agent binary entirely (tests run a fake agent); `args` are always agent args.
  const command = opts.command ?? [AGENT_BIN[opts.tool], ...opts.args];
  await opts.tmux.newSession({ name: tmuxSession, cwd: opts.cwd, env: { LEDGE_SESSION: id, LEDGE_NAME: name }, command });
  const at = now();
  const session: Session = { id, name, tool: opts.tool, cwd: opts.cwd, project, title: `${name} · ${project}`, tmuxSession, state: 'starting', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' };
  opts.client?.send({ type: 'session.register', session });
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

/**
 * Keep the pane after the agent exits so its exit status can be read, and end the attach then:
 * when someone is attached, the pane-died hook detaches them (the launcher reads the status and
 * kills the session); when nobody is (the user detached earlier), the hook kills the session.
 */
async function armExitStatus(socket: string, name: string): Promise<void> {
  const t = (args: string[]) => run(['-L', socket, '-f', paths().tmuxConf, ...args]);
  await t(['set-option', '-t', `=${name}:`, 'remain-on-exit', 'on']);
  await t(['set-hook', '-t', `=${name}:`, 'pane-died', `if-shell -F '#{session_attached}' 'detach-client -s =${name}' 'kill-session -t =${name}'`]);
}

/** `{ dead: false }` while the agent runs, `{ dead: true, code }` once it exited, null when the session is gone. */
async function paneStatus(socket: string, name: string): Promise<{ dead: boolean; code: number | null } | null> {
  const r = await run(['-L', socket, '-f', paths().tmuxConf, 'display-message', '-p', '-t', `=${name}:`, '#{pane_dead} #{pane_dead_status}']);
  if (r.code !== 0) return null;
  const [dead, status] = r.stdout.trim().split(' ');
  const code = status !== undefined && /^\d+$/.test(status) ? Number(status) : null;
  return { dead: dead === '1', code };
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

export async function launch(tool: Tool, argv: string[], opts: LaunchOptions = {}): Promise<number> {
  await ensureLedgeDir();
  const { name, args } = parseLaunchArgs(argv);
  const port = opts.port ?? PROTOCOL_PORT;
  const socket = opts.tmuxSocket ?? TMUX_SOCKET;
  const tmux = realTmux(socket);
  const daemon = await ensureDaemon({ port, spawnDaemon: opts.spawnDaemon, retryDelayMs: opts.retryDelayMs });
  if (!daemon.client) {
    console.error(daemon.reason === 'foreign'
      ? `ledge: port ${port} is used by another program, session not tracked`
      : 'ledge: daemon not running, session not tracked');
  }
  const session = await createSession({ tool, args, command: opts.command, name, cwd: opts.cwd ?? process.cwd(), tmux, client: daemon.client });
  // The daemon broadcasts every update and preview: do not hold a connection for the agent's whole life.
  await daemon.client?.close();
  const tmuxName = session.tmuxSession!;
  await armExitStatus(socket, tmuxName);
  if (process.stdout.isTTY) process.stdout.write(`\u001b]0;${session.title}\u0007`); // rename the Windows Terminal tab

  const attachCode = await (opts.attach ?? attachInherit)(tmux.attachArgs(tmuxName), attachEnv(process.env));
  const status = await paneStatus(socket, tmuxName);
  if (status && !status.dead) {
    // Detached (or the attach failed): the agent keeps running, tracked by the daemon.
    if (attachCode !== 0) console.error(`ledge: could not attach; ${session.name} keeps running in tmux session ${tmuxName} (tmux -L ${socket} attach -t ${tmuxName})`);
    return attachCode;
  }
  const exitCode = status?.code ?? null;
  if (status) await tmux.killSession(tmuxName);
  if (daemon.client) {
    // A fresh connection: the daemon may have restarted while the agent ran.
    try {
      const c = await connect({ port, timeoutMs: 800 });
      c.send({ type: 'session.unregister', id: session.id, exitCode });
      await c.close();
    } catch { /* daemon gone: the poller marks the session exited when it comes back */ }
  }
  return exitCode ?? 1;
}
