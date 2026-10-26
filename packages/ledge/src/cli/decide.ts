import { randomUUID } from 'node:crypto';
import { LEDGE_GIVER, TASK_TEXT_MAX } from '@ledge/protocol';
import { connect } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const DECIDE_USAGE = `ledge decide                       les décisions que les sessions attendent de toi
ledge decide <id> "<réponse>"      y répondre : la session qui l'a demandée reprend`;
const ID = /^t[0-9a-f]{6}$/;
const DECIDE_MS = 4000;

/** The arguments of `ledge decide`, or `undefined` when they do not fit its usage. */
export function decideArgs(args: string[]): { op: 'list' } | { op: 'done'; task: string; text: string } | undefined {
  if (!args.length) return { op: 'list' };
  const [id, text] = args;
  return args.length === 2 && ID.test(id!) && text!.trim() && text!.length <= TASK_TEXT_MAX ? { op: 'done', task: id!, text: text! } : undefined;
}

/** `ledge decide`: the user answers, as Ledge, the decisions sessions gave it (`ledge task give ledge …`). Never from a session. */
export async function runDecide(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const op = decideArgs(args);
  if (!op) return { line: DECIDE_USAGE, code: 1 };
  const env = opts.env ?? process.env;
  if (env.LEDGE_SESSION || env[CODEX_HOOK_VAR]) return { line: "refusé : ledge decide est la réponse de l'utilisateur, pas celle d'une session", code: 1 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: DECIDE_MS }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try {
    if (op.op === 'list') {
      client.send({ type: 'task.cmd', rid: randomUUID(), by: LEDGE_GIVER, op: 'list' });
      const asked = ((await client.next('task.result', DECIDE_MS)).tasks ?? []).filter(t => t.owner === LEDGE_GIVER);
      if (!asked.length) return { line: 'aucune décision en attente', code: 0 };
      return { line: asked.map(t => [`${t.id}  de ${t.giverName}  ${t.title}`, ...(t.text ? t.text.split('\n').map(l => `    ${l}`) : [])].join('\n')).join('\n\n'), code: 0 };
    }
    client.send({ type: 'task.cmd', rid: randomUUID(), by: LEDGE_GIVER, op: 'done', task: op.task, text: op.text });
    const r = await client.next('task.result', DECIDE_MS);
    if (r.reason !== undefined) return { line: `refusé : ${r.reason}`, code: 1 };
    return { line: `réponse envoyée à ${r.task!.giverName}`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
