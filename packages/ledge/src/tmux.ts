import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.js';
import { log } from './log.js';

export interface Tmux {
  /** `unset`: variables the pane must not have, even from the tmux server's global environment (`-e` can only add). */
  newSession(opts: { name: string; cwd: string; env: Record<string, string>; unset?: readonly string[]; command: string[] }): Promise<void>;
  sendText(name: string, text: string): Promise<void>;
  sendKeys(name: string, keys: string[]): Promise<void>;
  /** Last `lines` lines, or null when the capture failed (distinct from an empty pane). */
  capture(name: string, lines: number): Promise<string | null>;
  /** The pane's width in columns, or null when tmux cannot tell. */
  width?(name: string): Promise<number | null>;
  /** The folder the pane's program runs in, or null when tmux cannot tell. */
  paneCwd?(name: string): Promise<string | null>;
  hasSession(name: string): Promise<boolean>;
  /** Empty when no tmux server runs; throws on any other failure. */
  listSessions(): Promise<string[]>;
  killSession(name: string): Promise<void>;
  /** Sets a user option (`@name`) on the session; the tmux conf shows `@ledge_title` as the terminal tab's title. */
  setOption(name: string, option: string, value: string): Promise<void>;
  /** `readOnly` watches the pane without sending it keys (`attach-session -r`). */
  attachArgs(name: string, opts?: { readOnly?: boolean }): string[];
  /** A control client on the session (`-C`) that only reads and never counts for the window's size: the phone's terminal. */
  controlArgs?(name: string): string[] | null;
}

export function runFile(file: string, args: string[], env?: NodeJS.ProcessEnv, opts?: { timeoutMs?: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024, env, ...(opts?.timeoutMs ? { timeout: opts.timeoutMs, killSignal: 'SIGTERM' as const } : {}) }, (err, stdout, stderr) => {
      // A killed-on-timeout child reports 124, as timeout(1) does.
      const code = err && opts?.timeoutMs && (err as { killed?: boolean }).killed ? 124 : err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const run = (args: string[], env?: NodeJS.ProcessEnv) => runFile('tmux', args, env);

/** The user manager answers on this socket: present when WSL runs systemd (`systemd=true`). */
export function systemdAvailable(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): boolean {
  return !!env.XDG_RUNTIME_DIR && exists(join(env.XDG_RUNTIME_DIR, 'systemd', 'private'));
}

/**
 * The tmux server forks from the client that starts it and stays in that client's cgroup. Started from the daemon, it
 * would sit in ledge-daemon.service and die with every restart, taking every agent with it (spec 2026-10-12 auto-update §3).
 * Scoped, the first `new-session` runs under its own transient scope, so the server outlives the daemon.
 */
export function newSessionCommand(tmuxArgs: string[], scoped: boolean, unit: string): { file: string; args: string[] } {
  if (!scoped) return { file: 'tmux', args: tmuxArgs };
  return { file: 'systemd-run', args: ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', 'tmux', ...tmuxArgs] };
}

/** `socket` null: the user's default tmux server (OpenRig's seats run there), with its own configuration. */
export function realTmux(socket: string | null = 'ledge', opts: { scope?: () => Promise<boolean> } = {}): Tmux {
  const scope = opts.scope ?? (async () => systemdAvailable());
  const base = () => (socket === null ? [] : ['-L', socket, '-f', paths().tmuxConf]);
  const t = (args: string[], env?: NodeJS.ProcessEnv) => run([...base(), ...args], env);
  return {
    async newSession({ name, cwd, env, unset = [], command }) {
      const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      if (unset.length) command = ['env', ...unset.flatMap(v => ['-u', v]), ...command];
      // tmux gives a detached session's pane the PATH of the client that created it, over `-e`: the client carries the pane's.
      const clientEnv = env.PATH === undefined ? undefined : { ...process.env, PATH: env.PATH };
      const args = [...base(), 'new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', ...envArgs, '--', ...command];
      // Only the call that starts the server needs a scope: later sessions are created by that server.
      const serverUp = (await t(['list-sessions'])).code === 0;
      const scoped = !serverUp && await scope();
      const { file, args: argv } = newSessionCommand(args, scoped, `ledge-tmux-${Date.now()}`);
      let r = await runFile(file, argv, clientEnv);
      // No scope is no reason to refuse an agent: start tmux plain (update/guard.ts then refuses updates for this server).
      if (r.code !== 0 && scoped) { log(`tmux: scoped start failed (${r.stderr.trim()}), starting unscoped`); r = await runFile('tmux', args, clientEnv); }
      if (r.code !== 0) throw new Error(`tmux new-session failed: ${r.stderr.trim()}`);
    },
    async sendText(name, text) {
      if (/[\r\n]/.test(text)) throw new Error('sendText: text must not contain newlines; flatten it first');
      // tmux treats an argv element ending in ';' as a command separator; '\;' sends a literal ';'.
      const arg = text.endsWith(';') ? `${text.slice(0, -1)}\\;` : text;
      const r = await t(['send-keys', '-t', `=${name}:`, '-l', '--', arg]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async sendKeys(name, keys) {
      const r = await t(['send-keys', '-t', `=${name}:`, ...keys]);
      if (r.code !== 0) throw new Error(`tmux send-keys failed: ${r.stderr.trim()}`);
    },
    async capture(name, lines) {
      // History included, then trimmed to exactly the last `lines` lines.
      const r = await t(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', String(-lines)]);
      if (r.code !== 0) return null;
      return r.stdout.replace(/\s+$/g, '').split('\n').slice(-lines).join('\n');
    },
    async width(name) {
      const r = await t(['display-message', '-p', '-t', `=${name}:`, '#{pane_width}']);
      const n = Number(r.stdout.trim());
      return r.code === 0 && Number.isInteger(n) && n > 0 ? n : null;
    },
    async hasSession(name) {
      return (await t(['has-session', '-t', `=${name}`])).code === 0;
    },
    async paneCwd(name) {
      const r = await t(['display-message', '-p', '-t', `=${name}:`, '#{pane_current_path}']);
      const p = r.stdout.trim();
      return r.code === 0 && p.startsWith('/') ? p : null;
    },
    async listSessions() {
      const r = await t(['list-sessions', '-F', '#{session_name}']);
      if (r.code === 0) return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
      // No server is the only failure that legitimately means "no sessions".
      if (/no server running|error connecting to/i.test(r.stderr)) return [];
      throw new Error(`tmux list-sessions failed: ${r.stderr.trim()}`);
    },
    async setOption(name, option, value) {
      const r = await t(['set-option', '-t', `=${name}:`, option, value]);
      if (r.code !== 0) throw new Error(`tmux set-option failed: ${r.stderr.trim()}`);
    },
    async killSession(name) { await t(['kill-session', '-t', `=${name}`]); },
    attachArgs(name, opts) { return [...base(), 'attach-session', ...(opts?.readOnly ? ['-r'] : []), '-t', `=${name}`]; },
    controlArgs(name) { return [...base(), '-C', 'attach-session', '-t', `=${name}`, '-f', 'ignore-size,read-only']; }
  };
}

/** An OpenRig seat's tmux session: `pod-member@rig`. Ledge names its own `ledge-<id>`, never with an `@`. */
export const isSeatSession = (name: string): boolean => name.includes('@');

/**
 * Ledge's own tmux server for its sessions, the user's default server for OpenRig's seats (docs/mockups/ledge-openrig.html,
 * view 3): each call goes to the server of the session it names. The list is both, so a seat is never taken for gone;
 * a default server that cannot be read leaves only Ledge's sessions, as before.
 */
export function routedTmux(own: Tmux, seats: Tmux): Tmux {
  const of = (name: string) => (isSeatSession(name) ? seats : own);
  return {
    newSession: o => own.newSession(o),
    sendText: (n, text) => of(n).sendText(n, text),
    sendKeys: (n, keys) => of(n).sendKeys(n, keys),
    capture: (n, lines) => of(n).capture(n, lines),
    width: async n => { const t = of(n); return t.width ? t.width(n) : null; },
    paneCwd: async n => { const t = of(n); return t.paneCwd ? t.paneCwd(n) : null; },
    hasSession: n => of(n).hasSession(n),
    async listSessions() {
      const mine = await own.listSessions();
      const theirs = await seats.listSessions().catch(() => [] as string[]);
      return [...mine, ...theirs.filter(isSeatSession)];
    },
    killSession: n => of(n).killSession(n),
    setOption: (n, option, value) => of(n).setOption(n, option, value),
    attachArgs: (n, opts) => of(n).attachArgs(n, opts),
    // Seats are refused a phone terminal (`rig`); only Ledge's own server is offered.
    controlArgs: n => (isSeatSession(n) ? null : own.controlArgs?.(n) ?? null)
  };
}
