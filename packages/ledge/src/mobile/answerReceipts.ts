import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const recordSchema = z.object({
  op: z.string().uuid(), owner: z.string().min(1).max(256), fingerprint: hash,
  machine: z.string().min(1).max(256), id: z.string().min(1).max(120), answers: hash,
  status: z.enum(['received', 'applied']), at: z.number().int().nonnegative()
}).strict();
export type AnswerReceipt = z.infer<typeof recordSchema>;
export const receiptHash = (value: string): string => createHash('sha256').update(value).digest('hex');
const MAX = 500;
const RETAIN_APPLIED_MS = 24 * 60 * 60 * 1_000;

/** A corrupt journal is an error, never an empty journal that could cause an operation to be repeated. */
export function createAnswerReceipts(path: string) {
  let items: AnswerReceipt[];
  try { items = z.array(recordSchema).max(MAX).parse(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') items = []; else throw error; }
  const ids = new Set<string>();
  for (const item of items) { if (ids.has(item.op)) throw new Error('duplicate answer receipt'); ids.add(item.op); }
  function save(next: AnswerReceipt[]) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    const fd = openSync(tmp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
    const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    items = next;
  }
  return {
    get(op: string): AnswerReceipt | undefined { const item = items.find(x => x.op === op); return item && { ...item }; },
    putPending(input: AnswerReceipt): void {
      const value = recordSchema.parse(input); if (value.status !== 'received' || items.some(x => x.op === value.op)) throw new Error('answer already recorded');
      // Keep every unresolved operation and every recent proof. Old terminal receipts outlive phone retries.
      const cutoff = Date.now() - RETAIN_APPLIED_MS;
      const next = items.filter(x => x.status !== 'applied' || x.at >= cutoff);
      if (next.length >= MAX) throw new Error('answer receipt journal full');
      save([...next, value]);
    },
    markApplied(op: string): void {
      const item = items.find(x => x.op === op); if (!item) throw new Error('answer receipt missing');
      if (item.status === 'applied') return;
      save(items.map(x => x.op === op ? { ...x, status: 'applied' as const } : x));
    }
  };
}
export type AnswerReceipts = ReturnType<typeof createAnswerReceipts>;
