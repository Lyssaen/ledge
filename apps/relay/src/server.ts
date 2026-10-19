import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { SEALED_MAX, type RelayServerMessage } from '@ledge/protocol';
import { RELAY_PROTOCOL_PREFIX, type Authenticator } from './auth.js';
import { Hub, type Conn, type Limits } from './hub.js';
import { jsonLog, type RelayLog } from './log.js';

export interface RelayOptions {
  authenticator: Authenticator;
  log?: RelayLog;
  limits?: Partial<Limits>;
  /** Interval between pings; a client that missed the previous ping is terminated. Default 30 s. */
  heartbeatMs?: number;
  /** A receiver with more than this many bytes not yet sent is terminated instead of buffered further. Default 8 MiB. */
  maxBufferedBytes?: number;
}

function refuse(socket: Duplex, status: '401 Unauthorized' | '404 Not Found'): void {
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

  const server = http.createServer((req, res) => {
    const ok = req.method === 'GET' && req.url === '/healthz';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain' });
    res.end(ok ? 'ok' : 'not found');
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

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (pathOf(req.url) !== '/ws') {
      log({ ev: 'refused', reason: 'bad_path' });
      return refuse(socket, '404 Not Found');
    }
    // Promise.resolve().then: a synchronous throw or a non-thenable return cannot escape this listener.
    Promise.resolve().then(() => opts.authenticator.authenticate(req)).then(
      (who) => {
        if (closing) return refuse(socket, '401 Unauthorized');
        if (!who) {
          log({ ev: 'refused', reason: 'no_auth' });
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
        log({ ev: 'refused', reason: 'auth_error' });
        refuse(socket, '401 Unauthorized');
      }
    ).catch(() => socket.destroy());
  });

  return {
    server,
    close: () => new Promise<void>((resolve) => {
      closing = true;
      clearInterval(heartbeat);
      for (const c of wss.clients) c.terminate();
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
