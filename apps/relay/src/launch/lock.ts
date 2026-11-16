import { linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Another live process holds the data directory; the embedded database must never be opened by two. */
export class DataDirLockedError extends Error {
  constructor(readonly dir: string) {
    super(`another ledge-relay is using ${dir}`);
    this.name = 'DataDirLockedError';
  }
}

/** Whether a process with this id is running; one we may not signal still exists. */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readPid(path: string): number | undefined {
  try {
    return Number.parseInt(readFileSync(path, 'utf8'), 10);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/**
 * Takes the data directory for this process, replacing the lock of a process that is gone; returns its release.
 * The lock appears with its process id already in it (written aside, then hard-linked), so no reader sees it empty.
 */
export function lockDataDir(dir: string): () => void {
  const path = join(dir, 'ledge-relay.lock');
  const mine = `${process.pid}`;
  const tmp = join(dir, `ledge-relay.lock.${mine}`);
  writeFileSync(tmp, `${mine}\n`, { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        linkSync(tmp, path);
        return () => {
          try {
            if (readPid(path) === process.pid) unlinkSync(path);
          } catch {
            // A lock that cannot be removed is taken over as stale by the next launch.
          }
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const pid = readPid(path);
      if (pid !== undefined && alive(pid)) throw new DataDirLockedError(dir);
      try {
        unlinkSync(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    throw new DataDirLockedError(dir);
  } finally {
    unlinkSync(tmp);
  }
}
