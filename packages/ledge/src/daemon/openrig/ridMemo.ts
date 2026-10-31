import type { ServerMessage } from '@ledge/protocol';
import type { Reply } from '../server.js';

export interface RidMemo {
  /** Runs `run` once per (type, rid); a re-ask while it runs waits for the same outcome, a re-ask later replays what was sent to the requester. */
  once(type: string, rid: string, reply: Reply, run: (reply: Reply) => Promise<void>): Promise<void>;
}

interface Entry { at: number; sent: ServerMessage[]; done: Promise<void> }

const DAY_MS = 24 * 60 * 60 * 1000;
/** Refusals that say « not now », not « no »: never replayed, the same rid runs again later (an answer that waited on OpenRig). */
const TRANSIENT: ReadonlySet<string> = new Set(['openrig_down', 'unreachable']);
const transient = (m: ServerMessage) => m.type === 'rig.result' && !m.ok && m.code !== undefined && TRANSIENT.has(m.code);

/** Idempotence of the rig commands: only messages sent through the wrapped `reply` are kept, broadcasts are not. A run that throws,
 *  or that answered a transient refusal (`openrig_down`, `unreachable`), is forgotten once over (who waited on it got that refusal). */
export function createRidMemo(opts: { ttlMs?: number; max?: number; now?: () => number } = {}): RidMemo {
  const ttl = opts.ttlMs ?? DAY_MS; const max = opts.max ?? 2000; const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const forget = (): void => {
    const t = now();
    for (const [k, e] of entries) { if (t - e.at >= ttl) entries.delete(k); else break; }
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
  };
  return {
    async once(type, rid, reply, run) {
      forget();
      const key = `${type}\u0000${rid}`;
      const known = entries.get(key);
      if (known) { await known.done; for (const m of known.sent) reply(m); return; }
      const entry: Entry = { at: now(), sent: [], done: Promise.resolve() };
      entry.done = run(m => { entry.sent.push(m); reply(m); });
      entries.set(key, entry);
      forget();
      try { await entry.done; } catch (e) { if (entries.get(key) === entry) entries.delete(key); throw e; }
      if (entry.sent.some(transient) && entries.get(key) === entry) entries.delete(key);
    },
  };
}
