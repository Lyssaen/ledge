import { spawn as nodeSpawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SLASH_COMMANDS_MAX, SLASH_DESCRIPTION_MAX, type SlashCommand, type SlashSource, type Tool } from '@ledge/protocol';
import { log } from '../log.js';

/**
 * The slash commands a session's agent offers on this machine, for the chat's « / » list. Claude Code says them itself:
 * a headless `claude -p` answers the SDK's `initialize` control request with every command it would take in that folder
 * (built-ins, ~/.claude and .claude/ commands and skills, plugins), with no turn and no model call. Hooks are off and
 * nothing is saved, so the probe is never a session Ledge or `claude --resume` sees.
 */

export const COMMANDS_TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;
const STDERR_TAIL = 2000;

/**
 * Claude Code 2.1.x, seen in tmux: what opens a terminal panel. `usage` (and its aliases) always does; the others only
 * when nothing follows them (`/model opus` sets the model, `/model` opens its picker). Ledge cannot drive a panel: it
 * would stay on screen until someone presses Esc in the terminal.
 */
const CLAUDE_BLOCKED: Readonly<Record<string, 'panel'>> = { usage: 'panel', cost: 'panel', stats: 'panel', skills: 'panel', plugin: 'panel', resume: 'panel', help: 'panel', permissions: 'panel', status: 'panel', hooks: 'panel', memory: 'panel', login: 'panel', logout: 'panel', ide: 'panel' };
const CLAUDE_BARE = new Set(['model', 'config', 'settings', 'mcp', 'effort', 'advisor', 'autocompact', 'fast']);
/** Ends the session: Ledge's « Fermer » does it, and knows the session ended. */
const CLAUDE_CLOSE = new Set(['exit', 'quit']);
/** Listed by `initialize` but not for a person to type: internal, removed, or for server-launched sessions only. */
const CLAUDE_HIDDEN = new Set(['workflow-launch-exec']);

/**
 * Why Ledge does not type `text` into a Claude Code session, or null: a command that opens a terminal panel, or ends the
 * session. The first word names the command; what follows it are its arguments.
 */
export function claudeSlashRefusal(text: string): { message: string; why: 'panel' | 'bare' | 'close' } | null {
  const m = /^\/(\S+)(\s+\S[\s\S]*)?$/.exec(text.trim()); if (!m) return null;
  const name = m[1]!.toLowerCase(), args = m[2] !== undefined;
  if (CLAUDE_CLOSE.has(name)) return { message: `/${name} would end the session: close it from Ledge instead`, why: 'close' };
  if (CLAUDE_BLOCKED[name]) return { message: `/${name} opens a panel in the terminal: run it there`, why: 'panel' };
  if (CLAUDE_BARE.has(name) && !args) return { message: `/${name} without arguments opens a panel in the terminal: give it one, or run it there`, why: 'bare' };
  return null;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/** One line, at most SLASH_DESCRIPTION_MAX characters. */
function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= SLASH_DESCRIPTION_MAX ? one : `${one.slice(0, SLASH_DESCRIPTION_MAX - 1).trimEnd()}…`;
}

/**
 * `initialize`'s `commands` as Ledge's list. The source is in Claude Code's own wording of the description: `builtin`,
 * a ` (project)` or ` (user)` suffix, a `(plugin) ` prefix, ` (claude.ai sync)` for the account's skills.
 */
export function parseClaudeCommands(raw: unknown): SlashCommand[] {
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(raw) ? raw.map(obj) : []) {
    const name = str(c.name);
    if (!name || !NAME.test(name) || name.length > 200 || name.startsWith('_') || CLAUDE_HIDDEN.has(name) || seen.has(name)) continue;
    let description = str(c.description)?.trim() ?? '';
    if (/^\(removed\)|^Renamed to /i.test(description)) continue;
    let source: SlashSource;
    const plugin = /^\(([^)]+)\)\s+/.exec(description);
    if (c.builtin === true) source = 'builtin';
    else if (/\s\(project\)$/.test(description)) { source = 'project'; description = description.replace(/\s\(project\)$/, ''); }
    else if (/\s\(user\)$/.test(description)) { source = 'user'; description = description.replace(/\s\(user\)$/, ''); }
    else if (/\s\(claude\.ai sync\)$/.test(description)) { source = 'user'; description = description.replace(/\s\(claude\.ai sync\)$/, ''); }
    else if (plugin) { source = 'plugin'; description = description.slice(plugin[0].length); }
    else source = name.includes(':') ? 'plugin' : 'user';
    const aliases = (Array.isArray(c.aliases) ? c.aliases : []).filter((a): a is string => typeof a === 'string' && NAME.test(a) && a.length <= 200 && a !== name).slice(0, 10);
    const hint = str(c.argumentHint)?.trim();
    const names = [name, ...aliases].map(n => n.toLowerCase());
    const blocked = names.some(n => CLAUDE_BLOCKED[n]) ? 'panel' as const : names.some(n => CLAUDE_CLOSE.has(n)) ? 'close' as const : undefined;
    seen.add(name);
    out.push({
      name, source,
      ...(description ? { description: shorten(description) } : {}),
      ...(hint ? { argumentHint: hint.slice(0, 200) } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(blocked ? { blocked } : names.some(n => CLAUDE_BARE.has(n)) ? { bare: 'panel' as const } : {})
    });
  }
  // `/exit` is the terminal's own, absent from `initialize`: listed, so that typing it says why Ledge does not send it.
  if (!seen.has('exit')) out.push({ name: 'exit', aliases: ['quit'], source: 'builtin', description: 'Exit Claude Code', blocked: 'close' });
  return out.slice(0, SLASH_COMMANDS_MAX);
}

/** The arguments of `claude` that answer `initialize` and nothing else: no hook, no transcript, no turn. */
export const CLAUDE_PROBE_ARGS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--settings', JSON.stringify({ disableAllHooks: true })];

/** Asks a headless Claude Code in `cwd` for its commands; rejects when it cannot start, fails, or takes longer than `timeoutMs`. */
export function probeClaude(o: { bin?: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number }, spawnImpl: typeof nodeSpawn = nodeSpawn): Promise<unknown> {
  const [file = 'claude', ...pre] = o.bin ?? ['claude'];
  return new Promise((resolve, reject) => {
    let settled = false, buf = '', stderr = '';
    const child = spawnImpl(file, [...pre, ...CLAUDE_PROBE_ARGS], { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    const end = (fn: () => void) => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { child.stdin?.end(); } catch { /* already closed */ }
      if (child.exitCode === null) child.kill('SIGTERM');
      fn();
    };
    const timer = setTimeout(() => end(() => reject(new Error('timed out'))), o.timeoutMs ?? TIMEOUT_MS);
    child.on('error', e => end(() => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('not installed') : e)));
    child.on('close', code => end(() => reject(new Error(stderr.trim().split('\n').pop() || `exit ${code}`))));
    child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-STDERR_TAIL); });
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let m: Json; try { m = obj(JSON.parse(line)); } catch { continue; }
        if (m.type !== 'control_response') continue;
        const r = obj(m.response);
        if (r.request_id !== 'ledge-commands') continue;
        if (r.subtype !== 'success') { end(() => reject(new Error(str(r.error) ?? 'refused'))); return; }
        const commands = obj(r.response).commands;
        end(() => resolve(commands));
        return;
      }
    });
    child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: 'ledge-commands', request: { subtype: 'initialize' } })}\n`);
  });
}

export interface CommandsDeps {
  env?: () => Promise<NodeJS.ProcessEnv>;
  /** Claude Code's commands in a folder (the probe); replaced in tests. */ claude?: (cwd: string, env: NodeJS.ProcessEnv) => Promise<unknown>;
  claudeBin?: string[];
  /** The modification time of a path, null when it is missing: what invalidates a listing before its TTL. */ mtime?: (path: string) => Promise<number | null>;
  now?: () => number; ttlMs?: number;
}
export interface Commands { list(tool: Tool, cwd: string): Promise<{ commands: SlashCommand[]; error?: string }> }

/**
 * A listing is kept per (agent, folder) for the TTL, and dropped sooner when a folder that holds commands changes (one
 * added or removed); one probe at a time per key, and a failure is never kept.
 */
export function createCommands(deps: CommandsDeps = {}): Commands {
  const env = deps.env ?? (async () => process.env);
  const claude = deps.claude ?? ((cwd, e) => probeClaude({ ...(deps.claudeBin ? { bin: deps.claudeBin } : {}), cwd, env: e }));
  const mtime = deps.mtime ?? (p => stat(p).then(s => s.mtimeMs, () => null));
  const now = deps.now ?? Date.now, ttl = deps.ttlMs ?? COMMANDS_TTL_MS;
  const cache = new Map<string, { at: number; mark: string; commands: SlashCommand[] }>();
  const flying = new Map<string, Promise<{ commands: SlashCommand[]; error?: string }>>();

  async function mark(cwd: string, e: NodeJS.ProcessEnv): Promise<string> {
    const home = e.CLAUDE_CONFIG_DIR ?? join(e.HOME ?? homedir(), '.claude');
    const paths = [join(cwd, '.claude', 'commands'), join(cwd, '.claude', 'skills'), join(home, 'commands'), join(home, 'skills'), join(home, 'plugins', 'installed_plugins.json')];
    return (await Promise.all(paths.map(mtime))).join(',');
  }

  return {
    async list(tool, cwd) {
      if (tool !== 'claude') return { commands: [], error: 'unsupported' };
      const key = `${tool}|${cwd}`;
      const e = await env();
      const m = await mark(cwd, e);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl && hit.mark === m) return { commands: hit.commands };
      const inFlight = flying.get(key); if (inFlight) return inFlight;
      const p = claude(cwd, e)
        .then(raw => { const commands = parseClaudeCommands(raw); cache.set(key, { at: now(), mark: m, commands }); return { commands }; })
        .catch((err: Error) => { log(`session.commands ${tool} in ${cwd} failed: ${err.message}`); return { commands: [], error: err.message.slice(0, 200) }; })
        .finally(() => flying.delete(key));
      flying.set(key, p);
      return p;
    }
  };
}
