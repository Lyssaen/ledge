import { createServer, connect, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { log as daemonLog } from '../log.js';
import { conptyPanes, type PaneAttachment, type PanesTmux } from './conpty.js';
import { frameLines, PANEHOST_PROTOCOL, type AttachFrame, type PaneRequest, type PaneResponse } from './protocol.js';

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
 * them over a local socket (protocol.ts). Every connection proves it holds the daemon token first. With no pane and no
 * client for `idleExitMs` it closes: nothing is left to keep alive.
 */
export async function startPaneHost(opts: { path: string; token: string; panes?: PanesTmux; idleExitMs?: number; log?: (line: string) => void }): Promise<PaneHost> {
  const panes = opts.panes ?? conptyPanes();
  const log = opts.log ?? daemonLog;
  const idleExitMs = opts.idleExitMs ?? 10 * 60_000;
  const sockets = new Set<Socket>();
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
    sockets.add(sock); busyAt = Date.now();
    let authed = false;
    let attached: { a: PaneAttachment; readOnly: boolean } | null = null;
    const reply = (r: PaneResponse) => { if (!sock.destroyed) sock.write(JSON.stringify(r) + '\n'); };
    const feed = frameLines(line => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(line) as Record<string, unknown>; } catch { sock.destroy(); return; }
      if (attached) { if (typeof msg.input === 'string' && !attached.readOnly) attached.a.write(msg.input); return; }
      const req = msg as unknown as PaneRequest;
      if (!authed) {
        if (req.op === 'hello' && typeof req.token === 'string' && sameToken(req.token, opts.token)) {
          if (req.protocol !== PANEHOST_PROTOCOL) { reply({ id: req.id, ok: false, error: `protocol ${PANEHOST_PROTOCOL}` }); sock.end(); return; }
          authed = true; reply({ id: req.id, ok: true, value: { protocol: PANEHOST_PROTOCOL, pid: process.pid } }); return;
        }
        reply({ id: req.id, ok: false, error: 'unauthorized' }); sock.end(); return;
      }
      handle(sock, req, (a, readOnly) => { attached = { a, readOnly }; })
        .then(value => reply({ id: req.id, ok: true, ...(value === undefined ? {} : { value }) }), (e: Error) => reply({ id: req.id, ok: false, error: e.message }));
    });
    sock.on('data', chunk => { try { feed(chunk); } catch { sock.destroy(); } });
    sock.on('error', () => {});
    sock.on('close', () => { sockets.delete(sock); attached?.a.detach(); busyAt = Date.now(); });
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
      if (sockets.size || names.length) { busyAt = Date.now(); return; }
      if (Date.now() - busyAt >= idleExitMs) { log(`pane host idle for ${idleExitMs} ms: closing`); void close(); }
    });
  }, Math.max(50, Math.min(idleExitMs / 3, 30_000)));

  return { path: opts.path, close, isClosed: () => closed, closed: closedP };
}
