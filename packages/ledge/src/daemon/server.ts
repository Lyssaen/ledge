import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_PORT, parseClientMessage, type ClientMessage, type ServerMessage, type Session } from '@ledge/protocol';
import type { Store } from './store.js';
import type { Tmux } from '../tmux.js';
import { adapterFor, type KeyPlan } from '../adapters/index.js';
import { verifyGone } from '../adapters/verify.js';
import { reduce } from './state.js';
import { pickName } from '../names.js';
import { log } from '../log.js';

/**
 * Origins allowed to open a WebSocket: the Tauri overlay (packaged and dev server). A browser always
 * sends Origin, so any web page is refused; Node clients (hook, launcher, status) send none and pass.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420'
];

export function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || ALLOWED_ORIGINS.includes(origin);
}

export interface ServerHandle { port: number; close(): Promise<void>; broadcast(msg: ServerMessage): void }

export async function startServer(opts: { store: Store; tmux: Tmux; port?: number; host?: string; now?: () => string; verify?: { attempts?: number; intervalMs?: number } }): Promise<ServerHandle> {
  const { store, tmux } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const wss = new WebSocketServer({
    host: opts.host ?? '127.0.0.1', port: opts.port ?? PROTOCOL_PORT,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const ok = originAllowed(req.headers.origin);
      if (!ok) log(`refused a connection from origin ${String(req.headers.origin)}`);
      return ok;
    }
  });
  await new Promise<void>((res, rej) => { wss.once('listening', res); wss.once('error', rej); });
  const port = (wss.address() as { port: number }).port;

  const send = (ws: WebSocket, msg: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };
  const broadcast = (msg: ServerMessage) => { for (const c of wss.clients) send(c, msg); };
  const unsubscribe = store.onChange(c => broadcast(c.type === 'updated' ? { type: 'session.updated', session: c.session } : { type: 'session.removed', id: c.id }));

  async function runPlan(s: Session, plan: KeyPlan): Promise<void> {
    if (!s.tmuxSession) throw new Error('session has no terminal (started without ledge)');
    for (const step of plan) {
      if ('text' in step) await tmux.sendText(s.tmuxSession, step.text);
      else await tmux.sendKeys(s.tmuxSession, step.keys);
    }
  }

  const inFlight = new Set<string>();

  async function injectAndVerify(id: string, plan: KeyPlan): Promise<void> {
    const s = store.get(id);
    if (!s) throw new Error(`unknown session ${id}`);
    if (inFlight.has(id)) throw new Error('a decision is already in progress');
    inFlight.add(id);
    try {
      const adapter = adapterFor(s.tool);
      const decided = s.pending;
      const stillTheSame = () => {
        const cur = store.get(id)?.pending;
        return cur === decided || (!!cur && !!decided && cur.kind === decided.kind && cur.text === decided.text);
      };
      try { await runPlan(s, plan); }
      catch (e) {
        store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: (e as Error).message });
        throw e;
      }
      const gone = await verifyGone(() => tmux.capture(s.tmuxSession!, 5), p => adapter.promptStillVisible(p), opts.verify);
      if (!stillTheSame()) return; // a newer prompt arrived meanwhile: leave it alone
      if (gone) store.apply(id, { name: 'Decided', at: now(), source: 'daemon' });
      else store.apply(id, { name: 'InjectFailed', at: now(), source: 'daemon', text: 'the terminal did not take it' });
    } finally { inFlight.delete(id); }
  }

  const READ_ONLY = 'session started without ledge, read only';

  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'snapshot.request': return send(ws, { type: 'snapshot', sessions: store.all() });
      case 'session.register': {
        const existing = store.get(msg.session.id);
        if (existing && existing.source === 'hook_only') {
          // What the hooks already learned wins over the launcher's fresh record, exit included.
          store.upsert({
            ...existing, ...msg.session, state: existing.state, pending: existing.pending, lastActivityAt: existing.lastActivityAt,
            lastHookAt: existing.lastHookAt, exitCode: existing.exitCode, exitedAt: existing.exitedAt, source: 'launcher'
          });
        } else store.upsert(msg.session);
        return;
      }
      case 'session.event': {
        if (!store.get(msg.id)) {
          const taken = store.all().map(s => s.name);
          const base: Session = { id: msg.id, name: pickName(taken), tool: 'claude', cwd: '', project: 'unknown', title: 'untracked session', tmuxSession: null, state: 'working', helpers: [], startedAt: msg.event.at, lastActivityAt: msg.event.at, source: 'hook_only' };
          store.upsert(reduce(base, msg.event));
        } else store.apply(msg.id, msg.event);
        return;
      }
      case 'session.unregister':
        store.apply(msg.id, { name: 'SessionEnd', at: now(), source: 'hook', exitCode: msg.exitCode });
        return;
      case 'session.decide': {
        const s = store.get(msg.id); if (!s) return send(ws, { type: 'error', id: msg.id, message: 'unknown session' });
        if (s.source === 'hook_only') return send(ws, { type: 'error', id: msg.id, message: READ_ONLY });
        if (!s.pending) return send(ws, { type: 'error', id: msg.id, message: 'nothing to decide' });
        return injectAndVerify(msg.id, adapterFor(s.tool).keysFor(msg.decision, s.pending));
      }
      case 'session.reply': {
        const s = store.get(msg.id); if (!s) return send(ws, { type: 'error', id: msg.id, message: 'unknown session' });
        if (s.source === 'hook_only') return send(ws, { type: 'error', id: msg.id, message: READ_ONLY });
        return injectAndVerify(msg.id, adapterFor(s.tool).replyPlan(msg.text));
      }
      case 'session.interrupt': {
        const s = store.get(msg.id);
        if (s?.source === 'hook_only') return send(ws, { type: 'error', id: msg.id, message: READ_ONLY });
        if (!s?.tmuxSession) return;
        await tmux.sendKeys(s.tmuxSession, adapterFor(s.tool).interruptKeys());
        return;
      }
      case 'session.kill': {
        const s = store.get(msg.id); if (!s) return;
        if (s.source === 'hook_only') return send(ws, { type: 'error', id: msg.id, message: READ_ONLY });
        if (s.tmuxSession) await tmux.killSession(s.tmuxSession);
        store.apply(msg.id, { name: 'PaneGone', at: now(), source: 'daemon' });
        return;
      }
      case 'session.focus':
        return; // handled by the overlay plan via wt.exe; the daemon only acknowledges
    }
  }

  wss.on('connection', ws => {
    ws.on('error', e => log(`socket error: ${e.message}`));
    send(ws, { type: 'snapshot', sessions: store.all() });
    ws.on('message', data => {
      let msg: ClientMessage;
      try { msg = parseClientMessage(JSON.parse(String(data))); }
      catch (e) { log(`invalid message: ${(e as Error).message}`); return send(ws, { type: 'error', message: 'invalid message' }); }
      handle(ws, msg).catch(e => { log(`${msg.type} failed: ${(e as Error).message}`); send(ws, { type: 'error', id: 'id' in msg ? msg.id : undefined, message: (e as Error).message }); });
    });
  });

  return {
    port,
    broadcast,
    close: () => new Promise(res => { unsubscribe(); for (const c of wss.clients) c.terminate(); wss.close(() => res()); })
  };
}
