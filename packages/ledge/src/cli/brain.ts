import { randomUUID } from 'node:crypto';
import { BRAIN_OPS, type BrainOp } from '@ledge/protocol';
import { connect, type Client } from '../client.js';
import { callerOf, DAEMON_DOWN } from './action.js';

/** The one refusal of `ledge brain` outside Ledge's brain session (CLI and daemon). */
export const NOT_BRAIN_LINE = 'ledge brain ne marche que dans la session du cerveau de Ledge.';
export const BRAIN_USAGE = "ledge brain <say|decide|ask|rig|send|propose|remember|who|rigs|escalations|rules|handover> …   only from Ledge's brain session";

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

/** A deadline, not a delay: a launch card's check may start OpenRig first. */
export const BRAIN_MS = 60_000;

/**
 * `ledge brain <op> …` from a terminal: only in the brain session (`LEDGE_BRAIN` and its id in the environment); elsewhere
 * refused here without reaching the daemon, which checks the id, the key and the brain mark again anyway.
 */
export async function runBrain(args: string[], o: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ line: string; code: number }> {
  const env = o.env ?? process.env;
  const caller = callerOf(env);
  if (!env.LEDGE_BRAIN || !caller) return { line: NOT_BRAIN_LINE, code: 1 };
  if (!isOp(args[0]) || args.length > 41) return { line: BRAIN_USAGE, code: 1 };
  let client: Client;
  try { client = await connect({ port: o.port, timeoutMs: 1500 }); }
  catch { return { line: DAEMON_DOWN, code: 1 }; }
  try { return await brainOnClient(client, args, caller.by, caller.key, BRAIN_MS); }
  finally { await client.close(); }
}
