import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EXCHANGE_GROUP_MS, LedgeThreadItemSchema, THREAD_PAGE, type Exchange, type LedgeThreadItem } from '@ledge/protocol';
import { log } from '../log.js';
import { RESTARTED_TEXT } from './ledgeSay.js';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Group = Extract<LedgeThreadItem, { kind: 'exchanges' }>;

export interface LedgeThread {
  append(item: DistributiveOmit<LedgeThreadItem, 'id' | 'at'> & { id?: string; at?: string }): LedgeThreadItem;
  upsert(item: LedgeThreadItem): LedgeThreadItem;
  get(id: string): LedgeThreadItem | undefined;
  /** Items oldest to newest; `before` is the id of the oldest one when older items remain. */
  page(before?: string, size?: number): { items: LedgeThreadItem[]; before?: string };
  /** The group created or grown (or the one already holding this exchange id); null for Ledge's own messages (the user /
   *  decided item already shows them). */
  exchange(x: Exchange): LedgeThreadItem | null;
  hasEscalation(escalationId: string): boolean;
  onItem(fn: (item: LedgeThreadItem) => void): () => void;
  flush(): Promise<void>;
}

const groupKey = (machine: string, rigId: string) => `${machine}/${rigId}`;

export function createLedgeThread(o: { path: string; now?: () => string; uuid?: () => string; groupMs?: number }): LedgeThread {
  const now = o.now ?? (() => new Date().toISOString());
  const uuid = o.uuid ?? randomUUID;
  const groupMs = o.groupMs ?? EXCHANGE_GROUP_MS;
  const order: string[] = [];
  const items = new Map<string, LedgeThreadItem>();
  const escalations = new Set<string>();
  const openGroups = new Map<string, string>(); // machine/rigId -> id of the group still open
  const exchangeGroup = new Map<string, string>(); // exchange id -> id of the group holding it (a replayed exchange is no news)
  const listeners = new Set<(item: LedgeThreadItem) => void>();

  const track = (item: LedgeThreadItem, fresh: boolean): void => {
    if (fresh) {
      order.push(item.id);
      if (item.kind !== 'exchanges') openGroups.clear(); // a user/ledge/escalation/decided/card item closes every open group
    }
    items.set(item.id, item);
    if (item.kind === 'exchanges') {
      openGroups.set(groupKey(item.machine, item.rigId), item.id);
      for (const x of item.exchangeIds) exchangeGroup.set(x, item.id);
    }
    if (item.kind === 'escalation') escalations.add(item.escalationId);
  };

  let lines = 0;
  let needsNewline = false;
  try {
    if (existsSync(o.path)) {
      const raw = readFileSync(o.path, 'utf8');
      needsNewline = raw.length > 0 && !raw.endsWith('\n');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        lines++;
        try {
          const parsed = LedgeThreadItemSchema.safeParse(JSON.parse(line));
          if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid item');
          track(parsed.data, !items.has(parsed.data.id));
        } catch (e) { log(`ledge thread: skipped an unreadable line (${(e as Error).message})`); }
      }
    }
    if (lines > 2 * items.size) { // compaction: one line per id, in first-appearance order
      const tmp = `${o.path}.tmp`;
      writeFileSync(tmp, order.map(id => `${JSON.stringify(items.get(id))}\n`).join(''));
      renameSync(tmp, o.path);
      needsNewline = false;
    }
  } catch (e) { log(`ledge thread: load failed (${(e as Error).message})`); }

  let queue: Promise<void> = Promise.resolve();
  const persist = (item: LedgeThreadItem): void => {
    queue = queue.then(async () => {
      const prefix = needsNewline ? '\n' : ''; // read in turn: a failed write before this one sets it again
      needsNewline = false;
      await mkdir(dirname(o.path), { recursive: true });
      await appendFile(o.path, `${prefix}${JSON.stringify(item)}\n`);
    }).catch(e => {
      needsNewline = true; // the line may be torn: the next one starts fresh
      log(`ledge thread: write failed (${(e as Error).message})`);
    });
  };
  const emit = (item: LedgeThreadItem): void => { for (const fn of [...listeners]) { try { fn(item); } catch (e) { log(`ledge thread: listener failed (${(e as Error).message})`); } } };
  const store = (item: LedgeThreadItem): LedgeThreadItem => { track(item, !items.has(item.id)); persist(item); emit(item); return item; };

  // A bubble still pending lost its runner with the previous daemon: it says so instead of « Ledge lit… » forever.
  for (const id of order) {
    const item = items.get(id)!;
    if (item.kind !== 'ledge' || !item.pending) continue;
    const { pending: _pending, ...rest } = item;
    store({ ...rest, text: RESTARTED_TEXT });
  }

  return {
    append(item) {
      return store({ ...item, id: item.id ?? uuid(), at: item.at ?? now() } as LedgeThreadItem);
    },
    upsert: item => store(item),
    get: id => items.get(id),
    page(before, size = THREAD_PAGE) {
      const end = before === undefined ? order.length : Math.max(0, order.indexOf(before));
      const start = Math.max(0, end - size);
      return { items: order.slice(start, end).map(id => items.get(id)!), ...(start > 0 ? { before: order[start]! } : {}) };
    },
    exchange(x) {
      if (x.kind === 'ledge') return null;
      const known = exchangeGroup.get(x.id); if (known !== undefined) return items.get(known) ?? null;
      const open = items.get(openGroups.get(groupKey(x.machine, x.rigId)) ?? '') as Group | undefined;
      if (open) {
        if (Date.parse(x.at) - Date.parse(open.to) <= groupMs) {
          return store({ ...open, to: x.at > open.to ? x.at : open.to, exchangeIds: [...open.exchangeIds, x.id] });
        }
      }
      return store({ kind: 'exchanges', id: uuid(), at: x.at, machine: x.machine, rigId: x.rigId, from: x.at, to: x.at, exchangeIds: [x.id] });
    },
    hasEscalation: id => escalations.has(id),
    onItem(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    flush: () => queue,
  };
}
