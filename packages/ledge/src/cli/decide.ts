import { randomUUID } from 'node:crypto';
import { ASK_ANSWER_MAX } from '@ledge/protocol';
import { connect } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const DECIDE_USAGE = `ledge decide                       les décisions que les sessions attendent de toi
ledge decide <id> "<réponse>"      y répondre : la session qui l'a demandée reprend`;
const ID = /^a[0-9a-f]{6}$/;
const DECIDE_MS = 4000;

/** The arguments of `ledge decide`, or `undefined` when they do not fit its usage. */
export function decideArgs(args: string[]): { op: 'list' } | { op: 'answer'; id: string; text: string } | undefined {
  if (!args.length) return { op: 'list' };
  const [id, text] = args;
  return args.length === 2 && ID.test(id!) && text!.trim() && text!.length <= ASK_ANSWER_MAX ? { op: 'answer', id: id!, text: text! } : undefined;
}

/** `ledge decide`: the user answers the decisions sessions asked (`ledge ask`). Never from a session. */
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
      const open = (await client.next('asks', DECIDE_MS)).asks.filter(a => a.state === 'open');
      if (!open.length) return { line: 'aucune décision en attente', code: 0 };
      return { line: open.map(a => [`${a.id}  de ${a.fromName}  ${a.question}`, ...(a.options ? a.options.split('\n').map(l => `    ${l}`) : [])].join('\n')).join('\n\n'), code: 0 };
    }
    client.send({ type: 'ask.answer', rid: randomUUID(), id: op.id, text: op.text });
    const r = await client.next('ask.result', DECIDE_MS);
    if (!r.ask) return { line: `refusé : ${r.reason ?? 'raison inconnue'}`, code: 1 };
    return { line: `réponse envoyée à ${r.ask.fromName}`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
