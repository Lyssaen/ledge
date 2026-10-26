import { basename, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Autonomy, Session, Tool } from '@ledge/protocol';
import { pickName } from '@ledge/protocol';
import { paths } from './paths.js';
import type { Tmux } from './tmux.js';
import { claudeTranscriptPath } from './daemon/transcript.js';

/** The harnesses Ledge drives through a tmux pane: OMP is driven over its own protocol (daemon/omp), never typed into. */
export type TmuxTool = Exclude<Tool, 'omp'>;
export const AGENT_BIN: Record<Tool, string> = { claude: 'claude', codex: 'codex', cursor: 'cursor-agent', omp: 'omp' };

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
 * What a running Claude Code session leaves in the environment of the commands it runs. An agent launched from one
 * (`ledge claude` typed by an agent, or a daemon or tmux server started from one) would take itself for that session's
 * child: CLAUDE_CODE_CHILD_SESSION turns its transcript off, and Ledge reads the transcript. The user's own settings
 * (CLAUDE_CONFIG_DIR, CLAUDE_CODE_ENABLE_TELEMETRY...) are not in this list and pass.
 */
export const PARENT_AGENT_VARS = [
  'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_PID', 'CLAUDE_EFFORT'
] as const;
const PARENT_AGENT = new Set<string>(PARENT_AGENT_VARS);

/**
 * The agent's environment: the launching shell's (AWS_PROFILE, venv, ANTHROPIC_*, CLAUDE_CONFIG_DIR...)
 * so `ledge claude` behaves like plain `claude`, minus the launcher's own tmux variables and a launching agent's
 * (`PARENT_AGENT_VARS`), plus `extra`. Without this the pane only gets the tmux server's global environment, frozen when it started.
 */
export function agentEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  // A seat's role and team are its own: an agent it starts gets them only when Ledge gives them (`extra`).
  for (const [k, v] of Object.entries(base)) if (v !== undefined && k !== 'TMUX' && !k.startsWith('TMUX_') && !PARENT_AGENT.has(k) && k !== 'LEDGE_ROLE' && k !== 'LEDGE_TEAM') env[k] = v;
  return { ...env, ...extra };
}

export interface SpawnOptions {
  tool: TmuxTool;
  /** The agent's own arguments. */
  args: string[];
  /** Replaces the agent binary entirely (tests run a fake agent); `args` are always agent args. */
  command?: string[];
  /** Wrap the agent so its exit code lands in `exitFile(id)` (the launcher reads it after `tmux attach` returns). */
  recordExit?: boolean;
  name?: string; cwd: string; tmux: Tmux;
  /** Reuses this Ledge id (a resumed session keeps its own) instead of drawing a free one. */
  id?: string;
  /** Its role (id and label) and the live team it sits in: in the agent's environment as LEDGE_ROLE and LEDGE_TEAM, and on the record. */
  role?: { id: string; label: string }; team?: string;
  /** The role's autonomy, as its arguments were built (`autonomyArgs`): kept on the record for a resume. */
  autonomy?: Autonomy;
  /** Names and ids already in use, so the new session gets free ones. */
  taken: { names: Iterable<string>; ids: Iterable<string> };
  now?: () => string; env?: NodeJS.ProcessEnv;
}

/**
 * Creates the tmux session that runs the agent (with `LEDGE_SESSION`, `LEDGE_NAME`, and its role and team when it has them, in its environment) and returns
 * the session record in state `starting`. Shared by the terminal launcher (`ledge claude`) and the daemon's
 * `session.launch`; neither registration nor attachment happens here.
 */
export async function spawnSession(opts: SpawnOptions): Promise<Session> {
  const now = opts.now ?? (() => new Date().toISOString());
  const takenIds = new Set(opts.taken.ids);
  let id = opts.id; if (id === undefined) do id = randomBytes(2).toString('hex'); while (takenIds.has(id));
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
  await opts.tmux.newSession({ name: tmuxSession, cwd: opts.cwd, env: agentEnv(env, { LEDGE_SESSION: id, LEDGE_NAME: name, ...(opts.role ? { LEDGE_ROLE: opts.role.id } : {}), ...(opts.team ? { LEDGE_TEAM: opts.team } : {}), ...(opts.tool === 'codex' ? { [CODEX_ENV_VAR]: id } : {}) }), unset: PARENT_AGENT_VARS, command });
  const at = now();
  return { id, name, tool: opts.tool, cwd: opts.cwd, project, title: `${name} · ${project}`, tmuxSession, state: 'starting', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', ...(agentSessionId ? { agentSessionId } : {}), ...(transcriptPath ? { transcriptPath } : {}),
    ...(opts.role ? { role: opts.role.id, roleLabel: opts.role.label } : {}), ...(opts.team ? { team: opts.team } : {}), ...(opts.autonomy && opts.autonomy !== 'ask' ? { autonomy: opts.autonomy } : {}) };
}
