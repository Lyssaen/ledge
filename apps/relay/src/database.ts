import { mkdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
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
  try {
    await mkdir(c.dir, { recursive: true });
    const lite = await PGlite.create(c.dir);
    return { db: lite, close: () => lite.close() };
  } catch {
    throw new DatabaseOpenError(c.dir);
  }
}
