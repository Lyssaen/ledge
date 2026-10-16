import type { Readable, Writable } from 'node:stream';
import WebSocket from 'ws';
import { PROTOCOL_PORT, parseClientMessage, parseServerMessage } from '@ledge/protocol';
import { MAX_FRAME, readFrames } from '../transport/frames.js';
import { readDaemonToken } from '../auth.js';

/** Application protocol over SSH stdin/stdout. Fixed local Ledge endpoint; no arbitrary TCP forwarding.
 *  Presents this machine's daemon token when `~/.ledge/token` exists (the remote `ledge bridge` reads the remote file). */
export function bridge(opts: { input?: Readable; output?: Writable; port?: number; token?: string | null } = {}): Promise<void> {
  const input = opts.input ?? process.stdin, output = opts.output ?? process.stdout;
  const token = opts.token === undefined ? readDaemonToken() : opts.token || undefined;
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? PROTOCOL_PORT}`, {
    maxPayload: MAX_FRAME, handshakeTimeout: 10_000, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
  });
  return new Promise((resolve, reject) => {
    let settled = false, off = () => {};
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      off(); input.pause(); input.off('end', end); input.off('error', fail); output.off('error', fail); output.off('drain', drain);
      ws.terminate(); error ? reject(error) : resolve();
    };
    const fail = (e: Error) => finish(e);
    const end = () => ws.close();
    const drain = () => ws.resume();
    input.on('error', fail); output.on('error', fail); output.on('drain', drain);
    ws.on('open', () => {
      off = readFrames(input, raw => {
        const msg = parseClientMessage(raw);
        if (ws.bufferedAmount > MAX_FRAME) throw new Error('Ledge bridge is overloaded');
        ws.send(JSON.stringify(msg));
      }, fail);
      input.on('end', end); if (input.readableEnded) end();
    });
    ws.on('message', data => {
      try { if (!output.write(`${JSON.stringify(parseServerMessage(JSON.parse(String(data))))}\n`)) ws.pause(); }
      catch (e) { fail(e as Error); }
    });
    ws.on('error', fail);
    ws.on('close', (code) => finish(code === 1000 || code === 1005 ? undefined : new Error(`Ledge daemon disconnected (${code})`)));
  });
}
