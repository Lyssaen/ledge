import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { log } from './log.js';

/** The command that prints a login shell's PATH: fish keeps it as a list, every other shell as the colon string. */
export function pathCommand(shell: string): string[] {
  return basename(shell) === 'fish' ? [shell, '-l', '-c', 'string join : $PATH'] : [shell, '-l', '-c', 'printf %s "$PATH"'];
}

/**
 * The PATH a fresh terminal would give the user: what their login shell (`$SHELL`) starts with. The daemon needs it
 * because systemd starts it with the bare system PATH, where `claude` (usually ~/.local/bin) does not resolve, and
 * tmux hands a detached session's pane the PATH of the tmux client, not the daemon's `-e`. Falls back to `fallback`
 * (logged) when the shell is missing, fails, prints nothing or hangs.
 */
export function loginShellPath(opts: { shell?: string; fallback: string; timeoutMs?: number; command?: (shell: string) => string[] }): Promise<string> {
  const shell = opts.shell ?? process.env.SHELL;
  if (!shell) return Promise.resolve(opts.fallback);
  const [bin, ...args] = (opts.command ?? pathCommand)(shell);
  return new Promise(resolve => {
    execFile(bin!, args, { timeout: opts.timeoutMs ?? 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const path = String(stdout).trim();
      if (!err && path) return resolve(path);
      log(`login shell PATH unavailable (${shell}: ${err ? err.message.split('\n')[0] : 'printed nothing'}), launching with the daemon's`);
      resolve(opts.fallback);
    });
  });
}
