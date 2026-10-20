// The phone's websocket to the relay's `/ws`. It authenticates with the session cookie, never with a subprotocol,
// and follows the relay's close codes: replaced, signed out, rate limited, or a plain loss with backoff.
import {
  RELAY_CLOSE_SIGNED_OUT, RelayServerMessageSchema, SEALED_MAX,
  type RelayPeer, type RelayServerMessage, type SealedFrame
} from '@ledge/protocol';

export type SocketState = 'connecting' | 'open' | 'signed_out' | 'replaced' | 'closed';

export interface RelaySocket {
  /** False unless the relay welcomed this socket, or when the sealed body is past `SEALED_MAX`. */
  send(to: RelayPeer, frame: SealedFrame): boolean;
  /** Closes the socket and stops reconnecting: `closed`. Final. */
  close(): void;
}

/** Another socket of the same peer took over: never reconnect. */
export const RELAY_CLOSE_REPLACED = 4000;
/** The relay's rate limit: wait at least `RATE_LIMITED_WAIT_MS`. */
export const RELAY_CLOSE_RATE_LIMITED = 4008;
export const RATE_LIMITED_WAIT_MS = 10_000;
export const BACKOFF_FIRST_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
const OPEN = 1;

/**
 * Connects at once to `<url>/ws` (`url` is the relay origin, `https:` or `http:`) and stays connected until `close()`,
 * a 4000 (`replaced`) or a session the relay no longer knows (`signed_out`).
 * After a 4001, or a socket refused before it opened (a browser hides the 401 of the upgrade), `GET /auth/me` decides:
 * 401 is `signed_out`, anything else a retry. Retries back off from 1 s, doubling up to 30 s, back to 1 s on `welcome`;
 * after a 4008 the first retry waits at least 10 s.
 * Only frames that pass `RelayServerMessageSchema` reach `onFrame`; nothing of a frame is logged.
 */
export function openRelaySocket(opts: {
  url: string;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  onFrame(m: RelayServerMessage): void;
  onState(s: SocketState): void;
}): RelaySocket {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const fetchImpl = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const wsUrl = new URL('/ws', opts.url);
  wsUrl.protocol = wsUrl.protocol === 'http:' ? 'ws:' : 'wss:';
  const meUrl = new URL('/auth/me', opts.url).toString();

  let state: SocketState | null = null;
  let ws: WebSocket | null = null;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const setState = (s: SocketState) => {
    if (s === state) return;
    state = s;
    opts.onState(s);
  };

  /** Forgets the current socket: its later events are ignored. */
  const detach = () => {
    const old = ws;
    ws = null;
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
      const r = await fetchImpl(meUrl, { credentials: 'same-origin', cache: 'no-store' });
      return r.status === 401;
    } catch {
      return false;
    }
  };

  const onClosed = (code: number, opened: boolean) => {
    if (code === RELAY_CLOSE_REPLACED) return finish('replaced');
    if (code === RELAY_CLOSE_RATE_LIMITED) return retry(RATE_LIMITED_WAIT_MS);
    if (code !== RELAY_CLOSE_SIGNED_OUT && opened) return retry();
    setState('connecting');
    void signedOut().then((out) => {
      if (finished) return;
      if (out) finish('signed_out');
      else retry();
    });
  };

  function connect() {
    if (finished) return;
    setState('connecting');
    let sock: WebSocket;
    try {
      // No second argument: a subprotocol would put a credential where the cookie belongs.
      sock = new Impl(wsUrl.toString());
    } catch {
      retry();
      return;
    }
    ws = sock;
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
        failures = 0;
        setState('open');
      }
      opts.onFrame(m.data);
    };
    sock.onclose = (ev: CloseEvent) => {
      if (ws !== sock) return;
      ws = null;
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
    close() {
      if (finished) return;
      finish('closed');
    }
  };
}
