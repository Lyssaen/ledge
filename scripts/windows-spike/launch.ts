// Launches one Claude session in the spike's work folder and leaves it running (Desktop native mode checks).
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerMessage } from '@ledge/protocol';
import { connect } from '../../packages/ledge/src/client.js';
const c = await connect({ timeoutMs: 3000 });
await c.next('snapshot');
c.send({ type: 'session.launch', tool: 'claude', cwd: join(tmpdir(), 'ledge-spike', 'work') });
const m = await c.next('session.launched', 30_000) as Extract<ServerMessage, { type: 'session.launched' }>;
console.log('launched', m.id);
await c.close().catch(() => {});
process.exit(0);
