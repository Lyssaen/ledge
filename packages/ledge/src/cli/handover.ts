import { randomUUID } from 'node:crypto';
import { BRIEF_MAX } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const HANDOVER_USAGE = `ledge handover "<bilan>"   ton bilan de relève, quand Ledge te le demande (fait, en cours, suite, pièges, fichiers clés)
ledge handover show        relire le bilan de la session dont tu as pris la relève`;
const HANDOVER_MS = 4000;

/** The arguments of `ledge handover`, or `undefined` when they do not fit its usage. */
export function handoverArgs(args: string[]): { op: 'show' } | { op: 'brief'; text: string } | undefined {
  if (args.length === 1 && args[0] === 'show') return { op: 'show' };
  const text = args.join(' ').trim();
  if (!args.length || !text || text.length > BRIEF_MAX) return undefined;
  return { op: 'brief', text };
}

/** `ledge handover …` over an already-connected client, as session `by` (context handover spec §3.3). */
export async function handoverOnClient(client: Client, args: string[], by: string, ms: number): Promise<{ line: string; code: number }> {
  const op = handoverArgs(args);
  if (!op) return { line: HANDOVER_USAGE, code: 1 };
  try {
    const rid = randomUUID();
    client.send(op.op === 'show' ? { type: 'handover.show', rid, by } : { type: 'handover.brief', rid, by, text: op.text });
    const r = await client.next('handover.result', ms);
    if (r.reason !== undefined) return { line: `refusé : ${r.reason}`, code: 1 };
    return op.op === 'show' ? { line: r.text ?? '', code: 0 } : { line: 'bilan reçu : Ledge lance la session qui prend ta relève et lui passe tes tâches. Arrête-toi là.', code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}

/** `ledge handover …` from a session Ledge launched (its id from the environment, as `ledge task`). */
export async function runHandover(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ line: string; code: number }> {
  if (!handoverArgs(args)) return { line: HANDOVER_USAGE, code: args.length ? 1 : 0 };
  const env = opts.env ?? process.env;
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  if (!by) return { line: 'ledge handover ne marche que dans une session lancée par Ledge', code: 1 };
  const deadline = Date.now() + (opts.timeoutMs ?? HANDOVER_MS);
  const left = () => Math.max(0, deadline - Date.now());
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: left() }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await handoverOnClient(client, args, by, left()); }
  finally { await client.close(); }
}
