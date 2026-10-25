import WebSocket from 'ws';
import { PROTOCOL_PORT } from '@ledge/protocol';
import { createDaemonClient, createFleetClient, createTokenSource, LOCAL_MACHINE, type DaemonClient, type TokenRead, type TokenSource } from '@ledge/fleet';
import { readDaemonToken } from '../auth.js';

/** The daemon token as the fleet reads it: the file's token, `absent` when there is none (the daemon never ran). */
async function readToken(): Promise<TokenRead> {
  try { const token = readDaemonToken(); return token ? { kind: 'token', token } : { kind: 'absent' }; }
  catch { return { kind: 'unavailable' }; }
}

/** The TUI's fleet, as Desktop's: the local daemon, the machines it lists reached through its `/ssh/<alias>`, a fallen
 *  machine's sessions kept on screen. `port` and `token` are test hooks (the local URL is pinned by the fleet, so it goes through
 *  `makeClient`; `token: null` sends none, for a mock daemon that asks for none). */
export function createTuiFleet(opts: { port?: number; minBackoffMs?: number; maxBackoffMs?: number; token?: TokenSource | null } = {}): DaemonClient {
  const local = LOCAL_MACHINE.url!, port = opts.port ?? PROTOCOL_PORT;
  const backoff = { ...(opts.minBackoffMs ? { minBackoffMs: opts.minBackoffMs } : {}), ...(opts.maxBackoffMs ? { maxBackoffMs: opts.maxBackoffMs } : {}) };
  return createFleetClient(
    [LOCAL_MACHINE],
    c => createDaemonClient({ url: c.url.replace(local, `ws://127.0.0.1:${port}`), WebSocketImpl: WebSocket as never, token: c.token, ...backoff }),
    { prefix: 'tui', keepStale: true, machinesFromDaemon: true, ...(opts.token === null ? {} : { token: opts.token ?? createTokenSource(readToken) }) }
  );
}
