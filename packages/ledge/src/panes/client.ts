import { connect, type Socket } from 'node:net';
import { spawn } from 'node:child_process';
import type { Tmux } from '../tmux.js';
import { frameLines, PANEHOST_PROTOCOL, type AttachFrame, type PaneRequest, type PaneResponse } from './protocol.js';

type Op = PaneRequest extends infer R ? R extends { op: infer O } ? O : never : never;
/** The fields of the request `op` names (a member may stand for several ops: `width`, `hasSession`…). */
type Body<O extends Op> = PaneRequest extends infer R ? R extends { op: infer P } ? O extends P ? Omit<R, 'id' | 'op'> : never : never : never;

export type PaneHostClient = Tmux & {
  exitCode(name: string): Promise<number | null | undefined>;
  /** Streams the pane to `output` (its screen first) and `input` to the pane unless read-only; resolves with the
   *  agent's exit code once the pane ends, or null when the host goes away first. */
  attach(name: string, io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; readOnly?: boolean }): Promise<number | null>;
  close(): void;
};

/** Starts `ledge panehost` on its own: detached, so it outlives the daemon that started it. */
export function startDetachedHost(): void {
  spawn(process.execPath, [process.argv[1]!, 'panehost'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

const unreachable = (e: NodeJS.ErrnoException) => e.code === 'ENOENT' || e.code === 'ECONNREFUSED';

/** One authenticated connection to the host: requests by id, or an attach stream. */
interface Conn { sock: Socket; request<O extends Op>(op: O, body: Body<O>): Promise<unknown>; onFrame(f: (frame: Record<string, unknown>) => void): void }

/**
 * The daemon's `Tmux` on Windows: the pane host's ops over its socket. The first call connects; when no host answers it
 * starts one (`start`) and tries again for `connectMs`. A dropped connection fails what was in flight; the next call
 * connects again (starting a host again if none answers).
 */
export function paneHostClient(opts: { path: string; token: () => string | undefined; start: () => void; connectMs?: number }): PaneHostClient {
  const connectMs = opts.connectMs ?? 5000;
  let conn: Promise<Conn> | null = null;
  const socks = new Set<Socket>();

  const once = () => new Promise<Socket>((res, rej) => { const s = connect(opts.path); s.once('connect', () => res(s)); s.once('error', rej); });

  async function open(): Promise<Conn> {
    let sock: Socket | undefined, started = false;
    const end = Date.now() + connectMs;
    for (;;) {
      try { sock = await once(); break; }
      catch (e) {
        if (!unreachable(e as NodeJS.ErrnoException)) throw e;
        if (!started) { started = true; opts.start(); }
        if (Date.now() >= end) throw new Error('pane host not reachable');
        await new Promise(r => setTimeout(r, 100));
      }
    }
    socks.add(sock);
    const pending = new Map<number, { res(v: unknown): void; rej(e: Error): void }>();
    let frameSink: ((f: Record<string, unknown>) => void) | null = null;
    let nextId = 0;
    const s = sock;
    s.on('data', frameLines(line => {
      const msg = JSON.parse(line) as Record<string, unknown>;
      if (typeof msg.id === 'number' && pending.has(msg.id)) {
        const p = pending.get(msg.id)!; pending.delete(msg.id);
        const r = msg as unknown as PaneResponse;
        if (r.ok) p.res(r.value); else p.rej(new Error(r.error));
      } else frameSink?.(msg);
    }));
    s.on('error', () => {});
    s.on('close', () => { socks.delete(s); for (const p of pending.values()) p.rej(new Error('pane host connection closed')); pending.clear(); frameSink?.({ closed: true }); });
    const c: Conn = {
      sock: s,
      request: (op, body) => new Promise((res, rej) => {
        if (s.destroyed) { rej(new Error('pane host connection closed')); return; }
        const id = ++nextId; pending.set(id, { res, rej });
        s.write(JSON.stringify({ id, op, ...body }) + '\n');
      }),
      onFrame: f => { frameSink = f; },
    };
    const token = opts.token();
    if (!token) { s.destroy(); throw new Error('pane host: no daemon token'); }
    await c.request('hello', { token, protocol: PANEHOST_PROTOCOL });
    return c;
  }

  function ensure(): Promise<Conn> {
    if (!conn) {
      const p = open();
      conn = p;
      p.then(c => c.sock.once('close', () => { if (conn === p) conn = null; }), () => { if (conn === p) conn = null; });
    }
    return conn;
  }
  const call = async <O extends Op>(op: O, body: Body<O>) => (await ensure()).request(op, body);

  return {
    async newSession(o) { await call('newSession', { opts: o }); },
    async sendText(name, text) { await call('sendText', { name, text }); },
    async sendKeys(name, keys) { await call('sendKeys', { name, keys }); },
    async capture(name, lines) { return (await call('capture', { name, lines })) as string | null; },
    async width(name) { return (await call('width', { name })) as number | null; },
    async paneCwd() { return null; },
    async hasSession(name) { return (await call('hasSession', { name })) as boolean; },
    async listSessions() { return (await call('listSessions', {})) as string[]; },
    async killSession(name) { await call('killSession', { name }); },
    async setOption() {},
    attachArgs() { throw new Error('a ConPTY pane is attached through the pane host (paneHostClient.attach)'); },
    controlArgs() { return null; },
    async exitCode(name) { const v = await call('exitCode', { name }); return v === null ? undefined : (v as number); },
    async attach(name, io) {
      // An attach takes a connection of its own: its stream would mix with the daemon's requests.
      const c = await open();
      return new Promise<number | null>((resolve, reject) => {
        let done = false;
        const finish = (code: number | null) => { if (done) return; done = true; io.input.off('data', onInput); c.sock.destroy(); resolve(code); };
        const onInput = (d: Buffer | string) => { if (!io.readOnly) c.sock.write(JSON.stringify({ input: String(d) }) + '\n'); };
        c.onFrame(f => {
          if (f.closed) return finish(null);
          const frame = f as unknown as AttachFrame;
          if (frame.attach === 'screen' || frame.attach === 'data') io.output.write(frame.data);
          else if (frame.attach === 'end') finish(frame.code);
        });
        c.request('attach', { name, readOnly: !!io.readOnly }).then(() => { io.input.on('data', onInput); }, e => { done = true; c.sock.destroy(); reject(e); });
      });
    },
    close() { for (const s of socks) s.destroy(); conn = null; },
  };
}
