import type http from 'node:http';
import { accountsAuthenticator, type AccountsDeps } from './accounts.js';
import type { AccountsConfig } from './config.js';
import type { Db } from './db.js';
import type { GitHub } from './github.js';
import { jsonLog, type RelayLog } from './log.js';
import type { PushFetch } from './push.js';
import { authRoutes } from './routes.js';
import { createRelay } from './server.js';
import { chain, staticRoutes } from './static.js';
import { Store } from './store.js';

/**
 * The accounts-mode relay: migrates the schema, then serves websockets and `/auth/*`. It does not listen and does not
 * own `db`; the caller listens, and closes the database after `close()`.
 */
export async function startAccountsRelay(
  cfg: AccountsConfig,
  deps: { db: Db; github: GitHub; log?: RelayLog; push?: { fetch?: PushFetch; now?: () => number } }
): Promise<{ server: http.Server; close(): Promise<void> }> {
  const log = deps.log ?? jsonLog;
  const store = new Store(deps.db);
  await store.migrate();
  const accounts: AccountsDeps = { store, allowed: cfg.allowed, publicUrl: cfg.publicUrl, log };
  const routes = authRoutes({ ...accounts, github: deps.github, ...(cfg.vapid ? { vapid: cfg.vapid } : {}), ...(deps.push ? { push: deps.push } : {}) });
  const relay = createRelay({ authenticator: accountsAuthenticator(accounts), http: chain(routes, ...(cfg.webDir ? [staticRoutes({ root: cfg.webDir, publicUrl: cfg.publicUrl, log })] : [])), log });
  let closing: Promise<void> | undefined;
  return {
    server: relay.server,
    close() {
      closing ??= relay.close().finally(() => routes.stop());
      return closing;
    }
  };
}
