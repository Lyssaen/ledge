import { randomUUID } from 'node:crypto';
import { ASK_ANSWER_MAX, LEDGE_GIVER, TASK_TEXT_MAX } from '@ledge/protocol';
import { connect } from '../client.js';
import { runOnClient } from './action.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const DECIDE_USAGE = `ledge decide                       les décisions que les sessions attendent de toi
ledge decide <id> "<réponse>"      y répondre : la session qui l'a demandée reprend`;
/** An ask's id (`ledge ask`, a lone session) or a task's (`ledge task give ledge …`, a team seat): the prefix routes the answer. */
const ASK_ID = /^a[0-9a-f]{6}$/;
const TASK_ID = /^t[0-9a-f]{6}$/;
const DECIDE_MS = 4000;

/** The arguments of `ledge decide`, or `undefined` when they do not fit its usage. */
export function decideArgs(args: string[]): { op: 'list' } | { op: 'answer'; id: string; text: string } | { op: 'done'; task: string; text: string } | undefined {
  if (!args.length) return { op: 'list' };
  const [id, text] = args;
  if (args.length !== 2 || !text!.trim()) return undefined;
  if (ASK_ID.test(id!)) return text!.length <= ASK_ANSWER_MAX ? { op: 'answer', id: id!, text: text! } : undefined;
  if (TASK_ID.test(id!)) return text!.length <= TASK_TEXT_MAX ? { op: 'done', task: id!, text: text! } : undefined;
  return undefined;
}

/** `ledge decide`: the user answers the decisions sessions asked: a lone session's (`ledge ask`) and, as Ledge, a seat's
 *  (`ledge task give ledge …`). Never from a session. */
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
      // The asks come with the snapshot; the decisions given to Ledge are listed on request.
      const open = (await client.next('asks', DECIDE_MS)).asks.filter(a => a.state === 'open');
      client.send({ type: 'task.cmd', rid: randomUUID(), by: LEDGE_GIVER, op: 'list' });
      const asked = ((await client.next('task.result', DECIDE_MS)).tasks ?? []).filter(t => t.owner === LEDGE_GIVER);
      const lines = [
        ...open.map(a => [`${a.id}  de ${a.fromName}  ${a.question}`, ...(a.options ? a.options.split('\n').map(l => `    ${l}`) : [])].join('\n')),
        ...asked.map(t => [`${t.id}  de ${t.giverName}  ${t.title}`, ...(t.text ? t.text.split('\n').map(l => `    ${l}`) : [])].join('\n'))
      ];
      if (!lines.length) return { line: 'aucune décision en attente', code: 0 };
      return { line: lines.join('\n\n'), code: 0 };
    }
    if (op.op === 'answer') {
      client.send({ type: 'ask.answer', rid: randomUUID(), id: op.id, text: op.text });
      const r = await client.next('ask.result', DECIDE_MS);
      if (!r.ask) return { line: `refusé : ${r.reason ?? 'raison inconnue'}`, code: 1 };
      return { line: `réponse envoyée à ${r.ask.fromName}`, code: 0 };
    }
    // The one way a task's answer goes (task.answer, as the chat's card): typed here by the user, so confirmed.
    const r = await runOnClient(client, 'task.answer', { task: op.task, answer: op.text }, { confirmed: true, ms: DECIDE_MS });
    if (r.reason !== undefined) return { line: `refusé : ${r.reason}`, code: 1 };
    return { line: `réponse envoyée à ${r.row?.vars?.session ?? 'la session'}`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
