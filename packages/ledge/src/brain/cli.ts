// `ledge brain propose` and `ledge brain flag` (brain spec §3.6): a session proposes, the user decides. Each is a decision put
// to the user (`ledge decide`, « À toi » on every front); its answer comes back to the session as a task done.
import { randomUUID } from 'node:crypto';
import { BrainProposalSchema, LEDGE_GIVER, type BrainProposal } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

export const BRAIN_WRITE_USAGE = `ledge brain propose <nom|new:<nom>> "<fait>" ["<comment tu le sais>"]   proposer un fait durable pour une note (l'utilisateur valide)
ledge brain flag <nom> "<ce qui ne va pas>"                                signaler une note fausse ou périmée (l'utilisateur valide)`;
const BRAIN_MS = 4000;

/** The proposal `ledge brain propose|flag …` makes, or a usage line. */
export function brainWriteArgs(args: string[]): BrainProposal | string {
  const [op, target, fact, source, ...rest] = args;
  if ((op !== 'propose' && op !== 'flag') || !target || !fact || rest.length || (op === 'flag' && source !== undefined)) return BRAIN_WRITE_USAGE;
  const create = target.startsWith('new:');
  const p = BrainProposalSchema.safeParse({ kind: op === 'propose' ? 'add' : 'flag', note: create ? target.slice(4) : target, ...(create ? { create: true } : {}), fact, ...(source?.trim() ? { source } : {}) });
  if (!p.success) return `refusé : ${p.error.issues[0]?.path.join('.') === 'note' ? 'un nom de note en lettres, chiffres, « . », « _ » et « - »' : 'un fait de 500 caractères au plus, une source de 300'}\n${BRAIN_WRITE_USAGE}`;
  return p.data;
}

/** Sends the proposal as session `by` on `client`, and says what happens next. */
export async function brainWriteOnClient(client: Client, args: string[], by: string, ms: number): Promise<{ line: string; code: number }> {
  const p = brainWriteArgs(args);
  if (typeof p === 'string') return { line: p, code: 1 };
  if (by === LEDGE_GIVER) return { line: 'refusé : une proposition vient d\'une session', code: 1 };
  try {
    client.send({ type: 'task.cmd', rid: randomUUID(), by, op: 'give', to: LEDGE_GIVER, brain: p });
    const r = await client.next('task.result', ms);
    if (r.reason !== undefined) return { line: `refusé : ${r.reason}`, code: 1 };
    return { line: `proposition ${r.task!.id} posée à l'utilisateur : rien n'est écrit avant son « oui », sa réponse t'arrivera comme une tâche terminée`, code: 0 };
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}

/** `ledge brain propose|flag …` from a session's shell. */
export async function runBrainWrite(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const p = brainWriteArgs(args);
  if (typeof p === 'string') return { line: p, code: 1 };
  const env = opts.env ?? process.env;
  const by = env[CODEX_HOOK_VAR] || env.LEDGE_SESSION;
  if (!by) return { line: 'ledge brain propose et flag ne marchent que dans une session lancée par Ledge : modifie la note toi-même', code: 1 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: BRAIN_MS }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await brainWriteOnClient(client, args, by, BRAIN_MS); }
  finally { await client.close(); }
}
