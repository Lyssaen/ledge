import { useSyncExternalStore } from 'react';

/** What reading `~/.ledge/token` gave: the token, no file (`absent`), or no answer at all (WSL slow or failing). */
export type TokenRead = { kind: 'token'; token: string } | { kind: 'absent' } | { kind: 'unavailable' };
/** A browser cannot set `Authorization` on a WebSocket: it offers the subprotocol `ledge.<token>` instead (the daemon's own constant lives in Node-only code). */
export const DAEMON_PROTOCOL_PREFIX = 'ledge.';

export interface TokenSource {
  /** Cached after the first success; `fresh` forces a new read. Never rejects (a thrown read is `unavailable`). */
  get(fresh: boolean): Promise<TokenRead>;
  /** True after the last read answered `absent`; false after `token` or `unavailable`. */
  missing(): boolean;
  onMissing(fn: (missing: boolean) => void): () => void;
}

const READ_TIMEOUT_MS = 10_000;

/** Wraps the app's reader. Concurrent gets share the read in flight, so several connections cost one read. */
export function createTokenSource(read: () => Promise<TokenRead>): TokenSource {
  let cached: string | null = null, missing = false, inflight: Promise<TokenRead> | null = null;
  const fns = new Set<(missing: boolean) => void>();
  const setMissing = (m: boolean) => { if (m !== missing) { missing = m; fns.forEach(f => f(m)); } };
  const load = async (): Promise<TokenRead> => {
    let r: TokenRead, timer: ReturnType<typeof setTimeout> | undefined;
    const unavailable: TokenRead = { kind: 'unavailable' };
    try {
      // A hung read must not freeze every later get(): the shared in-flight promise gives up after READ_TIMEOUT_MS.
      const got = await Promise.race([read(), new Promise<TokenRead>(res => { timer = setTimeout(() => res(unavailable), READ_TIMEOUT_MS); })]);
      r = (got?.kind === 'token' && typeof got.token === 'string') || got?.kind === 'absent' ? got : unavailable;
    } catch { r = unavailable; } finally { clearTimeout(timer); }
    if (r.kind === 'token') cached = r.token;
    else if (r.kind === 'absent') cached = null; // the file is gone: the old token opens nothing any more
    setMissing(r.kind === 'absent');
    return r;
  };
  return {
    get(fresh) {
      if (!fresh && cached !== null) return Promise.resolve({ kind: 'token', token: cached });
      inflight ??= load().finally(() => { inflight = null; });
      return inflight;
    },
    missing: () => missing,
    onMissing(fn) { fns.add(fn); return () => { fns.delete(fn); }; }
  };
}

const noopSubscribe = () => () => {};
const falseSnapshot = () => false;
/** Whether the daemon token file is missing (the daemon never ran, or an old one); false without a source. */
export function useTokenMissing(source: TokenSource | undefined): boolean {
  return useSyncExternalStore(source?.onMissing ?? noopSubscribe, source?.missing ?? falseSnapshot, falseSnapshot);
}
