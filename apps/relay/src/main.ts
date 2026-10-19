import { z } from 'zod';
import { RelayPeerSchema } from '@ledge/protocol';
import { devTokens } from './auth.js';
import { createRelay } from './server.js';

const TokensSchema = z.record(z.string().min(1), z.object({ accountId: z.string().min(1), peer: RelayPeerSchema }));

function die(msg: string): never {
  process.stderr.write(`ledge-relay: ${msg}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') die('refusing to start with dev tokens in production (GitHub accounts arrive in lot 2)');
const raw = process.env.LEDGE_RELAY_DEV_TOKENS;
if (!raw) die('LEDGE_RELAY_DEV_TOKENS is not set; it must be JSON {"<token>":{"accountId":"...","peer":"pc"|"d_..."}}');
let parsed: z.infer<typeof TokensSchema>;
try { parsed = TokensSchema.parse(JSON.parse(raw)); } catch { die('LEDGE_RELAY_DEV_TOKENS is not valid: expected JSON {"<token>":{"accountId":"...","peer":"pc"|"d_..."}}'); }

const port = Number(process.env.PORT ?? 8787);
const relay = createRelay({ authenticator: devTokens(parsed) });
relay.server.listen(port, () => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ev: 'listening', port }) + '\n'));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void relay.close().then(() => process.exit(0)); });
