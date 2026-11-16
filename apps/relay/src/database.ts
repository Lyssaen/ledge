import { constants } from 'node:fs';
import { access, chmod, mkdir } from 'node:fs/promises';
import pg from 'pg';
import type { DatabaseConfig } from './config.js';
import type { Db } from './db.js';

/** The embedded database directory could not be opened; it has been left exactly as it was. */
export class DatabaseOpenError extends Error {
  constructor(readonly dir: string) {
    super('cannot open the embedded database');
    this.name = 'DatabaseOpenError';
  }
}

/** A directory the relay needs cannot be created or used by this user; nothing in it was changed. */
export class DirectoryAccessError extends Error {
  constructor(readonly dir: string) {
    super(`cannot use ${dir}: permission denied`);
    this.name = 'DirectoryAccessError';
  }
}

/** Opens the relay's database, Postgres through a pool or the embedded PGlite in a directory. */
export async function openDatabase(c: DatabaseConfig): Promise<{ db: Db; close(): Promise<void> }> {
  if (c.kind === 'postgres') {
    const pool = new pg.Pool({
      connectionString: c.url,
      // An unreachable or hanging database must fail calls (500 / auth_error), not queue them forever.
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000
    });
    // An idle client failing must not crash the process; a query on it will fail on its own.
    pool.on('error', () => {});
    return { db: pool, close: () => pool.end() };
  }
  // The directory is private like the data directory around it, since pglite creates its own files readable by all.
  try {
    await mkdir(c.dir, { recursive: true, mode: 0o700 });
    await chmod(c.dir, 0o700);
    await access(c.dir, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (e) {
    if (isPermissionError(e)) throw new DirectoryAccessError(c.dir);
    throw new DatabaseOpenError(c.dir);
  }
  // Loaded here so that the Postgres entry never loads the embedded database.
  const { PGlite } = await import('@electric-sql/pglite');
  try {
    const lite = await PGlite.create(c.dir);
    return { db: lite, close: () => lite.close() };
  } catch {
    throw new DatabaseOpenError(c.dir);
  }
}

/** Whether a file system error means this user may not create or use the path. */
export function isPermissionError(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM';
}
