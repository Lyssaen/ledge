import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ChatTurnSchema, type ChatConversationSummary, type ChatTurn } from '@ledge/protocol';
import { log } from '../log.js';

/** How long a conversation is kept after its last question (refonte mobile M3 Q33). */
export const KEEP_DAYS = 7;
/** The past conversations a device keeps, the most recent first. */
export const PAST_MAX = 200;
/** A summary's first question, cut. */
export const FIRST_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENT = 'current.json';
const INDEX = 'index.json';
const TurnsSchema = z.array(ChatTurnSchema);
const CurrentSchema = z.object({ id: z.string().regex(UUID), day: z.string(), turns: TurnsSchema });
const SummarySchema = z.object({ id: z.string().regex(UUID), startedAt: z.string(), lastAt: z.string(), first: z.string(), count: z.number().int().min(1) });

export interface CurrentConversation { id: string; day: string; turns: ChatTurn[] }

/** The list's line for a conversation: none without a question. */
export function summaryOf(id: string, turns: readonly ChatTurn[]): ChatConversationSummary | undefined {
  const first = turns[0]; const last = turns.at(-1);
  if (!first || !last) return undefined;
  return { id, startedAt: first.askedAt, lastAt: last.askedAt, first: first.question.slice(0, FIRST_MAX), count: turns.length };
}

/**
 * A device's conversations on disk: the current one, rewritten at each change so a restarted daemon finds it, and the past ones,
 * frozen when they were put away, each in its file and listed in an index. Every write goes through one chain, in order.
 */
export function createConversations(dir: string, opts: { now?: () => string; days?: number } = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const keepMs = (opts.days ?? KEEP_DAYS) * 86_400_000;
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  const queue = <T>(f: () => Promise<T>): Promise<T> => {
    const p = chain.then(() => (closed ? (undefined as T) : f()));
    chain = p.catch(e => log(`chat conversations: ${e instanceof Error ? e.message : String(e)}`));
    return p;
  };
  /** Written beside, then renamed: a daemon stopped mid-write leaves the previous file whole. */
  const put = async (name: string, value: unknown) => {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${name}.tmp`);
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, join(dir, name));
  };
  const readTurns = async (id: string): Promise<ChatTurn[] | null> => {
    try {
      const r = TurnsSchema.safeParse(JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8')));
      return r.success ? r.data : null;
    } catch { return null; }
  };
  /** The index, rebuilt from the files when it is missing or unreadable. */
  const readIndex = async (): Promise<ChatConversationSummary[]> => {
    try {
      const r = z.array(SummarySchema).safeParse(JSON.parse(await readFile(join(dir, INDEX), 'utf8')));
      if (r.success) return r.data;
    } catch { /* rebuilt below */ }
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: ChatConversationSummary[] = [];
    for (const n of names) {
      const id = n.endsWith('.json') ? n.slice(0, -5) : '';
      if (!UUID.test(id)) continue;
      const turns = await readTurns(id); const s = turns && summaryOf(id, turns);
      if (s) out.push(s);
    }
    return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  };
  function readCurrent(): CurrentConversation | null {
    try {
      const r = CurrentSchema.safeParse(JSON.parse(readFileSync(join(dir, CURRENT), 'utf8')));
      if (r.success) return r.data;
      log('chat conversations: current conversation unreadable, starting empty');
    } catch { /* none yet */ }
    return null;
  }
  /** Drops what is older than the kept days or beyond `PAST_MAX`, any file the index does not hold, and a current conversation as old. */
  const pruneNow = async (index?: ChatConversationSummary[]) => {
    const all = index ?? await readIndex();
    const since = new Date(Date.parse(now()) - keepMs).toISOString();
    const kept = all.filter(s => s.lastAt >= since).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, PAST_MAX);
    const keep = new Set(kept.map(s => `${s.id}.json`));
    const names = await readdir(dir).catch(() => null);
    if (names === null) return;
    for (const n of names) if (n.endsWith('.json') && UUID.test(n.slice(0, -5)) && !keep.has(n)) await rm(join(dir, n), { force: true });
    if (index || kept.length !== all.length || !names.includes(INDEX)) await put(INDEX, kept);
    // The current conversation of a device that never came back goes too: its last question is older than the kept days.
    const current = readCurrent();
    if (current && (current.turns.at(-1)?.askedAt ?? '') < since) await rm(join(dir, CURRENT), { force: true });
  };

  return {
    /** The current conversation as last written; read once, when its chat is made. */
    loadCurrent: readCurrent,
    saveCurrent(c: CurrentConversation): Promise<void> { return queue(() => put(CURRENT, c)); },
    /** Puts the conversation away, frozen, and starts none: the next question writes the new current one. */
    archive(id: string, turns: readonly ChatTurn[]): Promise<void> {
      const frozen = structuredClone(turns);
      return queue(async () => {
        const s = summaryOf(id, frozen);
        if (s) {
          await put(`${id}.json`, frozen);
          await pruneNow([s, ...(await readIndex()).filter(x => x.id !== id)]);
        }
        await rm(join(dir, CURRENT), { force: true });
      });
    },
    prune(): Promise<void> { return queue(() => pruneNow()); },
    /** The past conversations, the most recent first, once the writes before it are done. */
    list(): Promise<ChatConversationSummary[]> { return queue(async () => (await readIndex()).slice(0, PAST_MAX)); },
    /** A past conversation's turns, or null when it is gone. */
    read(id: string): Promise<ChatTurn[] | null> {
      if (!UUID.test(id)) return Promise.resolve(null);
      return queue(async () => ((await readIndex()).some(s => s.id === id) ? readTurns(id) : null));
    },
    /** Waits for the writes under way; nothing is written after (the device is being forgotten). */
    async close(): Promise<void> { await queue(async () => {}); closed = true; }
  };
}

export type Conversations = ReturnType<typeof createConversations>;
