import { spawn } from 'node:child_process';
import { backendOf, type Session } from '@ledge/protocol';
import type { Fleet } from '@ledge/fleet';
import { attachEnv } from '../cli/launch.js';

/** The command that puts this terminal on the session's pane (`ledge attach`, through ssh for a remote machine), or why there is none. */
export function attachCommand(fleet: Pick<Fleet, 'terminal'>, s: Session): { argv: string[] } | { why: 'offline' | 'omp' | 'none' } {
  if (s.offline) return { why: 'offline' };
  if (backendOf(s) === 'omp-rpc') return { why: 'omp' };
  if (!s.tmuxSession) return { why: 'none' };
  const argv = fleet.terminal(s.id);
  return argv && argv.length > 0 ? { argv } : { why: 'none' };
}

/** Runs `argv` on the user's terminal and resolves with its exit code (TMUX removed, so tmux attaches from inside tmux too). */
export function runAttached(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: 'inherit', env: attachEnv(env) });
    child.on('error', () => resolve(127));
    child.on('exit', code => resolve(code ?? 1));
  });
}
