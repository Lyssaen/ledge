import { randomUUID } from 'node:crypto';
import { BRAIN_OPS, type BrainOp } from '@ledge/protocol';
import type { Client } from '../client.js';

export const BRAIN_USAGE = "ledge brain <say|decide|ask|rig|send|propose|remember|who|rigs|escalations|rules> …   only from Ledge's brain session";

const isOp = (s: string | undefined): s is BrainOp => (BRAIN_OPS as readonly string[]).includes(s ?? '');

/**
 * `ledge brain <op> …` over an already-connected client, as session `by` with its key: one `brain.cmd`, answered by the
 * `brain.result` of the same rid, whose line is the output. The daemon checks who `by` is and parses the arguments; an
 * unknown op gets the usage here, without reaching it. `ms` is what is left of the shared deadline.
 */
export async function brainOnClient(client: Client, args: string[], by: string, key: string | undefined, ms: number): Promise<{ line: string; code: number }> {
  const [op, ...rest] = args;
  if (!isOp(op) || rest.length > 40) return { line: BRAIN_USAGE, code: 1 };
  const rid = randomUUID();
  const deadline = Date.now() + ms;
  try {
    client.send({ type: 'brain.cmd', rid, by, key: key ?? '', op, args: rest });
    for (;;) {
      const r = await client.next('brain.result', Math.max(0, deadline - Date.now()));
      if (r.rid === rid) return { line: r.line, code: r.ok ? 0 : 1 };
    }
  } catch (e) {
    return { line: `pas de réponse de Ledge : ${(e as Error).message}`, code: 1 };
  }
}
