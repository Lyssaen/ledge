import { spawn } from 'node:child_process';
import { PROTOCOL_PORT } from '@ledge/protocol';
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
  /** Runs `tmux <args>` attached to the user's terminal and resolves with its exit code. */
  attach?: (args: string[], env: NodeJS.ProcessEnv) => Promise<number>;
  /** Where the tab title goes (the terminal's stdout by default). */
  write?: (s: string) => void;
}

/**
 * `ledge attach <id>`: puts this terminal on a session's tmux pane, like the tab `ledge claude` opens. The overlay runs
 * it in a new Windows Terminal tab for a session it launched itself. The tab is renamed after the session's title when
 * the daemon answers; the session's life is unchanged (the daemon's poller sees the pane end).
 */
export async function attach(id: string, opts: AttachOptions = {}): Promise<number> {
  if (!id) { console.error('ledge attach: missing session id'); return 2; }
  const tmux = realTmux(opts.tmuxSocket ?? TMUX_SOCKET);
  const tmuxName = `ledge-${id}`;
  if (!(await tmux.hasSession(tmuxName))) { console.error(`ledge attach: no session ${id}`); return 1; }
  let title = tmuxName;
  try {
    const c = await connect({ port: opts.port ?? PROTOCOL_PORT, timeoutMs: 800 });
    const snap = await c.next('snapshot');
    title = snap.sessions.find(s => s.id === id)?.title ?? title;
    await Promise.race([c.close(), new Promise(r => setTimeout(r, 500))]);
  } catch { /* no daemon: the pane is still there to attach to */ }
  const write = opts.write ?? (s => { if (process.stdout.isTTY) process.stdout.write(s); });
  write(`\u001b]0;${title}\u0007`); // rename the Windows Terminal tab
  return (opts.attach ?? attachInherit)(tmux.attachArgs(tmuxName), attachEnv(process.env));
}
