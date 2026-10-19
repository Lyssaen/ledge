// The daemon's outgoing websocket to the relay, kept open with reconnection and backoff.
import WebSocket from 'ws';
import { RELAY_CLOSE_SIGNED_OUT, RelayServerMessageSchema, type RelayClientMessage, type RelayServerMessage } from '@ledge/protocol';
import { log } from '../log.js';

export type LinkState =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'online' }
  | { state: 'offline'; retryAt: string; error: string }
  | { state: 'signed_out'; reason: 'other_pc' | 'session_invalid' };

/** Runs `fn` after `ms`; the returned function cancels it. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export interface RelayLink {
  /** False unless online. */
  send(m: RelayClientMessage): boolean;
  /** While offline: drops the wait and connects at once. Otherwise does nothing. */
  retryNow(): void;
  /** Closes the socket, stops retrying, goes `off`. Final. */
  close(): void;
}

export const BACKOFF_FIRST_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
export const PING_EVERY_MS = 25_000;
export const PONG_WITHIN_MS = 10_000;
const ERROR_MAX = 200;

const realSchedule: Schedule = (fn, ms) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

/** `wss://<host>/ws`, or `ws://` for an `http:` relay. */
function wsUrl(relayUrl: string): string {
  const u = new URL('/ws', relayUrl);
  u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:';
  return u.toString();
}

/**
 * Connects at once and keeps the link up until `close()`.
 * Backoff: 1 s, doubled after each failure, ±20 % jitter from `random`, never above 60 s; back to 1 s on each `welcome`.
 * `now`, `random` and `schedule` (timers for retries and pings) are for tests; they default to the real ones.
 */
export function createRelayLink(opts: {
  relayUrl: string;
  token: string;
  onState(s: LinkState): void;
  onMessage(m: RelayServerMessage): void;
  now?: () => number;
  random?: () => number;
  WebSocketImpl?: typeof WebSocket;
  schedule?: Schedule;
}): RelayLink {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const schedule = opts.schedule ?? realSchedule;
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const url = wsUrl(opts.relayUrl);

  let state: LinkState['state'] = 'off';
  let ws: WebSocket | null = null;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let cancelPing: (() => void) | null = null;
  let finished = false;

  const setState = (s: LinkState) => {
    state = s.state;
    opts.onState(s);
  };

  const stopPing = () => { cancelPing?.(); cancelPing = null; };

  /** Forgets the current socket: its later events are ignored. */
  const drop = () => {
    stopPing();
    const old = ws;
    ws = null;
    if (old) {
      old.removeAllListeners();
      old.on('error', () => {});
      old.terminate();
    }
  };

  const nextDelay = () => {
    const base = Math.min(BACKOFF_FIRST_MS * 2 ** failures, BACKOFF_MAX_MS);
    failures++;
    const jittered = base * (1 + (random() * 2 - 1) * 0.2);
    return Math.round(Math.min(jittered, BACKOFF_MAX_MS));
  };

  const fail = (error: string) => {
    drop();
    if (finished) return;
    const delay = nextDelay();
    const cut = error.slice(0, ERROR_MAX);
    log(`mobile link: offline (${cut}), retry in ${delay} ms`);
    setState({ state: 'offline', retryAt: new Date(now() + delay).toISOString(), error: cut });
    cancelRetry = schedule(() => { cancelRetry = null; connect(); }, delay);
  };

  const signedOut = (reason: 'other_pc' | 'session_invalid') => {
    drop();
    finished = true;
    log(`mobile link: signed out (${reason})`);
    setState({ state: 'signed_out', reason });
  };

  /** Every 25 s a ping; without a pong within 10 s the socket is terminated and the link reconnects. */
  const armPing = (sock: WebSocket) => {
    stopPing();
    cancelPing = schedule(() => {
      if (ws !== sock) return;
      sock.ping();
      cancelPing = schedule(() => {
        if (ws === sock) fail('no pong from the relay');
      }, PONG_WITHIN_MS);
    }, PING_EVERY_MS);
  };

  const connect = () => {
    if (finished) return;
    setState({ state: 'connecting' });
    const sock = new Impl(url, { headers: { authorization: `Bearer ${opts.token}` } });
    ws = sock;
    let lastError = '';
    sock.on('error', (e: Error) => { lastError = e.message; });
    sock.on('unexpected-response', (_req, res) => {
      if (ws !== sock) return;
      res.resume();
      if (res.statusCode === 401) signedOut('session_invalid');
      else fail(`unexpected server response: ${res.statusCode ?? 0}`);
    });
    sock.on('open', () => { if (ws === sock) armPing(sock); });
    sock.on('pong', () => { if (ws === sock) armPing(sock); });
    sock.on('message', (data: WebSocket.RawData) => {
      if (ws !== sock) return;
      let parsed: unknown;
      try { parsed = JSON.parse(data.toString()); } catch { parsed = undefined; }
      const r = RelayServerMessageSchema.safeParse(parsed);
      if (!r.success) { log('mobile link: ignored an invalid relay frame'); return; }
      if (r.data.type === 'welcome') {
        failures = 0;
        if (state !== 'online') { log('mobile link: online'); setState({ state: 'online' }); }
      }
      opts.onMessage(r.data);
    });
    sock.on('close', (code: number) => {
      if (ws !== sock) return;
      if (code === RELAY_CLOSE_SIGNED_OUT) signedOut('other_pc');
      else fail(lastError || `connection closed (${code})`);
    });
  };

  connect();

  return {
    send(m) {
      if (state !== 'online' || !ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(m));
      return true;
    },
    retryNow() {
      if (finished || state !== 'offline') return;
      cancelRetry?.();
      cancelRetry = null;
      connect();
    },
    close() {
      if (state === 'off' && finished) return;
      finished = true;
      cancelRetry?.();
      cancelRetry = null;
      const old = ws;
      stopPing();
      ws = null;
      if (old) {
        old.removeAllListeners();
        old.on('error', () => {});
        if (old.readyState === WebSocket.OPEN) old.close(1000);
        else old.terminate();
      }
      setState({ state: 'off' });
    }
  };
}
