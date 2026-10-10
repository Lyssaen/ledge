import { readFile, writeFile, mkdir, rename, realpath, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { ensureLedgeDir, paths } from '../paths.js';

export const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd',
  'PostToolUse', 'PostToolUseFailure', 'StopFailure', 'SubagentStart', 'SubagentStop'] as const;

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> };

export function mergeClaudeHooks(settings: unknown, command = 'ledge hook'): { settings: object; changed: boolean } {
  if (settings === undefined) settings = {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings.json root is not an object, not modified');
  const base = settings as Record<string, unknown>;
  if (base.hooks !== undefined && (!base.hooks || typeof base.hooks !== 'object' || Array.isArray(base.hooks))) throw new Error('settings.json "hooks" is not an object, not modified');
  const hooks = { ...((base.hooks as Record<string, HookEntry[]> | undefined) ?? {}) };
  let changed = false;
  for (const ev of CLAUDE_EVENTS) {
    if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) throw new Error(`settings.json hooks.${ev} is not an array, not modified`);
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

export const SERVICE = 'ledge-daemon.service';

type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const execRunner: Runner = (cmd, args) => new Promise(resolve => {
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
async function stopDetachedDaemon(pidFile: string): Promise<number | null> {
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
 * one is left alone.
 */
export async function installService(opts: { unitDir?: string; node?: string; script?: string; run?: Runner } = {}): Promise<string[]> {
  const out: string[] = [];
  const run = opts.run ?? execRunner;
  const unitDir = opts.unitDir ?? join(homedir(), '.config', 'systemd', 'user');
  const node = opts.node ?? await realpath(process.execPath);
  const script = opts.script ?? await realpath(process.argv[1]!);
  const changed = await writeIfChanged(join(unitDir, SERVICE), systemdUnit({ node, script }));
  const reload = await run('systemctl', ['--user', 'daemon-reload']);
  if (reload.code !== 0) throw new Error(`systemd user session unavailable (systemctl --user daemon-reload failed: ${reload.stderr.trim() || reload.code}); the daemon will still be started on demand by ledge claude`);
  const active = (await run('systemctl', ['--user', 'is-active', SERVICE])).code === 0;
  if (active && changed) {
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

export async function runSetup(opts: { settingsPath?: string; service?: boolean } = {}): Promise<string[]> {
  const out: string[] = [];
  await ensureLedgeDir();
  out.push('~/.ledge ready (tmux.conf written if missing)');
  const settingsPath = opts.settingsPath ?? join(homedir(), '.claude', 'settings.json');
  let current: unknown = {};
  let raw: string | null = null;
  try { raw = await readFile(settingsPath, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; /* new file */ }
  if (raw !== null) {
    try { current = JSON.parse(raw); }
    catch { throw new Error('settings.json is not valid JSON, not modified'); }
  }
  const { settings, changed } = mergeClaudeHooks(current);
  if (changed) {
    await mkdir(dirname(settingsPath), { recursive: true });
    const tmp = `${settingsPath}.ledge-${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
    await rename(tmp, settingsPath);
    out.push(`Claude Code hooks added in ${settingsPath}`);
  } else out.push('Claude Code hooks already present');
  if (opts.service ?? true) {
    if (process.argv[1]?.endsWith('.ts')) out.push('systemd service skipped: run setup from the built CLI (pnpm --filter ledge build, then ledge setup)');
    else out.push(...await installService());
  }
  return out;
}
