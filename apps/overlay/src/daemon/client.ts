import { parseServerMessage, type ClientMessage, type ServerMessage } from '@ledge/protocol';
import type { Fleet } from './machines';

export type DaemonStatus = 'connecting' | 'open' | 'unreachable';
export interface DaemonClient {
  fleet?: Fleet;
  connect(): void; close(): void; send(msg: ClientMessage): void; status(): DaemonStatus;
  onMessage(fn: (m: ServerMessage) => void): () => void; onStatus(fn: (s: DaemonStatus) => void): () => void;
}
type WsLike = { send(data: string): void; close(): void; onopen: null | (() => void); onclose: null | (() => void); onerror: null | (() => void); onmessage: null | ((ev: { data: unknown }) => void); readyState: number };
type WsCtor = new (url: string, protocols?: string | string[]) => WsLike;

export function createDaemonClient(opts: { url: string; token?: string; WebSocketImpl?: WsCtor; minBackoffMs?: number; maxBackoffMs?: number }): DaemonClient {
  const Ws = (opts.WebSocketImpl ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket);
  const min = opts.minBackoffMs ?? 2000, max = opts.maxBackoffMs ?? 30000;
  let ws: WsLike | null = null, status: DaemonStatus = 'connecting', backoff = min, timer: ReturnType<typeof setTimeout> | null = null, closed = false;
  const msgFns = new Set<(m: ServerMessage) => void>(), statusFns = new Set<(s: DaemonStatus) => void>();
  const setStatus = (s: DaemonStatus) => { if (s !== status) { status = s; statusFns.forEach(f => f(s)); } };
  const schedule = () => { if (closed) return; timer = setTimeout(open, backoff); backoff = Math.min(max, backoff * 2); };
  function open() {
    if (closed) return;
    setStatus(status === 'open' ? 'connecting' : status);
    const protocols = opts.token ? [`ledge.${opts.token}`] : undefined;
    const sock = protocols ? new Ws(opts.url, protocols) : new Ws(opts.url); ws = sock;
    sock.onopen = () => { if (ws !== sock) return; setStatus('open'); };
    sock.onmessage = ev => { if (ws !== sock) return; try { const m = parseServerMessage(JSON.parse(String(ev.data))); if (m.type === 'snapshot') backoff = min; msgFns.forEach(f => f(m)); } catch { /* ignore malformed */ } };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = () => { if (ws !== sock) return; ws = null; setStatus('unreachable'); schedule(); };
  }
  return {
    connect: () => { closed = false; if (timer) { clearTimeout(timer); timer = null; } const old = ws; ws = null; old?.close(); open(); },
    close: () => { closed = true; if (timer) clearTimeout(timer); const old = ws; ws = null; old?.close(); setStatus('connecting'); },
    send: m => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    status: () => status,
    onMessage: f => { msgFns.add(f); return () => msgFns.delete(f); },
    onStatus: f => { statusFns.add(f); return () => statusFns.delete(f); }
  };
}
