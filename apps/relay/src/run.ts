import type http from 'node:http';
import { startAccountsRelay } from './app.js';
import { devTokens } from './auth.js';
import type { Config } from './config.js';
import { openDatabase } from './database.js';
import { githubHttp, type GitHub } from './github.js';
import { jsonLog, type RelayLog } from './log.js';
import { createRelay } from './server.js';
import { staticRoutes } from './static.js';

/** The relay could not listen on its port. */
export class ListenError extends Error {
  constructor(readonly port: number, readonly code: string) {
    super(`cannot listen on port ${port}: ${code}`);
    this.name = 'ListenError';
  }
}

/** The database is unreachable or its migration failed. */
export class DatabaseUnreachableError extends Error {
  constructor(readonly code?: string) {
    super('the database is unreachable or its migration failed');
    this.name = 'DatabaseUnreachableError';
  }
}

/** Builds the relay for `cfg`, opens its database and listens; shared by the env entry and the launcher. */
export async function startRelay(
  cfg: Config,
  opts: { host?: string; github?: GitHub; log?: RelayLog } = {}
): Promise<{ server: http.Server; port: number; close(): Promise<void> }> {
  let server: http.Server;
  let stop: () => Promise<void>;
  if (cfg.mode === 'dev') {
    const relay = createRelay({
      authenticator: devTokens(cfg.tokens),
      ...(cfg.webDir ? { http: staticRoutes({ root: cfg.webDir, log: jsonLog }) } : {}),
      ...(opts.log ? { log: opts.log } : {})
    });
    server = relay.server;
    stop = () => relay.close();
  } else {
    const database = await openDatabase(cfg.database);
    const github = opts.github ?? githubHttp({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      ...(cfg.githubWeb ? { webBase: cfg.githubWeb } : {}),
      ...(cfg.githubApi ? { apiBase: cfg.githubApi } : {})
    });
    try {
      const app = await startAccountsRelay(cfg, { db: database.db, github, ...(opts.log ? { log: opts.log } : {}) });
      server = app.server;
      stop = async () => { await app.close(); await database.close(); };
    } catch (e) {
      await database.close().catch(() => {});
      const code = (e as { code?: unknown }).code;
      throw new DatabaseUnreachableError(typeof code === 'string' ? code : undefined);
    }
  }
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      const ready = () => { server.off('error', reject); resolve((server.address() as { port: number }).port); };
      if (opts.host) server.listen(cfg.port, opts.host, ready); else server.listen(cfg.port, ready);
    });
    return { server, port, close: stop };
  } catch (e) {
    await stop().catch(() => {});
    throw new ListenError(cfg.port, (e as NodeJS.ErrnoException).code ?? 'error');
  }
}
