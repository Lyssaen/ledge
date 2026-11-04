import { win32 } from 'node:path';
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
/** What Windows sets at logon (USERNAME, USERPROFILE, APPDATA…), over the machine's: there USERNAME is SYSTEM. */
const LOGON_ENV = 'HKCU\\Volatile Environment';
const USER_ENV = 'HKCU\\Environment';

/** `reg query <key>` under the UTF-8 code page: reg.exe writes in the console's code page, an OEM one on many PCs,
 *  which would garble a non-ASCII value. */
export function regCommand(key: string): { file: string; args: string[] } {
  return { file: 'cmd', args: ['/d', '/s', '/c', `chcp 65001 >nul & reg query "${key}"`] };
}
const regQuery = (key: string) => new Promise<string>((resolve, reject) => {
  const { file, args } = regCommand(key);
  execFile(file, args, { windowsHide: true, timeout: 5000, windowsVerbatimArguments: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
});

/**
 * Windows: the environment a new process of the user gets, read where Windows keeps it: the machine's, then the
 * logon's, then the user's (each wins over the one before); `Path` is the machine's and the user's joined, then the
 * folders only `base` has (Desktop's Git, the agents it installed). `%NAME%` is expanded against `base` then these
 * values, as Windows does (`Path` last); an unknown one is kept as written. A source reg.exe cannot read is skipped,
 * and said in the log.
 */
export async function windowsRegistryEnv(run: (key: string) => Promise<string> = regQuery, base: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const read = (key: string) => run(key).then(parseRegQuery, (e: Error) => { log(`registry environment: ${key} not read (${e.message.split('\n')[0]})`); return {} as RegValues; });
  const [machine, logon, user] = await Promise.all([read(MACHINE_ENV), read(LOGON_ENV), read(USER_ENV)]);
  const sources = [machine, logon, user];
  const isPath = (k: string) => k.toUpperCase() === 'PATH';
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) lookup.set(k.toUpperCase(), v);
  const expand = (s: string) => s.replace(/%([^%;]+)%/g, (all, name: string) => lookup.get(name.toUpperCase()) ?? all);
  const env: Record<string, string> = {};
  // Plain strings first, then expandable ones in two passes, so one may name another (JAVA_HOME in Path's %JAVA_HOME%).
  for (const src of sources) for (const [k, v] of Object.entries(src)) if (!isPath(k) && v.type === 'REG_SZ') { env[k] = v.value; lookup.set(k.toUpperCase(), v.value); }
  for (let pass = 0; pass < 2; pass++) for (const src of sources) for (const [k, v] of Object.entries(src)) {
    if (isPath(k) || v.type !== 'REG_EXPAND_SZ') continue;
    env[k] = expand(v.value); lookup.set(k.toUpperCase(), env[k]!);
  }
  // A later source's plain value wins over an earlier expandable one of the same name.
  for (const src of [logon, user]) for (const [k, v] of Object.entries(src)) if (!isPath(k)) env[k] = v.type === 'REG_SZ' ? v.value : expand(v.value);
  const path = (src: RegValues) => { const k = Object.keys(src).find(isPath); return k ? (src[k]!.type === 'REG_EXPAND_SZ' ? expand(src[k]!.value) : src[k]!.value) : ''; };
  const joined = [path(machine), path(user)].filter(Boolean).join(';');
  const baseKey = Object.keys(base).find(isPath);
  const seen = new Set(joined.split(';').map(d => d.toLowerCase()));
  const own = (baseKey ? base[baseKey] ?? '' : '').split(';').filter(d => d && !seen.has(d.toLowerCase()) && (seen.add(d.toLowerCase()), true));
  // The per-user folders Claude Code's and Codex's installers use: a fresh install is found before the user's Path has it.
  const agents = windowsAgentDirs({ USERPROFILE: lookup.get('USERPROFILE'), LOCALAPPDATA: lookup.get('LOCALAPPDATA') }).filter(d => !seen.has(d.toLowerCase()) && (seen.add(d.toLowerCase()), true));
  const full = [joined, ...own, ...agents].filter(Boolean).join(';');
  if (full) env.Path = full;
  return env;
}

/** Where the official per-user installers put Claude Code (`%USERPROFILE%\\.local\\bin`) and Codex
 *  (`%LOCALAPPDATA%\\Programs\\OpenAI\\Codex\\bin`). */
export function windowsAgentDirs(env: { USERPROFILE?: string; LOCALAPPDATA?: string }): string[] {
  return [env.USERPROFILE && win32.join(env.USERPROFILE, '.local', 'bin'), env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin')].filter((d): d is string => !!d);
}

/** `over` on top of `base`. On Windows a variable's name has no case (PATH and Path are one): `base`'s spelling of a name
 *  `over` sets is dropped, or a child would see both and take the stale one. */
export function overlayEnv(base: NodeJS.ProcessEnv, over: Record<string, string>, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const out: Record<string, string> = {};
  const overNames = new Set(Object.keys(over).map(k => (platform === 'win32' ? k.toUpperCase() : k)));
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !overNames.has(platform === 'win32' ? k.toUpperCase() : k)) out[k] = v;
  return { ...out, ...over };
}

/** The environment a fresh terminal would give the user: the registry's on Windows, the login shell's elsewhere. */
export function userEnv(platform: NodeJS.Platform = process.platform, deps: { registry?: () => Promise<Record<string, string>>; shell?: () => Promise<Record<string, string>> } = {}): Promise<Record<string, string>> {
  return platform === 'win32' ? (deps.registry ?? (() => windowsRegistryEnv()))() : (deps.shell ?? (() => loginShellEnv()))();
}
