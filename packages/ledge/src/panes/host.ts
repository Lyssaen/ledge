import { createServer, connect, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { log as daemonLog } from '../log.js';
import { conptyPanes, type PaneAttachment, type PanesTmux } from './conpty.js';
import { frameLines, PANEHOST_PROTOCOL, proof, type AttachFrame, type PaneRequest, type PaneResponse } from './protocol.js';

export interface PaneHost { path: string; close(): Promise<void>; isClosed(): boolean; closed: Promise<void> }

const sameToken = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** A Unix socket left by a host that died is removed; one that answers belongs to a live host. */
async function clearStaleSocket(path: string): Promise<void> {
  if (process.platform === 'win32' || !existsSync(path)) return;
  const live = await new Promise<boolean>(r => { const s = connect(path); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
  if (live) throw Object.assign(new Error(`pane host already listening on ${path}`), { code: 'EADDRINUSE' });
  unlinkSync(path);
}

/**
 * `ledge panehost`: keeps the agents' ConPTY panes in a process of their own, so they outlive the daemon, and serves
 * them over a local socket (protocol.ts). Every connection proves it holds the daemon token first (handshake, the token
 * never sent), within `helloMs` or it is closed. With no pane and no authenticated client for `idleExitMs` it closes:
 * nothing is left to keep alive.
 */
export async function startPaneHost(opts: { path: string; token: string; panes?: PanesTmux; idleExitMs?: number; helloMs?: number; log?: (line: string) => void }): Promise<PaneHost> {
  const panes = opts.panes ?? conptyPanes();
  const log = opts.log ?? daemonLog;
  const idleExitMs = opts.idleExitMs ?? 10 * 60_000;
  const helloMs = opts.helloMs ?? 2000;
  const sockets = new Set<Socket>();
  /** The connections that passed the handshake: only they keep the host up. */
  const authed = new Set<Socket>();
  let closed = false, busyAt = Date.now();
  let resolveClosed!: () => void;
  const closedP = new Promise<void>(r => { resolveClosed = r; });

  async function handle(sock: Socket, req: PaneRequest, attach: (a: PaneAttachment, readOnly: boolean) => void): Promise<unknown> {
    switch (req.op) {
      case 'newSession': return panes.newSession(req.opts);
      case 'sendText': return panes.sendText(req.name, req.text);
      case 'sendKeys': return panes.sendKeys(req.name, req.keys);
      case 'capture': return panes.capture(req.name, req.lines);
      case 'width': return panes.width!(req.name);
      case 'hasSession': return panes.hasSession(req.name);
      case 'killSession': return panes.killSession(req.name);
      case 'exitCode': return panes.exitCode(req.name) ?? null;
      case 'listSessions': return panes.listSessions();
      case 'attach': {
        const frame = (f: AttachFrame) => { if (!sock.destroyed) sock.write(JSON.stringify(f) + '\n'); };
        const a = await panes.attachTo(req.name, { data: data => frame({ attach: 'data', data }), end: code => { frame({ attach: 'end', code }); sock.end(); } });
        if (!a) throw new Error(`no pane ${req.name}`);
        attach(a, req.readOnly);
        // The screen goes right after the answer: the client knows the attach was taken before it paints.
        setImmediate(() => frame({ attach: 'screen', data: a.screen }));
        return undefined;
      }
      default: throw new Error(`unknown op ${(req as { op: string }).op}`);
    }
  }

  const server = createServer(sock => {
    sockets.add(sock);
    // Who has not proved the token in time is let go: a stray or hostile connection holds nothing open.
    const helloTimer = setTimeout(() => { if (!authed.has(sock)) sock.destroy(); }, helloMs);
    let hostNonce: string | null = null, clientNonce = '';
    let attached: { a: PaneAttachment; readOnly: boolean } | null = null;
    const reply = (r: PaneResponse) => { if (!sock.destroyed) sock.write(JSON.stringify(r) + '\n'); };
    const refuse = (id: unknown, error: string) => { reply({ id: typeof id === 'number' ? id : 0, ok: false, error }); sock.end(); };
    const feed = frameLines(line => {
      let msg: unknown;
      try { msg = JSON.parse(line); } catch { sock.destroy(); return; }
      // Only plain objects with a numeric id (or an attach's input) are frames; anything else ends this connection.
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) { sock.destroy(); return; }
      const m = msg as Record<string, unknown>;
      if (attached) { if (typeof m.input === 'string' && !attached.readOnly) attached.a.write(m.input); return; }
      if (typeof m.id !== 'number' || typeof m.op !== 'string') { sock.destroy(); return; }
      const req = m as unknown as PaneRequest;
      if (!authed.has(sock)) {
        if (req.op === 'hello' && hostNonce === null) {
          if (req.protocol !== PANEHOST_PROTOCOL) return refuse(req.id, `protocol ${PANEHOST_PROTOCOL}`);
          if (typeof req.nonce !== 'string' || req.nonce.length < 16 || req.nonce.length > 128) return refuse(req.id, 'unauthorized');
          clientNonce = req.nonce; hostNonce = randomBytes(16).toString('hex');
          reply({ id: req.id, ok: true, value: { protocol: PANEHOST_PROTOCOL, nonce: hostNonce, proof: proof(opts.token, 'host', clientNonce, hostNonce) } });
          return;
        }
        if (req.op === 'auth' && hostNonce !== null && typeof req.proof === 'string' && sameToken(req.proof, proof(opts.token, 'client', clientNonce, hostNonce))) {
          authed.add(sock); clearTimeout(helloTimer); busyAt = Date.now();
          reply({ id: req.id, ok: true, value: { pid: process.pid } });
          return;
        }
        return refuse(req.id, 'unauthorized');
      }
      handle(sock, req, (a, readOnly) => { if (sock.destroyed) a.detach(); else attached = { a, readOnly }; })
        .then(value => reply({ id: req.id, ok: true, ...(value === undefined ? {} : { value }) }), (e: Error) => reply({ id: req.id, ok: false, error: e?.message ?? String(e) }));
    });
    sock.on('data', chunk => { try { feed(chunk); } catch { sock.destroy(); } });
    sock.on('error', () => {});
    sock.on('close', () => { clearTimeout(helloTimer); sockets.delete(sock); authed.delete(sock); attached?.a.detach(); busyAt = Date.now(); });
  });

  await clearStaleSocket(opts.path);
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(opts.path, () => { server.off('error', rej); res(); }); });
  log(`pane host listening on ${opts.path} (pid ${process.pid})`);

  async function close(): Promise<void> {
    if (closed) return; closed = true;
    clearInterval(idle);
    for (const name of await panes.listSessions()) await panes.killSession(name).catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
    resolveClosed();
  }
  const idle = setInterval(() => {
    void panes.listSessions().then(names => {
      if (authed.size || names.length) { busyAt = Date.now(); return; }
      if (Date.now() - busyAt >= idleExitMs) { log(`pane host idle for ${idleExitMs} ms: closing`); void close(); }
    });
  }, Math.max(50, Math.min(idleExitMs / 3, 30_000)));

  return { path: opts.path, close, isClosed: () => closed, closed: closedP };
}
