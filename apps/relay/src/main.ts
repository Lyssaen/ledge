import { ConfigError, loadConfig } from './config.js';
import { DatabaseOpenError } from './database.js';
import { DatabaseUnreachableError, ListenError, startRelay } from './run.js';

function die(msg: string): never {
  process.stderr.write(`ledge-relay: ${msg}\n`);
  process.exit(1);
}

try {
  const cfg = loadConfig(process.env);
  const relay = await startRelay(cfg);
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port: relay.port, mode: cfg.mode }) + '\n');
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void relay.close().then(() => process.exit(0), () => process.exit(1)); });
} catch (e) {
  if (e instanceof ConfigError) die(e.message);
  if (e instanceof ListenError) die(`cannot listen on port ${e.port}: ${e.code}`);
  if (e instanceof DatabaseUnreachableError) die(`cannot start: the database is unreachable or its migration failed${e.code ? ` (${e.code})` : ''}`);
  if (e instanceof DatabaseOpenError) die(`cannot open the embedded database at ${e.dir}: move this directory aside to start a fresh one (accounts, sessions, linked phones and push subscriptions are then lost)`);
  throw e;
}
