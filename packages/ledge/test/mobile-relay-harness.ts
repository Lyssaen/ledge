// The real relay, on dev tokens, for the daemon's mobile tests. Imported by relative path: the relay is not a dependency of the CLI.
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { devTokens, type Authenticator } from '../../../apps/relay/src/auth.js';
import { createRelay, type HttpHandler } from '../../../apps/relay/src/server.js';
import type { Who } from '../../../apps/relay/src/hub.js';

export type { HttpHandler, RelayControl } from '../../../apps/relay/src/server.js';

/** The account every harness token belongs to. */
export const TEST_ACCOUNT = 'A';

export interface TestRelay {
  /** `http://127.0.0.1:<port>`, a valid relay URL. */
  url: string;
  port: number;
  /** The PC's session token, unique to this harness. */
  pcToken: string;
  /** A token for this device peer (`d_…`) on the same account; the same peer always gets the same token. */
  deviceToken(peer: string): string;
  /** Stops the relay instance currently running; its sockets are terminated. */
  relay: { close(): Promise<void> };
  /** Starts a new relay instance on the same port, with the same tokens and the same `auth` handler. */
  restart(): Promise<void>;
}

/**
 * Starts the real relay (`createRelay` with `devTokens`) on 127.0.0.1 and a free port.
 * `auth` is plugged in as the relay's `http` handler: it may simulate `/auth/*` routes and use `kick` on live sockets.
 */
export async function startTestRelay(opts: { auth?: HttpHandler } = {}): Promise<TestRelay> {
  const pcToken = `pc-${randomUUID()}`;
  const tokens: Record<string, Who> = { [pcToken]: { accountId: TEST_ACCOUNT, peer: 'pc' } };
  // Rebuilt per upgrade so device tokens minted after start are honoured.
  const authenticator: Authenticator = { authenticate: (req) => devTokens(tokens).authenticate(req) };

  let current: ReturnType<typeof createRelay> | null = null;
  const listen = async (port: number): Promise<number> => {
    const r = createRelay({ authenticator, log: () => {}, ...(opts.auth ? { http: opts.auth } : {}) });
    await new Promise<void>((resolve, reject) => {
      r.server.once('error', reject);
      r.server.listen(port, '127.0.0.1', () => { r.server.off('error', reject); resolve(); });
    });
    current = r;
    return (r.server.address() as AddressInfo).port;
  };

  const port = await listen(0);
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    pcToken,
    deviceToken(peer) {
      const token = `dev-${peer}`;
      tokens[token] = { accountId: TEST_ACCOUNT, peer };
      return token;
    },
    relay: {
      async close() {
        const r = current;
        current = null;
        await r?.close();
      }
    },
    async restart() {
      if (current) throw new Error('relay still running');
      await listen(port);
    }
  };
}
