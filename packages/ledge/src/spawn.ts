import { basename, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Session, Tool } from '@ledge/protocol';
import { pickName } from '@ledge/protocol';
import { paths } from './paths.js';
import type { Tmux } from './tmux.js';
import { claudeTranscriptPath } from './daemon/transcript.js';

export const AGENT_BIN: Record<Tool, string> = { claude: 'claude', codex: 'codex', cursor: 'cursor-agent' };

/**
 * How a Codex hook learns its Ledge session. Codex runs hooks either inside the `codex` process (they get its
 * environment: `LEDGE_CODEX_SESSION`) or in a shared app-server daemon, which keeps the environment of whichever `codex`
 * started it and so names the wrong session; there a per-thread config override sets `LEDGE_CODEX_HOOK_SESSION` for
 * this session's hooks only. The hook trusts the environment variable only outside the daemon (see `codexLedgeId`).
 */
export const CODEX_ENV_VAR = 'LEDGE_CODEX_SESSION';
export const CODEX_HOOK_VAR = 'LEDGE_CODEX_HOOK_SESSION';

/** Extra agent arguments naming the session for its hooks (see `CODEX_HOOK_VAR`). */
export function agentIdArgs(tool: Tool, id: string): string[] {
  return tool === 'codex' ? ['-c', `shell_environment_policy.set.${CODEX_HOOK_VAR}="${id}"`] : [];
}

/** Claude Code arguments that pick the conversation themselves: Ledge then names none. */
const CLAUDE_OWN_SESSION = /^(--resume|-r|--continue|-c|--session-id|--fork-session)(=|$)/;
/** Claude Code started fresh gets its session id from Ledge, so its transcript is known even without hooks. */
export function claudeSessionId(tool: Tool, args: string[]): string | undefined {
  return tool === 'claude' && !args.some(a => CLAUDE_OWN_SESSION.test(a)) ? randomUUID() : undefined;
}

/** Where the wrapped agent leaves its exit code (see `spawnSession`'s `recordExit`). */
export function exitFile(id: string): string { return join(paths().dir, `exit-${id}`); }

/**
 * The agent's environment: the launching shell's (AWS_PROFILE, venv, ANTHROPIC_*, CLAUDE_CONFIG_DIR...)
 * so `ledge claude` behaves like plain `claude`, minus the launcher's own tmux variables, plus `extra`.
 * Without this the pane only gets the tmux server's global environment, frozen when it started.
 */
export function agentEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && k !== 'TMUX' && !k.startsWith('TMUX_')) env[k] = v;
  return { ...env, ...extra };
}

export interface SpawnOptions {
  tool: Tool;
  /** The agent's own arguments. */
  args: string[];
  /** Replaces the agent binary entirely (tests run a fake agent); `args` are always agent args. */
  command?: string[];
  /** Wrap the agent so its exit code lands in `exitFile(id)` (the launcher reads it after `tmux attach` returns). */
  recordExit?: boolean;
  name?: string; cwd: string; tmux: Tmux;
  /** Names and ids already in use, so the new session gets free ones. */
  taken: { names: Iterable<string>; ids: Iterable<string> };
  now?: () => string; env?: NodeJS.ProcessEnv;
}

/**
 * Creates the tmux session that runs the agent (with `LEDGE_SESSION` and `LEDGE_NAME` in its environment) and returns
 * the session record in state `starting`. Shared by the terminal launcher (`ledge claude`) and the daemon's
 * `session.launch`; neither registration nor attachment happens here.
 */
export async function spawnSession(opts: SpawnOptions): Promise<Session> {
  const now = opts.now ?? (() => new Date().toISOString());
  const takenIds = new Set(opts.taken.ids);
  let id: string; do id = randomBytes(2).toString('hex'); while (takenIds.has(id));
  const name = pickName(opts.taken.names, opts.name);
  const project = basename(opts.cwd) || opts.cwd;
  const tmuxSession = `ledge-${id}`;
  const agentSessionId = opts.command ? undefined : claudeSessionId(opts.tool, opts.args);
  const agent = opts.command ?? [AGENT_BIN[opts.tool], ...agentIdArgs(opts.tool, id), ...(agentSessionId ? ['--session-id', agentSessionId] : []), ...opts.args];
  const env = opts.env ?? process.env;
  const transcriptPath = agentSessionId ? claudeTranscriptPath(opts.cwd, agentSessionId, env) : undefined;
  // With recordExit, sh runs the agent with its argv untouched ("$@") and writes its exit code to
  // the file passed as $0, so the session can die naturally and the code is still readable.
  const command = opts.recordExit ? ['sh', '-c', '"$@"; echo $? > "$0"', exitFile(id), ...agent] : agent;
  await opts.tmux.newSession({ name: tmuxSession, cwd: opts.cwd, env: agentEnv(env, { LEDGE_SESSION: id, LEDGE_NAME: name, ...(opts.tool === 'codex' ? { [CODEX_ENV_VAR]: id } : {}) }), command });
  const at = now();
  return { id, name, tool: opts.tool, cwd: opts.cwd, project, title: `${name} · ${project}`, tmuxSession, state: 'starting', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...(agentSessionId ? { agentSessionId } : {}), ...(transcriptPath ? { transcriptPath } : {}) };
}
