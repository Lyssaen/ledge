import { randomUUID } from 'node:crypto';
import { actionById, type ActionId, type ServerMessage } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';
import { SESSION_KEY_VAR } from '../auth.js';

// The CLI's side of the action registry (#93): argv parsed against `ACTIONS[id].args`, then `action.run`; the daemon resolves
// and applies it as it does a chat card's row, so no rule is written here.

export const CLOSE_USAGE = 'ledge close <session>… [--json]                 fermer proprement des sessions (leur conversation reste reprenable)';
export const DAEMON_DOWN = 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)';
/** A deadline, not a delay: a clean close waits for the prompt, then for the exit. */
export const RUN_MS = 60_000;

export type ActionResult = Omit<Extract<ServerMessage, { type: 'action.result' }>, 'type' | 'rid'>;

/** The args of an action as the registry parses them, or `undefined` when they do not fit. */
export function actionArgs(id: ActionId, args: Record<string, unknown>): Record<string, unknown> | undefined {
  const parsed = actionById(id)!.args.safeParse(args);
  return parsed.success ? args : undefined;
}

/** A session running the command: its id and the key Ledge gave it (`SESSION_KEY_VAR`), for the daemon to check. */
export interface Caller { by: string; key?: string }
/** The session that runs the command (its id from the environment, as `ledge send`), or `undefined` for the user's own terminal. */
export function callerOf(env: NodeJS.ProcessEnv): Caller | undefined {
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  const key = env[SESSION_KEY_VAR];
  return by ? { by, ...(key ? { key } : {}) } : undefined;
}

/** One `action.run` over a connected client, answered by its `action.result`. */
export async function runOnClient(client: Client, action: ActionId, args: Record<string, unknown>, opts: { by?: Caller; confirmed?: boolean; ms?: number } = {}): Promise<ActionResult> {
  const rid = randomUUID();
  const by = opts.by;
  client.send({ type: 'action.run', rid, action, args, ...(by ? { by: by.by, ...(by.key ? { key: by.key } : {}) } : {}), ...(opts.confirmed ? { confirmed: true as const } : {}) });
  const deadline = Date.now() + (opts.ms ?? RUN_MS);
  for (;;) {
    const { type: _t, rid: got, ...r } = await client.next('action.result', Math.max(0, deadline - Date.now()));
    if (got === rid) return r;
  }
}

const plain = (s: string) => s.replace(/\*\*/g, '');

/** An action's outcome for a terminal (one line, or two with a template's path), or for an agent (`json`: one JSON line). */
export function resultLine(r: ActionResult, json = false): { line: string; code: number } {
  const ok = r.reason === undefined;
  if (json) return { line: JSON.stringify({ ok, ...r }), code: ok ? 0 : 1 };
  if (ok) return { line: [`fait : ${plain(r.row?.summary ?? r.action)}`, ...(r.path ? [`modèle écrit : ${r.path}`] : [])].join('\n'), code: 0 };
  if (r.code === 'confirm_required') return { line: `${plain(r.row?.summary ?? r.action)} : irréversible ; relance avec --yes pour confirmer`, code: 1 };
  return { line: `${r.code === 'failed' ? 'échec' : 'refusé'} : ${r.reason}`, code: 1 };
}

/** The arguments of `ledge close`, or `undefined` when they do not fit its usage. */
export function closeArgs(args: string[]): { sessions: string[]; json?: true } | undefined {
  const json = args.includes('--json');
  const sessions = args.filter(a => a !== '--json');
  if (!sessions.length || sessions.some(s => s.startsWith('--') || !actionArgs('session.close', { session: s }))) return undefined;
  return { sessions, ...(json ? { json: true as const } : {}) };
}

/** `ledge close <session>…`: each session closed cleanly, one after the other; stops at the first that cannot be. */
export async function runClose(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const parsed = closeArgs(args);
  if (!parsed) return { line: CLOSE_USAGE, code: args.length ? 1 : 0 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  const by = callerOf(opts.env ?? process.env);
  const lines: string[] = [];
  try {
    for (const session of parsed.sessions) {
      const r = resultLine(await runOnClient(client, 'session.close', { session }, { by }), parsed.json);
      lines.push(r.line);
      if (r.code) return { line: lines.join('\n'), code: 1 };
    }
    return { line: lines.join('\n'), code: 0 };
  } catch (e) {
    return { line: [...lines, `pas de réponse de Ledge : ${(e as Error).message}`].join('\n'), code: 1 };
  } finally { await client.close(); }
}
