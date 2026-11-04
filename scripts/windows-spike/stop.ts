// Stops the daemon the way Desktop will on Windows: `daemon.stop` over its WebSocket (there is no SIGTERM to send).
import { connect } from '../../packages/ledge/src/client.js';
const c = await connect({ timeoutMs: 3000 });
await c.next('snapshot');
c.send({ type: 'daemon.stop' });
await new Promise(r => setTimeout(r, 300));
await c.close().catch(() => {});
console.log('daemon.stop sent');
process.exit(0);
