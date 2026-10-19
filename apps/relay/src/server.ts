import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { SEALED_MAX, type RelayServerMessage } from '@ledge/protocol';
import { RELAY_PROTOCOL_PREFIX, type Authenticator } from './auth.js';
import { Hub, type Conn, type Limits } from './hub.js';
import { jsonLog, type RelayLog } from './log.js';

export interface RelayOptions { authenticator: Authenticator; log?: RelayLog; limits?: Partial<Limits> }

function refuse(socket: Duplex, status: '401 Unauthorized' | '404 Not Found'): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function createRelay(opts: RelayOptions): { server: http.Server; close(): Promise<void> } {
  const log = opts.log ?? jsonLog;
  const hub = new Hub(log, opts.limits);
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

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (new URL(req.url ?? '/', 'http://relay').pathname !== '/ws') {
      log({ ev: 'refused', reason: 'bad_path' });
      return refuse(socket, '404 Not Found');
    }
    opts.authenticator.authenticate(req).then((who) => {
      if (!who) {
        log({ ev: 'refused', reason: 'no_auth' });
        return refuse(socket, '401 Unauthorized');
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn: Conn = {
          send: (msg: RelayServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); },
          close: (code, reason) => ws.close(code, reason)
        };
        ws.on('message', (data) => hub.receive(conn, data.toString('utf8')));
        ws.on('close', (code) => hub.detach(conn, code));
        ws.on('error', () => {});
        hub.attach(conn, who);
      });
    }, () => {
      log({ ev: 'refused', reason: 'no_auth' });
      refuse(socket, '401 Unauthorized');
    });
  });

  return {
    server,
    close: () => new Promise<void>((resolve) => {
      for (const c of wss.clients) c.terminate();
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
