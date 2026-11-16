import { loadConfig } from './config.js';
import { startRelay, startupErrorLine } from './run.js';

function die(msg: string): never {
  process.stderr.write(`ledge-relay: ${msg}\n`);
  process.exit(1);
}

try {
  const cfg = loadConfig(process.env);
  const relay = await startRelay(cfg);
  // A server error after listening ends the relay with one line, as it did before the shared start-up, not a stack.
  relay.server.on('error', (e: NodeJS.ErrnoException) => die(`cannot listen on port ${cfg.port}: ${e.code ?? 'error'}`));
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port: relay.port, mode: cfg.mode }) + '\n');
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void relay.close().then(() => process.exit(0), () => process.exit(1)); });
} catch (e) {
  const line = startupErrorLine(e);
  if (line === null) throw e;
  die(line);
}
