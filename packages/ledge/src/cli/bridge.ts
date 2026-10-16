import type { Readable, Writable } from 'node:stream';
import WebSocket from 'ws';
import { PROTOCOL_PORT, parseClientMessage, parseServerMessage } from '@ledge/protocol';
import { MAX_FRAME, readFrames } from '../transport/frames.js';

/** Application protocol over SSH stdin/stdout. Fixed local Ledge endpoint; no arbitrary TCP forwarding. */
export function bridge(opts: { input?: Readable; output?: Writable; port?: number } = {}): Promise<void> {
  const input = opts.input ?? process.stdin, output = opts.output ?? process.stdout;
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? PROTOCOL_PORT}`, { maxPayload: MAX_FRAME, handshakeTimeout: 10_000 });
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
        // The machines list is private to its host (spec §5.2): a front's machines.set never reaches this daemon through the bridge.
        if (msg.type === 'machines.set') return;
        if (ws.bufferedAmount > MAX_FRAME) throw new Error('Ledge bridge is overloaded');
        ws.send(JSON.stringify(msg));
      }, fail);
      input.on('end', end); if (input.readableEnded) end();
    });
    ws.on('message', data => {
      try {
        const msg = parseServerMessage(JSON.parse(String(data)));
        // This daemon's machine list is meaningless to the front (spec §5.2), and an older peer rejects the unknown type (spec §14).
        if (msg.type === 'machines') return;
        if (!output.write(`${JSON.stringify(msg)}\n`)) ws.pause();
      }
      catch (e) { fail(e as Error); }
    });
    ws.on('error', fail);
    ws.on('close', (code) => finish(code === 1000 || code === 1005 ? undefined : new Error(`Ledge daemon disconnected (${code})`)));
  });
}
