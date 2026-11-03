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

/** The string values of one `reg query <key>` output: `    NAME    REG_SZ    value` (names may hold spaces). */
type RegValues = Record<string, { type: string; value: string }>;
export function parseRegQuery(out: string): RegValues {
  const values: RegValues = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_SZ|REG_EXPAND_SZ)(?: {4}(.*))?$/.exec(line);
    if (m) values[m[1]!] = { type: m[2]!, value: m[3] ?? '' };
  }
  return values;
}

const MACHINE_ENV = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
const USER_ENV = 'HKCU\\Environment';
const regQuery = (key: string) => new Promise<string>((resolve, reject) => {
  execFile('reg', ['query', key], { windowsHide: true, timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/**
 * Windows: the environment a new process of the user gets, read where Windows keeps it (machine, then user, which wins;
 * `Path` is both joined, then the folders only `base` has), `%NAME%` expanded against `base` then those values, an
 * unknown one kept as written. What a tool installed after the daemon started added to the PATH is there.
 */
export async function windowsRegistryEnv(run: (key: string) => Promise<string> = regQuery, base: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const none = (): RegValues => ({});
  const [machine, user] = await Promise.all([run(MACHINE_ENV).then(parseRegQuery, none), run(USER_ENV).then(parseRegQuery, none)]);
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) lookup.set(k.toUpperCase(), v);
  for (const src of [machine, user]) for (const [k, v] of Object.entries(src)) if (v.type === 'REG_SZ') lookup.set(k.toUpperCase(), v.value);
  const expand = (s: string) => s.replace(/%([^%;]+)%/g, (all, name: string) => lookup.get(name.toUpperCase()) ?? all);
  const value = (v: { type: string; value: string }) => (v.type === 'REG_EXPAND_SZ' ? expand(v.value) : v.value);
  const env: Record<string, string> = {};
  for (const src of [machine, user]) for (const [k, v] of Object.entries(src)) if (k.toUpperCase() !== 'PATH') env[k] = value(v);
  const path = (src: RegValues) => { const k = Object.keys(src).find(n => n.toUpperCase() === 'PATH'); return k ? value(src[k]!) : ''; };
  const joined = [path(machine), path(user)].filter(Boolean).join(';');
  // The folders the daemon itself was given (Desktop's Git, the agents it installed) follow the registry's, once each.
  const baseKey = Object.keys(base).find(k => k.toUpperCase() === 'PATH');
  const seen = new Set(joined.split(';').map(d => d.toLowerCase()));
  const own = (baseKey ? base[baseKey] ?? '' : '').split(';').filter(d => d && !seen.has(d.toLowerCase()) && (seen.add(d.toLowerCase()), true));
  const full = [joined, ...own].filter(Boolean).join(';');
  if (full) env.Path = full;
  return env;
}

/** The environment a fresh terminal would give the user: the registry's on Windows, the login shell's elsewhere. */
export function userEnv(platform: NodeJS.Platform = process.platform, deps: { registry?: () => Promise<Record<string, string>>; shell?: () => Promise<Record<string, string>> } = {}): Promise<Record<string, string>> {
  return platform === 'win32' ? (deps.registry ?? (() => windowsRegistryEnv()))() : (deps.shell ?? (() => loginShellEnv()))();
}
