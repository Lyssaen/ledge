import { createServer, type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  AUTH_TIMEOUT_MS, MOBILE_WS_PATH, PAIR_CODE_TTL_MS, REMOTE_CLOSE, REMOTE_PORT, parseClientMessage, type ClientMessage, type ServerMessage
} from '@ledge/protocol';
import type { ServerHandle } from '../server.js';
import type { DeviceStore } from '../devices.js';
import { PairError, type Pairing } from '../pairing.js';
import type { MobileConfig } from '../../mobile/config.js';
import { PRE_AUTH } from './rights.js';
import { serveMobile } from './static.js';
import { log, quote } from '../../log.js';

/** A connection that fails pairing this many times is closed: the phone reconnects, a script has to too. */
const MAX_PAIR_ERRORS = 3;
/** Far above a registration response or any command a phone sends. */
const MAX_PAYLOAD = 64 * 1024;
/** How long a socket closed by `close()` gets to finish its close handshake before it is cut. */
const CLOSE_GRACE_MS = 1000;
const GOING_AWAY = 1001;
const INTERNAL_ERROR = 1011;

export interface RemoteListener { port: number; close(): Promise<void> }

/** Where a connection comes from, for the log. Behind `tailscale serve` the address is 127.0.0.1; the forwarded one is untrusted text. */
function from(req: IncomingMessage): string {
  const addr = req.socket.remoteAddress ?? 'unknown';
  const fwd = req.headers['x-forwarded-for'];
  return fwd === undefined ? addr : `${addr} (forwarded for ${quote(String(fwd), 100)})`;
}

/**
 * The remote entry (decision D1): its own listener, published by `tailscale serve`, never the local port. It serves the
 * PWA under `/m/` and one WebSocket at `MOBILE_WS_PATH`. On that socket only `PRE_AUTH` messages are read until a known
 * device token arrives; then the socket is handed to the server as a remote peer and owned by this listener until it closes.
 */
export async function startRemoteListener(o: {
  server: ServerHandle; config: MobileConfig; devices: DeviceStore; pairing: Pairing;
  port?: number; host?: string; staticDir?: string; authTimeoutMs?: number; pcName?: string;
}): Promise<RemoteListener> {
  const { server, config, devices, pairing } = o;
  const staticDir = o.staticDir ?? fileURLToPath(new URL('../mobile/', import.meta.url));
  const authTimeoutMs = o.authTimeoutMs ?? AUTH_TIMEOUT_MS;
  const pcName = o.pcName ?? hostname();

  const http = createServer((req, res) => serveMobile(req, res, staticDir, config.origin));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  // Origin protects on top of the token (a browser page elsewhere cannot open the socket); it never identifies the phone.
  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    socket.on('error', () => {});
    let path = '';
    try { path = new URL(req.url ?? '/', 'http://localhost').pathname; } catch { /* refused below */ }
    const origin = req.headers.origin;
    if (path !== MOBILE_WS_PATH || origin !== config.origin) {
      log(`remote upgrade refused from ${from(req)}: path ${quote(path)}, origin ${origin === undefined ? 'none' : quote(origin)}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => accept(ws, from(req)));
  });

  function accept(ws: WebSocket, who: string): void {
    let preAuth = true;
    let pairErrors = 0;
    let timer: NodeJS.Timeout | undefined;
    const shut = (code: number) => { preAuth = false; clearTimeout(timer); ws.close(code); };
    const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { log(`remote socket from ${who} closed: no auth in time`); shut(REMOTE_CLOSE.timeout); }, ms); };
    arm(authTimeoutMs);
    /** Pairing answers go to this socket only, never through a peer (`toRemote` drops them). */
    const send = (m: ServerMessage) => { if (preAuth && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    ws.on('close', () => { preAuth = false; clearTimeout(timer); });
    ws.on('error', (e: Error) => log(`remote socket error from ${who}: ${quote(e.message)}`));

    const failed = (e: unknown) => {
      if (!preAuth) return;
      if (!(e instanceof PairError)) { log(`remote pairing failed from ${who}: ${quote((e as Error).message)}`); return shut(INTERNAL_ERROR); }
      log(`remote pairing refused from ${who}: ${e.reason}`);
      send({ type: 'pair.error', reason: e.reason });
      if (++pairErrors >= MAX_PAIR_ERRORS) shut(REMOTE_CLOSE.unauthenticated);
    };

    const authenticate = (token: string) => {
      const device = devices.byToken(token);
      if (!device) { log(`remote auth refused from ${who}`); return shut(REMOTE_CLOSE.unauthenticated); }
      // Synchronous from here to attach: no message can slip between the pre-auth reader and the server's.
      preAuth = false; clearTimeout(timer); ws.off('message', onMessage);
      devices.touch(device.id).catch(e => log(`last connection of ${device.id} not saved: ${quote((e as Error).message)}`));
      ws.send(JSON.stringify({ type: 'auth.ok', deviceId: device.id, deviceName: device.name, pcName } satisfies ServerMessage));
      log(`remote ${device.id} connected from ${who}`);
      server.attach(ws, { kind: 'remote', deviceId: device.id });
    };

    function onMessage(data: unknown): void {
      if (!preAuth) return;
      let msg: ClientMessage;
      // The protocol's schemas validate every field (code, device name, registration shape) before pairing sees it.
      try { msg = parseClientMessage(JSON.parse(String(data))); }
      catch { log(`remote pre-auth message refused from ${who}: not a valid message`); return shut(REMOTE_CLOSE.unauthenticated); }
      if (!PRE_AUTH.has(msg.type)) { log(`remote pre-auth ${msg.type} refused from ${who}`); return shut(REMOTE_CLOSE.unauthenticated); }
      switch (msg.type) {
        case 'auth': return authenticate(msg.token);
        case 'pair.options':
          pairing.options(msg.code).then(r => {
            if (!preAuth) return;
            send({ type: 'pair.challenge', options: r.options as unknown as Record<string, unknown>, expiresAt: r.expiresAt });
            // The right code earns the time to pass Face ID and answer: the socket stays open until the window closes.
            arm(Math.min(PAIR_CODE_TTL_MS, Math.max(authTimeoutMs, Date.parse(r.expiresAt) - Date.now())));
          }, failed);
          return;
        case 'pair.complete':
          pairing.complete(msg.code, msg.deviceName, msg.webauthn).then(r => {
            log(`paired device ${r.deviceId} from ${who}`);
            send({ type: 'pair.done', token: r.token, deviceId: r.deviceId });
            shut(1000);
          }, failed);
          return;
        default: return shut(REMOTE_CLOSE.unauthenticated);
      }
    }
    ws.on('message', onMessage);
  }

  await new Promise<void>((res, rej) => {
    http.once('error', rej);
    http.listen(o.port ?? REMOTE_PORT, o.host ?? '127.0.0.1', () => { http.off('error', rej); res(); });
  });
  const port = (http.address() as { port: number }).port;

  let closing: Promise<void> | null = null;
  return {
    port,
    /** Stops accepting, then closes every socket it accepted (authenticated or not) with 1001; the server's peers follow. */
    close: () => closing ??= new Promise<void>(res => {
      for (const c of wss.clients) c.close(GOING_AWAY);
      const cut = setTimeout(() => { for (const c of wss.clients) c.terminate(); }, CLOSE_GRACE_MS);
      wss.close();
      http.closeAllConnections();
      http.close(() => { clearTimeout(cut); res(); });
    })
  };
}
