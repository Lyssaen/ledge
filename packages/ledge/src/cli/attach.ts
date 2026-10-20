import { spawn } from 'node:child_process';
import { PROTOCOL_PORT, backendOf } from '@ledge/protocol';
import { connect } from '../client.js';
import { realTmux } from '../tmux.js';
import { attachEnv } from './launch.js';

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
  /** Watches the pane without sending it keys. */
  readOnly?: boolean;
  /** Runs `tmux <args>` attached to the user's terminal and resolves with its exit code. */
  attach?: (args: string[], env: NodeJS.ProcessEnv) => Promise<number>;
  /** Where the tab title goes (the terminal's stdout by default). */
  write?: (s: string) => void;
}

/** The name of session `id` when the daemon says it has no terminal (OMP), else null (no daemon, no such session, a tmux one). */
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
  const tmux = realTmux(opts.tmuxSocket ?? TMUX_SOCKET);
  const tmuxName = `ledge-${id}`;
  if (!(await tmux.hasSession(tmuxName))) {
    // An OMP session has no pane: the daemon drives it over its protocol, and nothing a terminal shows is its state (spec 2026-10-20 §3.5).
    const native = await nativeSession(id, opts.port ?? PROTOCOL_PORT);
    console.error(native ? `ledge attach: ${native} is driven by Ledge over OMP's own protocol: there is no terminal to attach to (open a shell from the app)` : `ledge attach: no session ${id}`);
    return 1;
  }
  let title = tmuxName;
  try {
    const c = await connect({ port: opts.port ?? PROTOCOL_PORT, timeoutMs: 800 });
    const snap = await c.next('snapshot');
    title = snap.sessions.find(s => s.id === id)?.title ?? title;
    await Promise.race([c.close(), new Promise(r => setTimeout(r, 500))]);
  } catch { /* no daemon: the pane is still there to attach to */ }
  const write = opts.write ?? (s => { if (process.stdout.isTTY) process.stdout.write(s); });
  write(`\u001b]0;${title}\u0007`); // rename the Windows Terminal tab
  return (opts.attach ?? attachInherit)(tmux.attachArgs(tmuxName, { readOnly: opts.readOnly }), attachEnv(process.env));
}
