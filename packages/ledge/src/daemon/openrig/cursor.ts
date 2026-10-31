import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import { log } from '../../log.js';
import { paths } from '../../paths.js';

const MachineSchema = z.object({ lastEventId: z.number().nullable(), rigs: z.array(z.string()), at: z.string() });
/** `replyRows`: escalation qitemId -> id of the reply row Ledge created for it (lot 4), so a retry never creates a second one. */
export interface OpenRigFile { version: 1; machines: Record<string, { lastEventId: number | null; rigs: string[]; at: string }>; replyRows?: Record<string, string> }
/** Reply rows kept (oldest dropped first). */
const REPLY_ROWS_MAX = 500;
const empty = (): OpenRigFile => ({ version: 1, machines: {} });

/** Absent, truncated or foreign-version file → the empty default (logged unless merely absent); bad machine entries are dropped. */
export function readOpenRigFile(file: string = paths().openrig): OpenRigFile {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log(`openrig.json is unreadable, starting empty: ${(e as Error).message.split('\n')[0]}`); return empty(); }
  const r = raw as { version?: unknown; machines?: unknown; replyRows?: unknown } | null;
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
  return out;
}

/** Throttled atomic writer: after a change, one write `minIntervalMs` later (tmp + rename) holding the latest state, so at
 *  most one write per interval; `flush()` writes any pending state now and resolves once it is on disk. */
export function createCursorWriter(opts: { file?: string; minIntervalMs?: number; now?: () => string }) {
  const file = opts.file ?? paths().openrig; const minIntervalMs = opts.minIntervalMs ?? 1000; const now = opts.now ?? (() => new Date().toISOString());
  const state = readOpenRigFile(file);
  let dirty = false; let timer: NodeJS.Timeout | null = null; let writing: Promise<void> = Promise.resolve();
  const schedule = () => { dirty = true; if (!timer) { timer = setTimeout(() => { timer = null; void write(); }, minIntervalMs); timer.unref?.(); } };
  const write = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return writing;
    dirty = false; const body = JSON.stringify(state); const tmp = `${file}.tmp`;
    writing = writing.then(async () => {
      try { await writeFile(tmp, body); await rename(tmp, file); }
      catch (e) { log(`openrig.json not written: ${(e as Error).message}`); }
    });
    return writing;
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
