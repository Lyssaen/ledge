import { ledgePort } from '../port.js';
import { spawn } from 'node:child_process';
import { backendOf } from '@ledge/protocol';
import { connect } from '../client.js';
import { isSeatSession, realTmux } from '../tmux.js';
import { attachEnv } from './launch.js';
import { usesPaneHost } from '../panes/pick.js';
import type { PaneHostClient } from '../panes/client.js';

const TMUX_SOCKET = 'ledge';

function attachInherit(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise(resolve => {
    const child = spawn('tmux', args, { stdio: 'inherit', env });
    child.on('error', () => resolve(1));
    child.on('exit', c => resolve(c ?? 1));
  });
}

export interface AttachOptions {
  port?: number; tmuxSocket?: string;
  /** The tmux server of OpenRig's seats: the user's default one (null) unless a test names another. */
  seatSocket?: string | null;
  /** Watches the pane without sending it keys. */
  readOnly?: boolean;
  /** Runs `tmux <args>` attached to the user's terminal and resolves with its exit code. */
  attach?: (args: string[], env: NodeJS.ProcessEnv) => Promise<number>;
  /** Where the tab title goes (the terminal's stdout by default). */
  write?: (s: string) => void;
  /** The pane host to attach through (Windows); by default the one of this Ledge folder when `usesPaneHost`. */
  paneHost?: Pick<PaneHostClient, 'hasSession' | 'attach' | 'close'>;
  /** The terminal's streams (stdin and stdout by default). */
  io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
}

/** The name of session `id` when the daemon says it has no terminal (OMP), else null (no daemon, no such session, a tmux one). */
/** The tmux session of an OpenRig seat Ledge follows (`source: 'rig'`), from the daemon's snapshot; null otherwise. */
async function seatSession(id: string, port: number): Promise<string | null> {
  try {
    const c = await connect({ port, timeoutMs: 800 });
    const snap = await c.next('snapshot');
    await Promise.race([c.close(), new Promise(r => setTimeout(r, 500))]);
    const s = snap.sessions.find(x => x.id === id);
    return s?.source === 'rig' && s.tmuxSession && isSeatSession(s.tmuxSession) ? s.tmuxSession : null;
  } catch { return null; }
}

async function nativeSession(id: string, port: number): Promise<string | null> {
  try {
    const c = await connect({ port, timeoutMs: 800 });
    const snap = await c.next('snapshot');
    await Promise.race([c.close(), new Promise(r => setTimeout(r, 500))]);
    const s = snap.sessions.find(x => x.id === id);
    return s && backendOf(s) === 'omp-rpc' ? s.name : null;
  } catch { return null; }
}

/**
 * `ledge attach [--read-only] <id>`: puts this terminal on a session's tmux pane, like the tab `ledge claude` opens. The overlay runs
 * it in a new Windows Terminal tab for a session it launched itself. The tab is renamed after the session's title when
 * the daemon answers; the session's life is unchanged (the daemon's poller sees the pane end).
 */
export async function attach(id: string, opts: AttachOptions = {}): Promise<number> {
  if (!id) { console.error('ledge attach: missing session id'); return 2; }
  if (opts.paneHost || usesPaneHost(process.platform, process.env)) return attachThroughHost(id, opts);
  let tmux = realTmux(opts.tmuxSocket ?? TMUX_SOCKET);
  let tmuxName = `ledge-${id}`;
  // An OpenRig seat runs on the user's default tmux server, under its seat's name (`dev-build@starter`).
  if (!(await tmux.hasSession(tmuxName))) {
    const seat = await seatSession(id, opts.port ?? ledgePort());
    if (seat) { tmux = realTmux(opts.seatSocket === undefined ? null : opts.seatSocket); tmuxName = seat; }
  }
  if (!(await tmux.hasSession(tmuxName))) {
    // An OMP session has no pane: the daemon drives it over its protocol, and nothing a terminal shows is its state (spec 2026-10-20 §3.5).
    const native = await nativeSession(id, opts.port ?? ledgePort());
    console.error(native ? `ledge attach: ${native} is driven by Ledge over OMP's own protocol: there is no terminal to attach to (open a shell from the app)` : `ledge attach: no session ${id}`);
    return 1;
  }
  let title = tmuxName;
  try {
    const c = await connect({ port: opts.port ?? ledgePort(), timeoutMs: 800 });
    const snap = await c.next('snapshot');
    title = snap.sessions.find(s => s.id === id)?.title ?? title;
    await Promise.race([c.close(), new Promise(r => setTimeout(r, 500))]);
  } catch { /* no daemon: the pane is still there to attach to */ }
  const write = opts.write ?? (s => { if (process.stdout.isTTY) process.stdout.write(s); });
  write(`\u001b]0;${title}\u0007`); // rename the Windows Terminal tab
  return (opts.attach ?? attachInherit)(tmux.attachArgs(tmuxName, { readOnly: opts.readOnly }), attachEnv(process.env));
}

/** The pane host's client of this Ledge folder; attach never starts a host: without one there is no pane to show. */
async function localPaneHost(): Promise<Pick<PaneHostClient, 'hasSession' | 'attach' | 'close'>> {
  const [{ paneHostClient }, { panehostPath }, { readDaemonToken }, { paths }] = await Promise.all([import('../panes/client.js'), import('../panes/protocol.js'), import('../auth.js'), import('../paths.js')]);
  return paneHostClient({ path: () => panehostPath(process.platform, paths().dir, readDaemonToken() ?? ''), token: readDaemonToken, start: () => {}, connectMs: 1000 });
}

/** Windows: the pane streamed through the pane host, this terminal raw while attached. Resolves with the agent's exit
 *  code when it ends, 0 when the pane is gone without one (as `tmux attach` does). */
async function attachThroughHost(id: string, opts: AttachOptions): Promise<number> {
  const host = opts.paneHost ?? await localPaneHost();
  const name = `ledge-${id}`;
  try {
    if (!(await host.hasSession(name).catch(() => false))) { console.error(`ledge attach: no session ${id}`); return 1; }
    const input = opts.io?.input ?? process.stdin, output = opts.io?.output ?? process.stdout;
    const tty = input as NodeJS.ReadStream;
    const raw = tty.isTTY === true && typeof tty.setRawMode === 'function';
    if (raw) tty.setRawMode(true);
    try { return (await host.attach(name, { input, output, readOnly: opts.readOnly })) ?? 0; }
    catch (e) { console.error(`ledge attach: ${(e as Error).message}`); return 1; }
    finally { if (raw) tty.setRawMode(false); if (!opts.io) process.stdin.pause(); }
  } finally { if (!opts.paneHost) host.close(); }
}
