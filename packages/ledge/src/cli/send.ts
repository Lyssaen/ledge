import { randomUUID } from 'node:crypto';
import { connect } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

const USAGE = 'ledge send <nom> "<message>" [--summary <texte>]   write to another Ledge session';
/** How long the daemon has to ack: the message is typed into the target, not just recorded. */
const ACK_MS = 5000;

/** `ledge send <nom> "<message>" [--summary <texte>]`: one session writes to another through the daemon. `from`, when
 *  given, is the sender and skips the environment (the hook knows its session). */
export async function sendMessage(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; from?: string } = {}): Promise<{ line: string; code: number }> {
  const positional: string[] = []; let summary: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary') { summary = args[++i]; if (summary === undefined) return { line: USAGE, code: 1 }; }
    else positional.push(args[i]!);
  }
  const [to, text] = positional;
  if (positional.length !== 2 || !to || !text) return { line: USAGE, code: 1 };
  const env = opts.env ?? process.env;
  const from = opts.from ?? (env[CODEX_HOOK_VAR] || env.LEDGE_SESSION);
  if (!from) return { line: 'ledge send ne marche que dans une session lancée par Ledge', code: 1 };
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: 800 }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try {
    await client.next('snapshot', ACK_MS);
    const rid = randomUUID();
    client.send({ type: 'session.message', rid, from, to, text, ...(summary ? { summary } : {}) });
    const ack = await client.next('message.ack', ACK_MS);
    if (ack.outcome === 'accepted') return { line: `remis à ${to}`, code: 0 };
    if (ack.outcome === 'queued') return { line: `${to} est occupé : il le recevra dès qu'il sera libre`, code: 0 };
    return { line: `refusé : ${ack.reason ?? 'raison inconnue'}`, code: 1 };
  } catch (e) {
    return { line: `refusé : ${(e as Error).message}`, code: 1 };
  } finally { await client.close(); }
}
