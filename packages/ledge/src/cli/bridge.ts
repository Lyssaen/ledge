import { ledgePort } from '../port.js';
import type { Readable, Writable } from 'node:stream';
import WebSocket from 'ws';
import { parseClientMessage, parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';
import { readDaemonToken } from '../auth.js';
import { MAX_FRAME, readFrames } from '../transport/frames.js';
import { dropLogger, frameType, unknownRequest } from '../transport/unparsed.js';

function bearerHeaders(): Record<string, string> {
  const token = readDaemonToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Application protocol over SSH stdin/stdout. Fixed local Ledge endpoint; no arbitrary TCP forwarding.
 *  A frame this version cannot read is dropped and the link stays up: a front's is answered with an `error` (never forwarded),
 *  a daemon's is left out; only a malformed `snapshot` still stops it. Logs go to stderr: stdout is the protocol. */
export function bridge(opts: { input?: Readable; output?: Writable; port?: number; log?: (line: string) => void } = {}): Promise<void> {
  const input = opts.input ?? process.stdin, output = opts.output ?? process.stdout;
  const dropped = dropLogger(opts.log ?? (line => { process.stderr.write(`${line}\n`); }), 'ledge bridge');
  const ws = new WebSocket(`ws://127.0.0.1:${opts.port ?? ledgePort()}`, { maxPayload: MAX_FRAME, handshakeTimeout: 10_000, headers: bearerHeaders() });
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
    const toFront = (msg: ServerMessage) => { if (!output.write(`${JSON.stringify(msg)}\n`)) ws.pause(); };
    // A newer front's message: told at once, by name, rather than closing the link; the daemon never sees it.
    const refuse = (raw: unknown, e?: unknown) => { dropped(frameType(raw), e); toFront(unknownRequest(raw)); };
    ws.on('open', () => {
      off = readFrames(input, raw => {
        let msg: ClientMessage;
        try { msg = parseClientMessage(raw); } catch (e) { return refuse(raw, e); }
        // The machines list and the projects are private to their host (spec §5.2, build spec §5): a front's set never reaches this daemon through the bridge.
        if (msg.type === 'machines.set' || msg.type === 'projects.set' || msg.type === 'island.set') return;
        if (ws.bufferedAmount > MAX_FRAME) throw new Error('Ledge bridge is overloaded');
        ws.send(JSON.stringify(msg));
      }, fail, { onBadLine: (_line, e) => refuse(undefined, e) });
      input.on('end', end); if (input.readableEnded) end();
    });
    ws.on('message', data => {
      let raw: unknown, msg: ServerMessage;
      try { raw = JSON.parse(String(data)); msg = parseServerMessage(raw); }
      catch (e) {
        // Without a readable snapshot the front has no state to build on: that one still stops the link.
        if (frameType(raw) === 'snapshot') return fail(e as Error);
        return dropped(frameType(raw), e);
      }
      // This daemon's machine list and projects are meaningless to the front (spec §5.2, build spec §5), and an older peer rejects the unknown type (spec §14).
      if (msg.type === 'machines' || msg.type === 'projects' || msg.type === 'island') return;
      try { toFront(msg); } catch (e) { fail(e as Error); }
    });
    ws.on('error', fail);
    ws.on('close', (code) => finish(code === 1000 || code === 1005 ? undefined : new Error(`Ledge daemon disconnected (${code})`)));
  });
}
