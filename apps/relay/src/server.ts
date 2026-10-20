import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { RelayPeerSchema, SEALED_MAX, type RelayPeer, type RelayServerMessage } from '@ledge/protocol';
import { RELAY_PROTOCOL_PREFIX, type Authenticator } from './auth.js';
import { Hub, type Conn, type Limits } from './hub.js';
import { countedLog, jsonLog, type RelayLog, type RelayLogEvent } from './log.js';

/** What an HTTP route may do to live sockets. */
export interface RelayControl {
  kick(accountId: string, peer: RelayPeer, code: number, reason: string): void;
}
/** Resolves true when it handled the request. A throw answers 500. */
export type HttpHandler = (req: IncomingMessage, res: ServerResponse, relay: RelayControl) => Promise<boolean>;

export interface RelayOptions {
  authenticator: Authenticator;
  log?: RelayLog;
  limits?: Partial<Limits>;
  /** Interval between pings; a client that missed the previous ping is terminated. Default 30 s. */
  heartbeatMs?: number;
  /** A receiver with more than this many bytes not yet sent is terminated instead of buffered further. Default 8 MiB. */
  maxBufferedBytes?: number;
  /** Tried before `/healthz` and the 404. */
  http?: HttpHandler;
  /** An `authenticate` still pending after this is abandoned and the upgrade answered 503. Default 10 s. */
  authTimeoutMs?: number;
  /** Upgrades awaiting `authenticate` beyond this are answered 503 at once. Default 64. */
  maxPendingUpgrades?: number;
  /** Refusals are logged once per reason and interval, with a count. Default 60 s. */
  refusedLogMs?: number;
}

function refuse(socket: Duplex, status: '401 Unauthorized' | '404 Not Found' | '503 Service Unavailable'): void {
  socket.once('finish', () => socket.destroy());
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createRelay(opts: RelayOptions): { server: http.Server; close(): Promise<void> } {
  const log = opts.log ?? jsonLog;
  const hub = new Hub(log, opts.limits);
  const maxBuffered = opts.maxBufferedBytes ?? 8 * 1_048_576;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: SEALED_MAX + 4096,
    handleProtocols: (protocols: Set<string>) => [...protocols].find((p) => p.startsWith(RELAY_PROTOCOL_PREFIX)) ?? false
  });

  type Refused = Extract<RelayLogEvent, { ev: 'refused' }>;
  const refusals = countedLog<Refused>(log, opts.refusedLogMs ?? 60_000);
  const refusedFor = (reason: Refused['reason']) => refusals.add({ ev: 'refused', reason });

  const server = http.createServer((req, res) => {
    const serve = async () => {
      try {
        if (opts.http && await opts.http(req, res, hub)) return;
      } catch {
        log({ ev: 'http_error' });
        if (!res.headersSent) res.writeHead(500);
        res.end();
        return;
      }
      const ok = req.method === 'GET' && req.url === '/healthz';
      res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain' });
      res.end(ok ? 'ok' : 'not found');
    };
    serve().catch(() => res.destroy());
  });

  // A half-open socket (sleeping laptop, suspended phone) sends no FIN: only a missed pong reveals it.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, opts.heartbeatMs ?? 30_000);

  let closing = false;
  const pathOf = (url: string | undefined): string | null => {
    try { return new URL(url ?? '/', 'http://relay').pathname; } catch { return null; }
  };

  const authTimeoutMs = opts.authTimeoutMs ?? 10_000;
  const maxPending = opts.maxPendingUpgrades ?? 64;
  let pending = 0;

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (pathOf(req.url) !== '/ws') {
      refusedFor('bad_path');
      return refuse(socket, '404 Not Found');
    }
    if (pending >= maxPending) {
      refusedFor('busy');
      return refuse(socket, '503 Service Unavailable');
    }
    // The place is taken until the outcome is decided, by an answer or by the delay: a stuck authenticate frees it.
    pending++;
    let decided = false;
    const decide = (): boolean => {
      if (decided) return false;
      decided = true;
      pending--;
      clearTimeout(timer);
      return true;
    };
    const timer = setTimeout(() => {
      if (!decide()) return;
      refusedFor('timeout');
      refuse(socket, '503 Service Unavailable');
    }, authTimeoutMs);

    // Promise.resolve().then: a synchronous throw or a non-thenable return cannot escape this listener.
    Promise.resolve().then(() => opts.authenticator.authenticate(req)).then(
      (who) => {
        if (!decide()) return;
        if (closing) return refuse(socket, '401 Unauthorized');
        if (!who) {
          refusedFor('no_auth');
          return refuse(socket, '401 Unauthorized');
        }
        if (!RelayPeerSchema.safeParse(who.peer).success) {
          refusedFor('bad_peer');
          return refuse(socket, '401 Unauthorized');
        }
        // From here the socket may already be upgraded: a failure destroys it, never answers it over HTTP.
        try {
          wss.handleUpgrade(req, socket, head, (ws) => {
            const conn: Conn = {
              send: (msg: RelayServerMessage) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                // A slow or half-open receiver must not grow relay memory without bound.
                if (ws.bufferedAmount > maxBuffered) return ws.terminate();
                ws.send(JSON.stringify(msg));
              },
              close: (code, reason) => ws.close(code, reason)
            };
            alive.add(ws);
            ws.on('pong', () => alive.add(ws));
            ws.on('message', (data) => hub.receive(conn, data.toString('utf8')));
            ws.on('close', (code) => hub.detach(conn, code));
            ws.on('error', () => {});
            try { hub.attach(conn, who); } catch { ws.terminate(); }
          });
        } catch {
          socket.destroy();
        }
      },
      () => {
        if (!decide()) return;
        refusedFor('auth_error');
        refuse(socket, '401 Unauthorized');
      }
    ).catch(() => socket.destroy());
  });

  return {
    server,
    close: () => new Promise<void>((resolve) => {
      closing = true;
      clearInterval(heartbeat);
      refusals.stop();
      for (const c of wss.clients) c.terminate();
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
