import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { EscalationSchema, MandateCategorySchema } from '@ledge/protocol';

const receiptSchema = z.object({ operation: z.string().min(1), token: z.string().min(1), id: z.string().min(1), state: z.enum(['started', 'applied']) });
export type RemoteReceipt = z.infer<typeof receiptSchema>;
const pendingSchema = z.object({ operation: z.string().min(1), token: z.string().min(1), machine: z.string().min(1), nativeId: z.string().min(1), id: z.string().min(1),
  escalation: EscalationSchema, answers: z.record(z.string()), category: MandateCategorySchema, rule: z.string().optional(), why: z.string().optional() });
export type RemotePending = z.infer<typeof pendingSchema>;

/** Read once; a corrupt journal is an error, never treated as an empty one and silently overwritten. */
function journal<T>(path: string, schema: z.ZodType<T>, key: (x: T) => string) {
  let items: T[];
  try { items = z.array(schema).parse(JSON.parse(readFileSync(path, 'utf8'))); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') items = []; else throw e; }
  function save(next: T[]) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    const fd = openSync(tmp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
    const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    items = next;
  }
  return {
    all: () => [...items],
    get: (id: string) => items.find(x => key(x) === id),
    put(x: T) { const value = schema.parse(x); save([...items.filter(y => key(y) !== key(value)), value]); },
    remove(id: string) { if (items.some(x => key(x) === id)) save(items.filter(x => key(x) !== id)); }
  };
}
/** Proof is stored at the origin before it acknowledges the remote coordinator. */
export const createReceiptJournal = (path: string) => journal(path, receiptSchema, x => x.operation);
/** An outgoing candidate is durable before it may be sent. */
export const createPendingJournal = (path: string) => journal(path, pendingSchema, x => x.operation);
export type ReceiptJournal = ReturnType<typeof createReceiptJournal>;
export type PendingJournal = ReturnType<typeof createPendingJournal>;
