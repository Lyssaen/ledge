// The phone's websocket to the relay's `/ws`. It authenticates with the session cookie, never with a subprotocol,
// and follows the relay's close codes: replaced, signed out, rate limited, or a plain loss with backoff.
import {
  RELAY_CLOSE_RATE_LIMITED, RELAY_CLOSE_REPLACED, RELAY_CLOSE_SIGNED_OUT, RelayServerMessageSchema, SEALED_MAX,
  type RelayPeer, type RelayServerMessage, type SealedFrame
} from '@ledge/protocol';

export type SocketState = 'connecting' | 'open' | 'signed_out' | 'replaced' | 'closed';

export interface RelaySocket {
  /** False unless the relay welcomed this socket, or when the sealed body is past `SEALED_MAX`. */
  send(to: RelayPeer, frame: SealedFrame): boolean;
  /**
   * Connects again now (an open socket is dropped first), unless an attempt or `/auth/me` is under way, a 4008 asked to
   * wait, or the socket is finished. The backoff keeps counting.
   */
  reconnect(): void;
  /**
   * Back in front (or online again): the backoff starts over and a new socket is opened at once, even over an open one
   * (a suspended phone's socket may be dead without a close) or an attempt older than `RESUME_FRESH_MS`. Nothing while
   * `/auth/me` is asked, within the wait of a 4008, or once finished.
   */
  resume(): void;
  /** Closes the socket and stops reconnecting: `closed`. Final. */
  close(): void;
}

/** After a 4008 (rate limited), the first retry waits at least this. */
export const RATE_LIMITED_WAIT_MS = 10_000;
/** A `/auth/me` without an answer by then counts as "not signed out": the socket retries. */
export const AUTH_ME_WITHIN_MS = 10_000;
export const BACKOFF_FIRST_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
/** An attempt without a welcome by then is dropped and counts as failed: a socket stuck connecting never blocks. */
export const CONNECT_WITHIN_MS = 10_000;
/** `resume()` leaves an attempt younger than this alone: `visibilitychange` and `pageshow` come together. */
export const RESUME_FRESH_MS = 2_000;
const OPEN = 1;

/** `url` reduced to its origin; throws unless it is an `http:`/`https:` origin with no path, query or credentials. */
function relayOrigin(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new TypeError('relay URL: not a URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new TypeError('relay URL: not http(s)');
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new TypeError('relay URL: not an origin');
  return u.origin;
}

/**
 * Connects at once to `<url>/ws` (`url` is the relay origin, `https:` or `http:`) and stays connected until `close()`,
 * a 4000 (`replaced`) or a session the relay no longer knows (`signed_out`).
 * After a 4001, or a socket refused before it opened (a browser hides the 401 of the upgrade), `GET /auth/me` decides:
 * 401 is `signed_out`, anything else a retry. Retries back off from 1 s, doubling up to 30 s, back to 1 s on `welcome`;
 * after a 4008 the first retry waits at least 10 s. An attempt without a welcome within 10 s is dropped and retried.
 * Only frames that pass `RelayServerMessageSchema` reach `onFrame`; nothing of a frame is logged.
 * Throws at once when `url` is not an `http:`/`https:` origin, so a bad URL never turns into a retry loop.
 */
export function openRelaySocket(opts: {
  url: string;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  onFrame(m: RelayServerMessage): void;
  onState(s: SocketState): void;
  /**
   * A connection attempt failed or an open socket was lost (not a replacement): the state may stay `connecting`
   * across attempts, so this is how a caller tells "still trying" from "the first try".
   */
  onAttemptFailed?(): void;
}): RelaySocket {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const fetchImpl = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const origin = relayOrigin(opts.url);
  const wsUrl = new URL('/ws', origin);
  wsUrl.protocol = wsUrl.protocol === 'http:' ? 'ws:' : 'wss:';
  const meUrl = new URL('/auth/me', origin).toString();

  let state: SocketState | null = null;
  let ws: WebSocket | null = null;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the current attempt started (wall clock: timers stand still while the page is frozen). */
  let attemptAt = 0;
  let finished = false;
  /** `/auth/me` is under way: its answer decides what comes next. */
  let asking = false;
  /** Before this (a 4008), no attempt is made, asked for or not. */
  let notBefore = 0;

  const setState = (s: SocketState) => {
    if (s === state) return;
    state = s;
    opts.onState(s);
  };

  /** Forgets the current socket: its later events are ignored. */
  const detach = () => {
    const old = ws;
    ws = null;
    clearTimeout(attemptTimer);
    if (!old) return;
    old.onopen = old.onmessage = old.onclose = old.onerror = null;
    if (old.readyState <= OPEN) old.close(1000);
  };

  const finish = (s: 'replaced' | 'signed_out' | 'closed') => {
    finished = true;
    clearTimeout(retryTimer);
    detach();
    setState(s);
  };

  const retry = (atLeastMs = 0) => {
    const delay = Math.max(atLeastMs, Math.min(BACKOFF_FIRST_MS * 2 ** failures, BACKOFF_MAX_MS));
    failures++;
    setState('connecting');
    retryTimer = setTimeout(connect, delay);
  };

  /** True when the relay no longer knows this phone's session; a network failure or another status is not that. */
  const signedOut = async (): Promise<boolean> => {
    try {
      const r = await fetchImpl(meUrl, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(AUTH_ME_WITHIN_MS) });
      return r.status === 401;
    } catch {
      return false;
    }
  };

  const onClosed = (code: number, opened: boolean) => {
    if (code === RELAY_CLOSE_REPLACED) return finish('replaced');
    opts.onAttemptFailed?.();
    if (code === RELAY_CLOSE_RATE_LIMITED) {
      notBefore = Date.now() + RATE_LIMITED_WAIT_MS;
      return retry(RATE_LIMITED_WAIT_MS);
    }
    if (code !== RELAY_CLOSE_SIGNED_OUT && opened) return retry();
    setState('connecting');
    asking = true;
    void signedOut().then((out) => {
      asking = false;
      if (finished) return;
      if (out) finish('signed_out');
      else retry();
    });
  };

  function connect() {
    if (finished) return;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    detach();
    setState('connecting');
    let sock: WebSocket;
    try {
      // No second argument: a subprotocol would put a credential where the cookie belongs.
      sock = new Impl(wsUrl.toString());
    } catch {
      opts.onAttemptFailed?.();
      retry();
      return;
    }
    ws = sock;
    attemptAt = Date.now();
    attemptTimer = setTimeout(() => {
      if (ws !== sock || state === 'open') return;
      detach();
      opts.onAttemptFailed?.();
      retry();
    }, CONNECT_WITHIN_MS);
    let opened = false;
    sock.onopen = () => { opened = true; };
    sock.onerror = () => {};
    sock.onmessage = (ev: MessageEvent) => {
      if (ws !== sock || typeof ev.data !== 'string') return;
      let raw: unknown;
      try { raw = JSON.parse(ev.data); } catch { return; }
      const m = RelayServerMessageSchema.safeParse(raw);
      if (!m.success) return;
      if (m.data.type === 'welcome') {
        clearTimeout(attemptTimer);
        failures = 0;
        setState('open');
      }
      opts.onFrame(m.data);
    };
    sock.onclose = (ev: CloseEvent) => {
      if (ws !== sock) return;
      ws = null;
      clearTimeout(attemptTimer);
      onClosed(ev.code, opened);
    };
  }

  connect();

  return {
    send(to, frame) {
      if (state !== 'open' || !ws || ws.readyState !== OPEN) return false;
      const body = JSON.stringify(frame);
      if (body.length > SEALED_MAX) return false;
      ws.send(JSON.stringify({ type: 'send', to, body }));
      return true;
    },
    reconnect() {
      if (finished || asking || Date.now() < notBefore) return;
      if (ws && state !== 'open') return;
      connect();
    },
    resume() {
      if (finished || asking || Date.now() < notBefore) return;
      if (ws && state !== 'open' && Date.now() - attemptAt < RESUME_FRESH_MS) return;
      failures = 0;
      connect();
    },
    close() {
      if (finished) return;
      finish('closed');
    }
  };
}
