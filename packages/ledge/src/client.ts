import WebSocket from 'ws';
import { PROTOCOL_PORT, parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';

export interface Client {
  send(msg: ClientMessage): void;
  next<T extends ServerMessage['type']>(type: T, timeoutMs?: number): Promise<Extract<ServerMessage, { type: T }>>;
  /** Resolves once the close handshake completes (so queued sends are flushed). */
  close(): Promise<void>;
}

export function connect(opts: { port?: number; host?: string; timeoutMs?: number } = {}): Promise<Client> {
  const port = opts.port ?? PROTOCOL_PORT;
  const host = opts.host ?? '127.0.0.1';
  const ws = new WebSocket(`ws://${host}:${port}`);
  const queue: ServerMessage[] = [];
  const MAX_QUEUED = 100;
  const waiters: Array<{ type: string; resolve: (m: ServerMessage) => void }> = [];
  ws.on('message', data => {
    let msg: ServerMessage;
    try { msg = parseServerMessage(JSON.parse(String(data))); } catch { return; }
    const i = waiters.findIndex(w => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(msg); else { queue.push(msg); if (queue.length > MAX_QUEUED) queue.shift(); }
  });
  const client: Client = {
    send: msg => ws.send(JSON.stringify(msg)),
    next(type, timeoutMs = 1500) {
      const i = queue.findIndex(m => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0] as never);
      return new Promise((resolve, reject) => {
        const w = { type, resolve: (m: ServerMessage) => { clearTimeout(t); resolve(m as never); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${type}`)); }, timeoutMs);
        waiters.push(w);
      });
    },
    close: () => new Promise<void>(res => { if (ws.readyState === WebSocket.CLOSED) return res(); ws.once('close', () => res()); ws.close(); })
  };
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.terminate(); reject(new Error('connect timeout')); }, opts.timeoutMs ?? 1000);
    ws.once('open', () => { clearTimeout(t); resolve(client); });
    let settled = false;
    ws.once('open', () => { settled = true; });
    ws.on('error', e => { if (!settled) { settled = true; clearTimeout(t); reject(e); } });
  });
}
