import { execFile } from 'node:child_process';
import { log } from './log.js';

/** The command that prints a login shell's environment, NUL-separated: `env` is a program, so any shell runs it alike. */
export function envCommand(shell: string): string[] {
  return [shell, '-l', '-c', 'env -0'];
}

/** Variables that describe the shell process itself, not the user's setup: the agent's own shell sets them. */
const SHELL_LOCAL = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);

/** `env -0` output as a record, without the shell-local variables. */
export function parseEnv(out: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of out.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (!SHELL_LOCAL.has(key)) env[key] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * The environment a fresh terminal would give the user: what their login shell (`$SHELL`) starts with. The daemon
 * needs it because systemd starts it with the bare system environment: no PATH to `claude` (usually ~/.local/bin),
 * no corporate proxy (HTTPS_PROXY, NODE_EXTRA_CA_CERTS...), and tmux hands a detached session's pane the PATH of the
 * tmux client, not the daemon's `-e`. Returns `{}` (logged) when the shell is missing, fails, prints nothing or hangs.
 */
export function loginShellEnv(opts: { shell?: string; timeoutMs?: number; command?: (shell: string) => string[] } = {}): Promise<Record<string, string>> {
  const shell = opts.shell ?? process.env.SHELL;
  if (!shell) return Promise.resolve({});
  const [bin, ...args] = (opts.command ?? envCommand)(shell);
  return new Promise(resolve => {
    execFile(bin!, args, { timeout: opts.timeoutMs ?? 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const env = err ? {} : parseEnv(String(stdout));
      if (env.PATH) return resolve(env);
      log(`login shell environment unavailable (${shell}: ${err ? err.message.split('\n')[0] : 'printed no PATH'}), launching with the daemon's`);
      resolve({});
    });
  });
}
