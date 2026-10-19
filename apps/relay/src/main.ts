import pg from 'pg';
import { startAccountsRelay } from './app.js';
import { devTokens } from './auth.js';
import { ConfigError, loadConfig } from './config.js';
import { githubHttp } from './github.js';
import { createRelay } from './server.js';

function die(msg: string): never {
  process.stderr.write(`ledge-relay: ${msg}\n`);
  process.exit(1);
}

let cfg;
try {
  cfg = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) die(e.message);
  throw e;
}

const port = cfg.port;
const listening = (server: import('node:http').Server) => {
  server.on('error', (e: NodeJS.ErrnoException) => die(`cannot listen on port ${port}: ${e.code ?? 'error'}`));
  server.listen(port, () => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port, mode: cfg.mode }) + '\n'));
};
const onSignals = (stop: () => Promise<void>) => {
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void stop().then(() => process.exit(0), () => process.exit(1)); });
};

if (cfg.mode === 'dev') {
  const relay = createRelay({ authenticator: devTokens(cfg.tokens) });
  listening(relay.server);
  onSignals(() => relay.close());
} else {
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  // An idle client failing must not crash the process; a query on it will fail on its own.
  pool.on('error', () => {});
  const github = githubHttp({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    ...(cfg.githubWeb ? { webBase: cfg.githubWeb } : {}),
    ...(cfg.githubApi ? { apiBase: cfg.githubApi } : {})
  });
  try {
    const app = await startAccountsRelay(cfg, { db: pool, github });
    listening(app.server);
    onSignals(async () => { await app.close(); await pool.end(); });
  } catch {
    await pool.end().catch(() => {});
    die('cannot start: the database is unreachable or its migration failed');
  }
}
