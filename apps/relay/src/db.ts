/** The only database surface the relay uses; satisfied by `pg.Client`, `pg.Pool` and PGlite. */
export interface Db {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}
