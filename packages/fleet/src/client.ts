import { parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';
import type { Fleet } from './machines';
import { DAEMON_PROTOCOL_PREFIX, type TokenSource } from './token';

export type DaemonStatus = 'connecting' | 'open' | 'unreachable';
export interface DaemonClient {
  fleet?: Fleet;
  connect(): void; close(): void; send(msg: ClientMessage): void; status(): DaemonStatus;
  onMessage(fn: (m: ServerMessage) => void): () => void; onStatus(fn: (s: DaemonStatus) => void): () => void;
}
type WsLike = { send(data: string): void; close(): void; onopen: null | (() => void); onclose: null | (() => void); onerror: null | (() => void); onmessage: null | ((ev: { data: unknown }) => void); readyState: number };
type WsCtor = new (url: string, protocols?: string[]) => WsLike;

/** With `token`, every socket offers `ledge.<token>` and none opens without one (an absent or unreadable token is « unreachable », retried). Without it, the socket carries no protocol. */
export function createDaemonClient(opts: { url: string; token?: TokenSource; WebSocketImpl?: WsCtor; minBackoffMs?: number; maxBackoffMs?: number }): DaemonClient {
  const Ws = (opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket);
  const min = opts.minBackoffMs ?? 2000, max = opts.maxBackoffMs ?? 30000, token = opts.token;
  let ws: WsLike | null = null, status: DaemonStatus = 'connecting', backoff = min, timer: ReturnType<typeof setTimeout> | null = null, closed = false;
  /** A drop or a failed read since the last snapshot: the cached token may be stale (a daemon restarted with a new one), so the next read is fresh. */
  let failed = false;
  /** Bumped by each open() and close(): a token read answers only the attempt that asked for it. */
  let attempt = 0;
  const msgFns = new Set<(m: ServerMessage) => void>(), statusFns = new Set<(s: DaemonStatus) => void>();
  const setStatus = (s: DaemonStatus) => { if (s !== status) { status = s; statusFns.forEach(f => f(s)); } };
  const schedule = () => { if (closed) return; timer = setTimeout(open, backoff); backoff = Math.min(max, backoff * 2); };
  function open() {
    if (closed) return;
    setStatus(status === 'open' ? 'connecting' : status);
    if (!token) { dial(new Ws(opts.url)); return; }
    const mine = ++attempt;
    void token.get(failed).then(r => {
      if (closed || mine !== attempt) return;
      // A browser refuses a malformed subprotocol with an error that quotes it: swallowed, so the token never reaches a log.
      if (r.kind === 'token') { try { dial(new Ws(opts.url, [DAEMON_PROTOCOL_PREFIX + r.token])); return; } catch { /* retried below */ } }
      failed = true; setStatus('unreachable'); schedule();
    });
  }
  function dial(sock: WsLike) {
    ws = sock;
    sock.onopen = () => { if (ws !== sock) return; setStatus('open'); };
    sock.onmessage = ev => { if (ws !== sock) return; try { const m = parseServerMessage(JSON.parse(String(ev.data))); if (m.type === 'snapshot') { backoff = min; failed = false; } msgFns.forEach(f => f(m)); } catch { /* ignore malformed */ } };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => { if (ws !== sock) return; ws = null; failed = true; setStatus('unreachable'); schedule(); };
  }
  return {
    // An explicit connect (a « Reconnect ») says « connecting » at once, even after a drop: the automatic retries stay « unreachable ».
    connect: () => { closed = false; if (timer) { clearTimeout(timer); timer = null; } const old = ws; ws = null; old?.close(); setStatus('connecting'); open(); },
    close: () => { closed = true; attempt++; if (timer) clearTimeout(timer); const old = ws; ws = null; old?.close(); setStatus('connecting'); },
    send: m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    status: () => status,
    onMessage: f => { msgFns.add(f); return () => msgFns.delete(f); },
    onStatus: f => { statusFns.add(f); return () => statusFns.delete(f); }
  };
}
