import WebSocket from 'ws';

/**
 * The only CDP commands Ledge ever sends to an agent's browser: list the tabs and follow them, attach to one and leave it,
 * film it, take one image of it. Nothing that clicks, types, runs a script, navigates or changes the page: the view is read
 * only because this list is (docs/mockups/ledge-browser-live.html, « Lecture seule »).
 */
export const CDP_ALLOWED: ReadonlySet<string> = new Set([
  'Target.getTargets', 'Target.setDiscoverTargets', 'Target.attachToTarget', 'Target.detachFromTarget',
  'Page.startScreencast', 'Page.stopScreencast', 'Page.screencastFrameAck', 'Page.captureScreenshot'
]);

export class CdpRefused extends Error {
  constructor(readonly method: string) { super(`CDP command not allowed: ${method}`); this.name = 'CdpRefused'; }
}

export interface CdpEvent { method: string; params: Record<string, unknown>; sessionId?: string }

export interface Cdp {
  /** Sends one allowed command; any other is refused here, before anything is sent. */
  call(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  onEvent(fn: (e: CdpEvent) => void): void;
  /** Once, when the connection ends (the browser closed, or `close`). */
  onClose(fn: () => void): void;
  close(): void;
}

export type ConnectCdp = (url: string) => Promise<Cdp>;

const CALL_MS = 10_000;

/** A CDP connection to a browser's endpoint (`ws://127.0.0.1:<port>/devtools/browser/<id>`), with no header of Ledge's. */
export const connectCdp: ConnectCdp = url => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024, handshakeTimeout: 5000 });
  let next = 0;
  const pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  const events: ((e: CdpEvent) => void)[] = [];
  const closes: (() => void)[] = [];
  let closed = false;
  const end = () => {
    if (closed) return;
    closed = true;
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP connection closed')); }
    pending.clear();
    for (const fn of closes) fn();
  };
  const cdp: Cdp = {
    call(method, params = {}, sessionId) {
      if (!CDP_ALLOWED.has(method)) return Promise.reject(new CdpRefused(method));
      if (closed || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP connection closed'));
      const id = ++next;
      return new Promise((res, rej) => {
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP ${method} timed out`)); }, CALL_MS);
        pending.set(id, { resolve: res, reject: rej, timer });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    onEvent(fn) { events.push(fn); },
    onClose(fn) { if (closed) fn(); else closes.push(fn); },
    close() { ws.close(); end(); }
  };
  ws.on('message', data => {
    let m: { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try { m = JSON.parse(String(data)); } catch { return; }
    if (typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message ?? 'CDP error')); else p.resolve(m.result ?? {});
    } else if (typeof m.method === 'string') {
      const e: CdpEvent = { method: m.method, params: m.params ?? {}, ...(m.sessionId ? { sessionId: m.sessionId } : {}) };
      for (const fn of events) fn(e);
    }
  });
  ws.once('open', () => resolve(cdp));
  ws.once('error', e => { if (ws.readyState !== WebSocket.OPEN) reject(e); end(); });
  ws.once('close', end);
});
