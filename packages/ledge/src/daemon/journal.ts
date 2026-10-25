import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { log } from '../log.js';

export interface Journal<T> { load(): T | undefined; save(state: T): void }

/** A state kept in one JSON file: read once at startup (`read` checks its shape, undefined when unreadable), rewritten
 *  whole through a temporary file after each change, one write at a time, the latest state winning. */
export function jsonJournal<T>(path: string, name: string, read: (raw: unknown) => T | undefined): Journal<T> & { flush(): Promise<void> } {
  let pending: T | undefined; let writing: Promise<void> = Promise.resolve();
  const drain = async (): Promise<void> => {
    while (pending !== undefined) {
      const state = pending; pending = undefined;
      const tmp = `${path}.tmp`;
      try { await writeFile(tmp, JSON.stringify(state)); await rename(tmp, path); }
      catch (e) { log(`${name} journal not written: ${(e as Error).message}`); }
    }
  };
  return {
    load() {
      try { return read(JSON.parse(readFileSync(path, 'utf8'))); } catch { return undefined; }
    },
    save(state) {
      const idle = pending === undefined; pending = state;
      if (idle) writing = writing.then(drain);
    },
    flush: () => writing
  };
}
