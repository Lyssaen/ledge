import { randomUUID } from 'node:crypto';
import { ASK_OPTIONS_MAX, ASK_QUESTION_MAX } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const ASK_USAGE = 'ledge ask "<question>" "<options, ta recommandation>"   une décision pour l\'utilisateur ; sa réponse te réveille';
/** One deadline for connect and answer: Codex kills a hook after 5 s, and the hook calls this in-process. */
const ASK_MS = 4000;

/** The arguments of `ledge ask`, or `undefined` when they do not fit its usage. */
export function askArgs(args: string[]): { question: string; options: string } | undefined {
  const [question, options] = args;
  return args.length === 2 && question!.trim() && question!.length <= ASK_QUESTION_MAX && options!.length <= ASK_OPTIONS_MAX ? { question: question!, options: options! } : undefined;
}

/** `ledge ask …` over an already-connected client, as session `by`. */
export async function askOnClient(client: Client, args: string[], by: string, ms: number): Promise<{ line: string; code: number }> {
  const parsed = askArgs(args);
  if (!parsed) return { line: ASK_USAGE, code: 1 };
  try {
    client.send({ type: 'ask.create', rid: randomUUID(), by, ...parsed });
    const r = await client.next('ask.result', ms);
    if (!r.ask) return { line: `refusé : ${r.reason ?? 'raison inconnue'}`, code: 1 };
    return { line: `décision ${r.ask.id} posée à l'utilisateur : sa réponse te réveillera`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}

/** `ledge ask …` from a session Ledge launched (its id from the environment, as `ledge send`). */
export async function runAsk(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ line: string; code: number }> {
  if (!askArgs(args)) return { line: ASK_USAGE, code: 1 };
  const env = opts.env ?? process.env;
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  if (!by) return { line: 'ledge ask ne marche que dans une session lancée par Ledge', code: 1 };
  const deadline = Date.now() + (opts.timeoutMs ?? ASK_MS);
  const left = () => Math.max(0, deadline - Date.now());
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: left() }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await askOnClient(client, args, by, left()); }
  finally { await client.close(); }
}
