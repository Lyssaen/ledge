import { readFile, writeFile, mkdir, rename, realpath, rm, stat, lstat, readlink, symlink, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { ensureLedgeDir, paths } from '../paths.js';
import { tmuxServerAtRisk } from '../update/guard.js';

export const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd',
  'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop'] as const;

/** Codex CLI 0.162 hook events (~/.codex/hooks.json takes Claude Code's format), `Interrupt` being Codex's own. */
export const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop',
  'SubagentStart', 'SubagentStop', 'Interrupt', 'SessionEnd'] as const;

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };

/**
 * Appends a `<command> <Event>` entry to each event that lacks one, after any existing entry: other tools' hooks are
 * kept where they are (Codex trusts a hook by its place in the file). `file` names the file in errors.
 */
function mergeHooks(settings: unknown, events: readonly string[], command: string, file: string): { settings: object; changed: boolean } {
  if (settings === undefined) settings = {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error(`${file} root is not an object, not modified`);
  const base = settings as Record<string, unknown>;
  if (base.hooks !== undefined && (!base.hooks || typeof base.hooks !== 'object' || Array.isArray(base.hooks))) throw new Error(`${file} "hooks" is not an object, not modified`);
  const hooks = { ...((base.hooks as Record<string, HookEntry[]> | undefined) ?? {}) };
  let changed = false;
  for (const ev of events) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) throw new Error(`${file} hooks.${ev} is not an array, not modified`);
    const list = [...(hooks[ev] ?? [])];
    const mine = `${command} ${ev}`;
    if (!list.some(e => e.hooks?.some(h => h.command === mine))) {
      list.push({ hooks: [{ type: 'command', command: mine, timeout: 5 }] });
      changed = true;
    }
    hooks[ev] = list;
  }
  return { settings: { ...base, hooks }, changed };
}

export function mergeClaudeHooks(settings: unknown, command = 'ledge hook'): { settings: object; changed: boolean } {
  return mergeHooks(settings, CLAUDE_EVENTS, command, 'settings.json');
}

export function mergeCodexHooks(hooks: unknown, command = 'ledge hook codex'): { settings: object; changed: boolean } {
  return mergeHooks(hooks, CODEX_EVENTS, command, 'hooks.json');
}

/** Cursor Agent 2026.10 hooks Ledge listens to. subagentStart/subagentStop never fire there; approvals come from the pane. */
export const CURSOR_EVENTS = ['sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'stop',
  'afterAgentResponse', 'sessionEnd'] as const;

type CursorHookEntry = { command: string; timeout?: number };

/** Adds `ledge hook cursor <event>` to `~/.cursor/hooks.json` (`{ version: 1, hooks: { event: [{ command }] } }`), keeping the rest. */
export function mergeCursorHooks(config: unknown, command = 'ledge hook cursor'): { settings: object; changed: boolean } {
  if (config === undefined) config = {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('hooks.json root is not an object, not modified');
  const base = config as Record<string, unknown>;
  if (base.hooks !== undefined && (!base.hooks || typeof base.hooks !== 'object' || Array.isArray(base.hooks))) throw new Error('hooks.json "hooks" is not an object, not modified');
  const hooks = { ...((base.hooks as Record<string, CursorHookEntry[]> | undefined) ?? {}) };
  let changed = base.version === undefined;
  for (const ev of CURSOR_EVENTS) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) throw new Error(`hooks.json hooks.${ev} is not an array, not modified`);
    const list = [...(hooks[ev] ?? [])];
    const mine = `${command} ${ev}`;
    if (!list.some(e => e?.command === mine)) {
      list.push({ command: mine, timeout: 5 });
      changed = true;
    }
    hooks[ev] = list;
  }
  return { settings: { version: 1, ...base, hooks }, changed };
}

/** Reads a JSON file (undefined when missing), merges, writes it back atomically if anything changed. */
async function mergeJsonFile(path: string, merge: (current: unknown) => { settings: object; changed: boolean }, name: string): Promise<boolean> {
  let raw: string | null = null;
  try { raw = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; /* new file */ }
  let current: unknown;
  if (raw !== null) {
    try { current = JSON.parse(raw); }
    catch { throw new Error(`${name} is not valid JSON, not modified`); }
  }
  const { settings, changed } = merge(current);
  if (!changed) return false;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.ledge-${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
  await rename(tmp, path);
  return true;
}

export const SERVICE = 'ledge-daemon.service';

export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const execRunner: Runner = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, (err, stdout, stderr) => {
    const code = err && typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : err ? 1 : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr) });
  });
});

/** The systemd user unit: a stable node path (fnm shells expose a temporary one) running the built CLI. */
export function systemdUnit(opts: { node: string; script: string }): string {
  return `[Unit]
Description=Ledge daemon (agent sessions for the Windows overlay)

[Service]
ExecStart=${opts.node} ${opts.script} daemon
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

async function writeIfChanged(path: string, content: string): Promise<boolean> {
  let current: string | null = null;
  try { current = await readFile(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (current === content) return false;
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.ledge-${process.pid}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
  return true;
}

/** A daemon spawned detached by `ledge claude` holds the port: stop it so the service can take over. Returns its pid, or null. */
export async function stopDetachedDaemon(pidFile: string): Promise<number | null> {
  let pid: number;
  try { pid = Number((await readFile(pidFile, 'utf8')).trim()); } catch { return null; }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); } catch { await rm(pidFile, { force: true }); return null; }
  try { process.kill(pid, 'SIGTERM'); } catch { return null; }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
    try { process.kill(pid, 0); } catch { return pid; }
  }
  return pid;
}

/**
 * Installs and starts the systemd user service so the daemon runs from WSL boot (linger) and
 * is restarted when it crashes. Idempotent: a changed unit restarts the service, an unchanged
 * one is left alone. A restart that would kill the tmux server (hence every agent) is not done: the unit waits for it.
 */
export async function installService(opts: { unitDir?: string; node?: string; script?: string; run?: Runner; atRisk?: () => Promise<boolean> } = {}): Promise<string[]> {
  const out: string[] = [];
  const run = opts.run ?? execRunner;
  const unitDir = opts.unitDir ?? join(homedir(), '.config', 'systemd', 'user');
  const node = opts.node ?? await realpath(process.execPath);
  const script = opts.script ?? await realpath(process.argv[1]!);
  const changed = await writeIfChanged(join(unitDir, SERVICE), systemdUnit({ node, script }));
  const reload = await run('systemctl', ['--user', 'daemon-reload']);
  if (reload.code !== 0) throw new Error(`systemd user session unavailable (systemctl --user daemon-reload failed: ${reload.stderr.trim() || reload.code}); the daemon will still be started on demand by ledge claude`);
  const active = (await run('systemctl', ['--user', 'is-active', SERVICE])).code === 0;
  if (active && changed && await (opts.atRisk ?? tmuxServerAtRisk)()) {
    out.push(`${SERVICE} unit updated but not restarted: the tmux server of your agents runs inside the service and would stop with it; close the sessions, then run ledge setup again (or systemctl --user restart ${SERVICE})`);
  } else if (active && changed) {
    const r = await run('systemctl', ['--user', 'restart', SERVICE]);
    if (r.code !== 0) throw new Error(`systemctl --user restart ${SERVICE} failed: ${r.stderr.trim()}`);
    out.push(`${SERVICE} updated and restarted`);
  } else if (active) {
    out.push(`${SERVICE} already running`);
  } else {
    const pid = await stopDetachedDaemon(paths().pid);
    if (pid !== null) out.push(`detached daemon (pid ${pid}) stopped, the service takes over`);
    const r = await run('systemctl', ['--user', 'enable', '--now', SERVICE]);
    if (r.code !== 0) throw new Error(`systemctl --user enable --now ${SERVICE} failed: ${r.stderr.trim()}`);
    out.push(`${SERVICE} installed and started (journalctl --user -u ${SERVICE} for its output)`);
  }
  const user = process.env.USER ?? userInfo().username;
  const linger = await run('loginctl', ['show-user', user, '-p', 'Linger']);
  if (linger.code === 0 && /^Linger=yes/m.test(linger.stdout)) return out;
  const enable = await run('loginctl', ['enable-linger']);
  if (enable.code === 0) out.push('linger enabled: the daemon starts with WSL, before any shell is open');
  else out.push(`linger not enabled (${enable.stderr.trim() || `exit ${enable.code}`}): the daemon starts with your first WSL shell; run \`sudo loginctl enable-linger ${user}\` to start it at WSL boot`);
  return out;
}

export async function isDir(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/** `~/.local/bin/ledge` from the README's clone install: once npm installed Ledge, it must follow, or hooks run the clone. */
export async function relinkBin(opts: { link: string; target: string }): Promise<string | null> {
  const st = await lstat(opts.link).catch(() => null);
  if (!st?.isSymbolicLink()) return null;
  const current = await readlink(opts.link);
  if (current === opts.target || !current.endsWith('/dist/cli/index.js')) return null;
  await unlink(opts.link);
  await symlink(opts.target, opts.link);
  return `${opts.link} now points to ${opts.target} (was ${current})`;
}

/** `codexDir` and `cursorDir` are the agents' config folders: their hooks are wired only where the folder exists. */
export async function runSetup(opts: { settingsPath?: string; codexDir?: string; cursorDir?: string; service?: boolean } = {}): Promise<string[]> {
  const out: string[] = [];
  await ensureLedgeDir();
  out.push('~/.ledge ready (tmux.conf written if missing)');
  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  if (await mergeJsonFile(settingsPath, mergeClaudeHooks, 'settings.json')) out.push(`Claude Code hooks added in ${settingsPath}`);
  else out.push('Claude Code hooks already present');
  const codexDir = opts.codexDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex');
  if (!(await isDir(codexDir))) out.push(`Codex not found (${codexDir} missing), Codex hooks skipped`);
  else if (await mergeJsonFile(join(codexDir, 'hooks.json'), mergeCodexHooks, 'hooks.json')) {
    out.push(`Codex hooks added in ${join(codexDir, 'hooks.json')}; Codex asks to review them on its next start: trust them there or from Ledge`);
  } else out.push('Codex hooks already present');
  const cursorDir = opts.cursorDir ?? join(homedir(), '.cursor');
  if (!(await isDir(cursorDir))) out.push(`Cursor Agent not found (${cursorDir} missing), Cursor Agent hooks skipped`);
  else if (await mergeJsonFile(join(cursorDir, 'hooks.json'), mergeCursorHooks, 'hooks.json')) out.push(`Cursor Agent hooks added in ${join(cursorDir, 'hooks.json')}`);
  else out.push('Cursor Agent hooks already present');
  // Like the service below, this edits the machine outside the agents' config: tests that pass `service: false` skip it.
  if ((opts.service ?? true) && !process.argv[1]?.endsWith('.ts')) {
    const line = await relinkBin({ link: join(homedir(), '.local', 'bin', 'ledge'), target: await realpath(process.argv[1]!) });
    if (line) out.push(line);
  }
  if (opts.service ?? true) {
    if (process.argv[1]?.endsWith('.ts')) out.push('systemd service skipped: run setup from the built CLI (pnpm --filter @paradow/ledge build, then ledge setup)');
    else out.push(...await installService());
  }
  return out;
}
