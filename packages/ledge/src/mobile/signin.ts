// The PC's GitHub sign-in, by the device flow the relay runs on its /auth/device/* routes.
import { setTimeout as delay } from 'node:timers/promises';
import { DevicePollResponseSchema, DeviceStartResponseSchema } from '@ledge/protocol';
import type { RelaySession } from './files.js';

export type SignInResult =
  | { status: 'ok'; session: RelaySession }
  | { status: 'expired' | 'denied' | 'not_allowed' | 'cancelled' }
  | { status: 'failed'; error: string };

const CALL_TIMEOUT_MS = 15_000;
const ERROR_MAX = 200;

class Cancelled extends Error {}

/**
 * Starts the device flow: `onCode` receives the code to show, then the relay is polled every `interval` seconds
 * (`slow_down` replaces it) until an outcome. The `deviceCode` never leaves this module, not even in an error.
 */
export function startSignIn(opts: {
  relayUrl: string;
  onCode(c: { userCode: string; verificationUri: string; expiresAt: string }): void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): { result: Promise<SignInResult>; cancel(): void } {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const abort = new AbortController();
  // The default wait is cleared by cancel(), so no timer outlives a cancelled sign-in.
  const sleep = opts.sleep ?? ((ms: number) => delay(ms, undefined, { signal: abort.signal }));
  let cancelled = false;
  let deviceCode = '';
  const onCancel = new Promise<never>((_resolve, reject) => {
    abort.signal.addEventListener('abort', () => reject(new Cancelled()), { once: true });
  });
  onCancel.catch(() => {});
  /** Settles first with Cancelled once `cancel()` is called. */
  const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, onCancel]);

  const post = async (path: string, body?: unknown): Promise<unknown> => {
    if (cancelled) throw new Cancelled();
    const res = await guard(fetchImpl(new URL(path, opts.relayUrl).toString(), {
      method: 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])
    }));
    if (!res.ok) throw new Error(`relay answered ${res.status}`);
    return guard(res.json() as Promise<unknown>);
  };

  const run = async (): Promise<SignInResult> => {
    const start = DeviceStartResponseSchema.parse(await post('/auth/device/start'));
    deviceCode = start.deviceCode;
    opts.onCode({
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: new Date(Date.now() + start.expiresIn * 1000).toISOString()
    });
    let interval = start.interval;
    for (;;) {
      await guard(sleep(interval * 1000));
      const poll = DevicePollResponseSchema.parse(await post('/auth/device/poll', { deviceCode }));
      switch (poll.status) {
        case 'pending': break;
        case 'slow_down': interval = poll.interval; break;
        case 'ok': return { status: 'ok', session: { token: poll.token, accountId: poll.accountId, login: poll.login, relayUrl: opts.relayUrl } };
        default: return { status: poll.status };
      }
    }
  };

  const result = run().catch((e: unknown): SignInResult => {
    if (cancelled || e instanceof Cancelled) return { status: 'cancelled' };
    let error = e instanceof Error ? (e.name === 'ZodError' ? 'invalid relay answer' : e.message) : 'sign-in failed';
    if (deviceCode) error = error.split(deviceCode).join('[redacted]');
    return { status: 'failed', error: error.slice(0, ERROR_MAX) };
  });

  return {
    result,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
    }
  };
}

/** Revokes the relay session. A network error or a refusal is swallowed: the local session is dropped anyway. */
export async function signOut(session: RelaySession, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetchImpl(new URL('/auth/logout', session.relayUrl).toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
    await res.body?.cancel();
  } catch {
    /* swallowed */
  }
}
