import { randomUUID } from 'node:crypto';
import { connect, sendMessageAndAwaitAck, type Client } from '../client.js';
import { CODEX_HOOK_VAR } from '../spawn.js';

const USAGE = 'ledge send <nom> "<message>" [--summary <texte>]   write to another Ledge session';
/** One deadline for connect and ack: Codex kills a hook after 5 s, and the hook calls this in-process. */
const SEND_MS = 4000;

/** The arguments of `ledge send`, or `undefined` when they do not fit its usage. */
function sendUsage(args: string[]): { to: string; text: string; summary?: string } | undefined {
  const positional: string[] = []; let summary: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary') { summary = args[++i]; if (summary === undefined) return undefined; }
    else positional.push(args[i]!);
  }
  const [to, text] = positional;
  if (positional.length !== 2 || !to || !text) return undefined;
  return { to, text, ...(summary ? { summary } : {}) };
}

/** `ledge send` over an already-connected client: the hook sends on its own connection, where its `session.event` went,
 *  so the daemon knows the sender. `ms` is what is left of the shared deadline. */
export async function sendOnClient(client: Client, args: string[], from: string, ms: number): Promise<{ line: string; code: number }> {
  const parsed = sendUsage(args);
  if (!parsed) return { line: USAGE, code: 1 };
  const { to, text, summary } = parsed;
  let sent = false;
  try {
    const pending = sendMessageAndAwaitAck(client, { type: 'session.message', rid: randomUUID(), from, to, text, ...(summary ? { summary } : {}) }, ms);
    sent = true;
    const ack = await pending;
    if (ack.outcome === 'accepted') return { line: `remis à ${to}`, code: 0 };
    if (ack.outcome === 'queued') return { line: `${to} est occupé : il le recevra dès qu'il sera libre`, code: 0 };
    return { line: `refusé : ${ack.reason ?? 'raison inconnue'}`, code: 1 };
  } catch (e) {
    return { line: sent ? 'pas de réponse de Ledge : le message est peut-être déjà parti' : `refusé : ${(e as Error).message}`, code: 1 };
  }
}

/** `ledge send <nom> "<message>" [--summary <texte>]`: one session writes to another through the daemon. `from`, when
 *  given, is the sender and skips the environment. */
export async function sendMessage(args: string[], opts: { port?: number; env?: NodeJS.ProcessEnv; from?: string; timeoutMs?: number } = {}): Promise<{ line: string; code: number }> {
  if (!sendUsage(args)) return { line: USAGE, code: 1 };
  const env = opts.env ?? process.env;
  const from = opts.from ?? (env[CODEX_HOOK_VAR] || env.LEDGE_SESSION);
  if (!from) return { line: 'ledge send ne marche que dans une session lancée par Ledge', code: 1 };
  const deadline = Date.now() + (opts.timeoutMs ?? SEND_MS);
  const left = () => Math.max(0, deadline - Date.now());
  let client;
  try { client = await connect({ port: opts.port, timeoutMs: left() }); }
  catch { return { line: 'daemon not running (start a session with `ledge claude`, or run `ledge daemon`)', code: 1 }; }
  try { return await sendOnClient(client, args, from, left()); }
  finally { await client.close(); }
}

/**
 * Reads a shell command as exactly one `ledge who` or `ledge send …`, nothing else: Codex's hook runs it itself, outside
 * the sandbox, so anything a shell would do beyond a plain word list (chaining, pipes, redirections, substitution,
 * comments, an unquoted backslash, newline or glob/tilde character) makes it `undefined`, as does an unclosed quote.
 */
export function parseLedgeCommand(command: string): { cmd: 'who' } | { cmd: 'send'; args: string[] } | undefined {
  command = command.replace(/[\r\n\s]+$/, ''); // a trailing newline ends the one command, it chains nothing
  const words: string[] = [];
  let word = ''; let inWord = false; let quote: '"' | "'" | undefined;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote === "'") { if (c === "'") quote = undefined; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') quote = undefined;
      else if (c === '$' || c === '`') return undefined;
      else if (c === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) word += command[++i];
      else word += c;
      continue;
    }
    if (c === '\n' || c === '\r') return undefined;
    if (c === ' ' || c === '\t') { if (inWord) words.push(word); word = ''; inWord = false; continue; }
    if (';&|<>()$`\\*?[~{'.includes(c) || (c === '#' && !inWord)) return undefined;
    inWord = true;
    if (c === '"' || c === "'") quote = c; else word += c;
  }
  if (quote) return undefined;
  if (inWord) words.push(word);
  if (words[0] !== 'ledge') return undefined;
  if (words[1] === 'who' && words.length === 2) return { cmd: 'who' };
  if (words[1] === 'send') return { cmd: 'send', args: words.slice(2) };
  return undefined;
}
