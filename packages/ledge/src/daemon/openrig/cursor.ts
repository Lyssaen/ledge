import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { log } from '../../log.js';
import { paths } from '../../paths.js';
import type { QueuedAnswer } from './answerQueue.js';

const MachineSchema = z.object({ lastEventId: z.number().nullable(), rigs: z.array(z.string()), at: z.string() });
const QueuedAnswerSchema = z.object({ rid: z.string(), machine: z.string(), id: z.string(), answers: z.record(z.string()), by: z.enum(['user', 'ledge']), at: z.string(), sentAt: z.string().optional() });
/** `replyRows`: escalation qitemId -> id of the reply row Ledge created for it (lot 4), so a retry never creates a second one.
 *  `outbox`: the answers waiting for an unreachable machine (lot 6), written by the answer queue only; absent when empty. */
export interface OpenRigFile { version: 1; machines: Record<string, { lastEventId: number | null; rigs: string[]; at: string }>; replyRows?: Record<string, string>; outbox?: QueuedAnswer[] }
/** Reply rows kept (oldest dropped first). */
const REPLY_ROWS_MAX = 500;
const empty = (): OpenRigFile => ({ version: 1, machines: {} });

/** Absent, truncated or foreign-version file → the empty default (logged unless merely absent); bad machine entries are dropped. */
export function readOpenRigFile(file: string = paths().openrig): OpenRigFile {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log(`openrig.json is unreadable, starting empty: ${(e as Error).message.split('\n')[0]}`); return empty(); }
  const r = raw as { version?: unknown; machines?: unknown; replyRows?: unknown; outbox?: unknown } | null;
  if (!r || r.version !== 1 || !r.machines || typeof r.machines !== 'object') { log('openrig.json has an unexpected shape, starting empty'); return empty(); }
  const out = empty();
  for (const [name, m] of Object.entries(r.machines)) {
    const p = MachineSchema.safeParse(m);
    if (p.success) out.machines[name] = p.data; else log(`openrig.json: entry for machine ${name} dropped (malformed)`);
  }
  if (r.replyRows && typeof r.replyRows === 'object' && !Array.isArray(r.replyRows)) {
    const rows = Object.entries(r.replyRows).filter((kv): kv is [string, string] => typeof kv[1] === 'string');
    if (rows.length) out.replyRows = Object.fromEntries(rows);
  }
  if (Array.isArray(r.outbox)) {
    const queued = r.outbox.flatMap(a => { const p = QueuedAnswerSchema.safeParse(a); if (!p.success) log('openrig.json: a malformed queued answer dropped'); return p.success ? [p.data] : []; });
    if (queued.length) out.outbox = queued;
  }
  return out;
}

/**
 * openrig.json has two writers in one daemon: the cursor writer (machines, replyRows) and the answer queue (outbox). Each
 * write takes the other one's part from the file as it is now, then writes, all synchronously: no other write can come
 * between the read and the rename, so neither drops what the other wrote.
 */
function writeOpenRig(file: string, body: Omit<OpenRigFile, 'outbox'> | null, outbox?: QueuedAnswer[]): void {
  try {
    const cur = readOpenRigFile(file);
    const base = body ?? { version: 1 as const, machines: cur.machines, ...(cur.replyRows ? { replyRows: cur.replyRows } : {}) };
    const list = outbox ?? cur.outbox ?? [];
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...base, ...(list.length ? { outbox: list } : {}) })); renameSync(tmp, file);
  } catch (e) { log(`openrig.json not written: ${(e as Error).message}`); }
}

/** The answer queue's write: its outbox, the rest of the file kept as it is on disk. */
export function writeOutbox(file: string, outbox: QueuedAnswer[]): void { writeOpenRig(file, null, outbox); }

/** Throttled atomic writer: after a change, one write `minIntervalMs` later (tmp + rename) holding the latest state, so at
 *  most one write per interval; `flush()` writes any pending state now and resolves once it is on disk. */
export function createCursorWriter(opts: { file?: string; minIntervalMs?: number; now?: () => string }) {
  const file = opts.file ?? paths().openrig; const minIntervalMs = opts.minIntervalMs ?? 1000; const now = opts.now ?? (() => new Date().toISOString());
  const state = readOpenRigFile(file);
  delete state.outbox; // the answer queue's: taken from the file at each write
  let dirty = false; let timer: NodeJS.Timeout | null = null;
  const schedule = () => { dirty = true; if (!timer) { timer = setTimeout(() => { timer = null; void write(); }, minIntervalMs); timer.unref?.(); } };
  const write = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return Promise.resolve();
    dirty = false; writeOpenRig(file, state);
    return Promise.resolve();
  };
  return {
    set(machine: string, patch: Partial<{ lastEventId: number | null; rigs: string[] }>): void {
      const cur = state.machines[machine] ?? { lastEventId: null, rigs: [], at: '' };
      state.machines[machine] = { ...cur, ...patch, at: now() }; schedule();
    },
    replyRow(id: string): string | undefined { return state.replyRows?.[id]; },
    setReplyRow(id: string, row: string): void {
      const rows = state.replyRows ?? (state.replyRows = {}); delete rows[id]; rows[id] = row;
      for (const k of Object.keys(rows).slice(0, Math.max(0, Object.keys(rows).length - REPLY_ROWS_MAX))) delete rows[k];
      schedule();
    },
    flush(): Promise<void> { return write(); }
  };
}
