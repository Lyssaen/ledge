import { readFile, writeFile, rename, rm, lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../paths.js';
import { SERVICE, execRunner, stopDetachedDaemon, type Runner } from './setup.js';

/** Every command `ledge setup` ever wired, whatever the event: `ledge hook <Event>`, `ledge hook codex|cursor <event>`. */
const LEDGE_HOOK = /^ledge hook (?:(?:codex|cursor) )?[A-Za-z]+$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Drops Ledge's entries, and the event lists and `hooks` object they leave empty; everything else stays as it was. */
function prune(config: unknown, file: string, keep: (entry: unknown) => unknown): { settings: unknown; removed: number } {
  if (!isObject(config)) throw new Error(`${file} root is not an object, not modified`);
  if (config.hooks === undefined) return { settings: config, removed: 0 };
  if (!isObject(config.hooks)) throw new Error(`${file} "hooks" is not an object, not modified`);
  const hooks: Record<string, unknown[]> = {};
  let removed = 0;
  for (const [ev, list] of Object.entries(config.hooks)) {
    if (!Array.isArray(list)) throw new Error(`${file} hooks.${ev} is not an array, not modified`);
    const kept: unknown[] = [];
    for (const entry of list) {
      const next = keep(entry);
      if (next === null) removed++;
      else { if (next !== entry) removed++; kept.push(next); }
    }
    if (kept.length || !list.length) hooks[ev] = kept;
  }
  const { hooks: _drop, ...rest } = config;
  return { settings: Object.keys(hooks).length ? { ...rest, hooks } : rest, removed };
}

/**
 * Claude Code and Codex: `{ hooks: { Event: [{ matcher?, hooks: [{ command }] }] } }`. A group holding only Ledge's
 * command goes; a group shared with another tool keeps the other commands.
 */
export function removeClaudeHooks(settings: unknown, file = 'settings.json'): { settings: unknown; removed: number } {
  return prune(settings, file, entry => {
    if (!isObject(entry) || !Array.isArray(entry.hooks)) return entry;
    const others = entry.hooks.filter(h => !(isObject(h) && typeof h.command === 'string' && LEDGE_HOOK.test(h.command)));
    if (others.length === entry.hooks.length) return entry;
    return others.length ? { ...entry, hooks: others } : null;
  });
}

/** Cursor Agent: `{ version: 1, hooks: { event: [{ command }] } }`. */
export function removeCursorHooks(config: unknown): { settings: unknown; removed: number } {
  return prune(config, 'hooks.json', entry => isObject(entry) && typeof entry.command === 'string' && LEDGE_HOOK.test(entry.command) ? null : entry);
}

/** Rewrites a JSON file without Ledge's hooks, atomically, only when something was removed. Returns that count. */
async function pruneJsonFile(path: string, remove: (current: unknown) => { settings: unknown; removed: number }, name: string): Promise<number | null> {
  let raw: string;
  try { raw = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  let current: unknown;
  try { current = JSON.parse(raw); } catch { throw new Error(`${name} is not valid JSON, not modified`); }
  const { settings, removed } = remove(current);
  if (!removed) return 0;
  const tmp = `${path}.ledge-${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + '\n');
  await rename(tmp, path);
  return removed;
}

/** Stops and removes the systemd user service, then any daemon `ledge claude` started on its own. */
export async function removeService(opts: { unitDir?: string; run?: Runner; pidFile?: string } = {}): Promise<string[]> {
  const out: string[] = [];
  const run = opts.run ?? execRunner;
  const unit = join(opts.unitDir ?? join(homedir(), '.config', 'systemd', 'user'), SERVICE);
  let present = true;
  try { await lstat(unit); } catch { present = false; }
  if (present) {
    const r = await run('systemctl', ['--user', 'disable', '--now', SERVICE]);
    if (r.code !== 0) out.push(`systemctl --user disable --now ${SERVICE} failed (${r.stderr.trim() || `exit ${r.code}`}), removing the unit anyway`);
    await rm(unit, { force: true });
    await run('systemctl', ['--user', 'daemon-reload']);
    out.push(`${SERVICE} stopped and removed`);
  } else out.push(`${SERVICE} not installed`);
  const pid = await stopDetachedDaemon(opts.pidFile ?? paths().pid);
  if (pid !== null) out.push(`detached daemon (pid ${pid}) stopped`);
  return out;
}

/** Sessions still on Ledge's tmux server are the user's work: they are reported, never killed. */
async function runningSessions(run: Runner, socket: string): Promise<number> {
  const r = await run('tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}']);
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean).length : 0;
}

/** Removes `link` only when it is a symlink to this very CLI: a `ledge` installed some other way is not ours to delete. */
async function removeLink(link: string, script: string): Promise<boolean> {
  try {
    if (!(await lstat(link)).isSymbolicLink()) return false;
    if (await realpath(link) !== await realpath(script)) return false;
  } catch { return false; }
  await rm(link, { force: true });
  return true;
}

export interface UninstallOptions {
  purge?: boolean;
  settingsPath?: string;
  codexDir?: string;
  cursorDir?: string;
  service?: boolean;
  unitDir?: string;
  run?: Runner;
  link?: string;
  script?: string;
  tmuxSocket?: string;
}

/**
 * Undoes `ledge setup`: Ledge's hooks out of every agent's config (the rest untouched), the service stopped and
 * removed, the `ledge` link gone. `~/.ledge` (journal, log) stays unless `purge`. Linger is left as it is: other user
 * services may rely on it. Each step runs even when another fails; the failures are listed and make `ok` false.
 */
export async function runUninstall(opts: UninstallOptions = {}): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let ok = true;
  const step = async (f: () => Promise<void>) => { try { await f(); } catch (e) { ok = false; lines.push(`error: ${(e as Error).message}`); } };
  const run = opts.run ?? execRunner;

  const files: Array<[string, string, (c: unknown) => { settings: unknown; removed: number }]> = [
    ['Claude Code', opts.settingsPath ?? join(homedir(), '.claude', 'settings.json'), c => removeClaudeHooks(c, 'settings.json')],
    ['Codex', join(opts.codexDir ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'hooks.json'), c => removeClaudeHooks(c, 'hooks.json')],
    ['Cursor Agent', join(opts.cursorDir ?? join(homedir(), '.cursor'), 'hooks.json'), removeCursorHooks]
  ];
  for (const [agent, path, remove] of files) {
    await step(async () => {
      const n = await pruneJsonFile(path, remove, `${agent} ${path}`);
      lines.push(n === null ? `${agent}: ${path} missing, nothing to remove` : n ? `${agent}: ${n} Ledge hook${n > 1 ? 's' : ''} removed from ${path}` : `${agent}: no Ledge hook in ${path}`);
    });
  }

  if (opts.service ?? true) await step(async () => { lines.push(...await removeService({ unitDir: opts.unitDir, run })); });

  await step(async () => {
    const n = await runningSessions(run, opts.tmuxSocket ?? 'ledge');
    if (n) lines.push(`${n} session${n > 1 ? 's' : ''} still running on Ledge's tmux server, left alone: \`tmux -L ${opts.tmuxSocket ?? 'ledge'} kill-server\` ends ${n > 1 ? 'them' : 'it'}`);
  });

  const dir = paths().dir;
  if (opts.purge) await step(async () => { await rm(dir, { recursive: true, force: true }); lines.push(`${dir} removed`); });
  else lines.push(`${dir} kept (session journal and log): \`ledge uninstall --purge\` removes it`);

  const script = opts.script ?? process.argv[1];
  const link = opts.link ?? join(homedir(), '.local', 'bin', 'ledge');
  if (script) await step(async () => { if (await removeLink(link, script)) lines.push(`${link} removed`); });

  lines.push(ok ? 'Ledge is uninstalled from WSL. On Windows: Settings > Apps > Installed apps > Ledge > Uninstall.' : 'Uninstall finished with errors, see above.');
  return { lines, ok };
}
