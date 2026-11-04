import { rename as fsRename } from 'node:fs/promises';

/** Errors Windows gives while another process (an antivirus, an indexer) briefly holds the file. */
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** The `rename` of an atomic write, tried again while the target is held: 6 tries, 50 ms then doubling. Any other error,
 *  or the last one, is thrown as is. */
export async function renameRetry(from: string, to: string, opts: { tries?: number; delayMs?: number; rename?: (a: string, b: string) => Promise<void> } = {}): Promise<void> {
  const tries = opts.tries ?? 6, rename = opts.rename ?? fsRename;
  let delay = opts.delayMs ?? 50;
  for (let i = 1; ; i++) {
    try { await rename(from, to); return; }
    catch (e) {
      if (i >= tries || !HELD.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      await new Promise(r => setTimeout(r, delay)); delay *= 2;
    }
  }
}
