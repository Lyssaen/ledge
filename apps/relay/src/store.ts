import { RelayPeerSchema, type RelayPeer } from '@ledge/protocol';
import type { Db } from './db.js';

export type SessionKind = 'pc' | 'device';

export interface Session {
  accountId: string;
  login: string;
  peer: RelayPeer;
  kind: SessionKind;
}

const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Ordered migrations, each a list of statements (one `query` call per statement: PGlite refuses several
 * statements in a prepared query). Every statement is idempotent so a half-applied migration can be re-run.
 */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS accounts (github_id bigint PRIMARY KEY, login text NOT NULL, created_at timestamptz NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      account_id bigint NOT NULL REFERENCES accounts(github_id),
      peer text NOT NULL,
      kind text NOT NULL CHECK (kind IN ('pc', 'device')),
      created_at timestamptz NOT NULL, last_seen timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz
    )`,
    `CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id, kind) WHERE revoked_at IS NULL`
  ]
];

interface SessionRow {
  account_id: string;
  login: string;
  peer: string;
  kind: SessionKind;
}

function toSession(row: SessionRow): Session {
  return { accountId: row.account_id, login: row.login, peer: RelayPeerSchema.parse(row.peer), kind: row.kind };
}

/** Accounts and sessions. Only the sha256 hex of a token is stored. The SQL never calls `now()`: time is a parameter. */
export class Store {
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(
    private readonly db: Db,
    opts: { now?: () => number; ttlMs?: number } = {}
  ) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  async migrate(): Promise<void> {
    await this.db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY)');
    for (const [i, statements] of MIGRATIONS.entries()) {
      const version = i + 1;
      const done = await this.db.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (done.rows.length > 0) continue;
      for (const sql of statements) await this.db.query(sql);
      await this.db.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
    }
  }

  async upsertAccount(githubId: string, login: string): Promise<void> {
    await this.db.query(
      `INSERT INTO accounts (github_id, login, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login`,
      [githubId, login, new Date(this.now())]
    );
  }

  async createSession(tokenHash: string, s: Session): Promise<void> {
    const now = this.now();
    await this.db.query(
      `INSERT INTO sessions (token_hash, account_id, peer, kind, created_at, last_seen, expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [tokenHash, s.accountId, s.peer, s.kind, new Date(now), new Date(now + this.ttlMs)]
    );
  }

  /** A live session only (neither revoked nor expired); slides its expiry and refreshes `last_seen`. */
  async findSession(tokenHash: string): Promise<Session | null> {
    const now = this.now();
    const { rows } = await this.db.query<SessionRow>(
      `UPDATE sessions s SET last_seen = $2, expires_at = $3
       FROM accounts a
       WHERE s.token_hash = $1 AND a.github_id = s.account_id AND s.revoked_at IS NULL AND s.expires_at > $2
       RETURNING s.account_id::text AS account_id, a.login AS login, s.peer AS peer, s.kind AS kind`,
      [tokenHash, new Date(now), new Date(now + this.ttlMs)]
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  /** Revokes a live session and returns it; null if it was unknown, already revoked or expired. */
  async revokeSession(tokenHash: string): Promise<Session | null> {
    const now = this.now();
    const { rows } = await this.db.query<SessionRow>(
      `UPDATE sessions s SET revoked_at = $2
       FROM accounts a
       WHERE s.token_hash = $1 AND a.github_id = s.account_id AND s.revoked_at IS NULL AND s.expires_at > $2
       RETURNING s.account_id::text AS account_id, a.login AS login, s.peer AS peer, s.kind AS kind`,
      [tokenHash, new Date(now)]
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async revokeSessions(accountId: string, kind: SessionKind): Promise<number> {
    const { rows } = await this.db.query(
      `UPDATE sessions SET revoked_at = $3 WHERE account_id = $1 AND kind = $2 AND revoked_at IS NULL RETURNING 1`,
      [accountId, kind, new Date(this.now())]
    );
    return rows.length;
  }
}
