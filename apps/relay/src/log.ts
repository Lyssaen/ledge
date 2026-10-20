import type { RelayServerMessage } from '@ledge/protocol';

/** Structured events. No free-text field: an event cannot carry content. */
export type RelayLogEvent =
  | { ev: 'connect'; account: string; peer: string }
  | { ev: 'disconnect'; account: string; peer: string; code: number; ms: number; framesIn: number; framesOut: number; bytesIn: number; bytesOut: number }
  | { ev: 'refused'; reason: 'no_auth' | 'bad_path' | 'auth_error' | 'bad_peer' | 'timeout' | 'busy'; count: number }
  | { ev: 'http_error' }
  | { ev: 'sign_in'; account: string; peer: string; kind: 'pc' | 'device' }
  | { ev: 'sign_out'; account: string; peer: string }
  | { ev: 'device_revoked'; account: string; peer: string; count: number }
  | { ev: 'sign_in_refused'; reason: 'not_allowed' | 'denied' | 'expired' | 'bad_state' | 'github'; count: number }
  | { ev: 'push'; account: string; host: string; result: 'sent' | 'gone' | 'failed' | 'refused'; status?: number }
  | { ev: 'frame_error'; account: string; peer: string; code: Extract<RelayServerMessage, { type: 'error' }>['code'] };

export type RelayLog = (e: RelayLogEvent) => void;

export const jsonLog: RelayLog = (e) => {
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
};

/**
 * Aggregates repeated events: counts them per `reason`, and emits one event with `count` per reason at each interval
 * and on `flush()`. A flood of refusals then costs one log line per reason and interval, not one per attempt.
 */
export function countedLog<E extends { count: number }>(log: (e: E) => void, ms: number): {
  add(e: Omit<E, 'count'>): void;
  flush(): void;
  stop(): void;
} {
  const pending = new Map<string, { e: Omit<E, 'count'>; count: number }>();
  const flush = () => {
    const batch = [...pending.values()];
    pending.clear();
    for (const { e, count } of batch) log({ ...e, count } as E);
  };
  const timer = setInterval(flush, ms);
  timer.unref();
  return {
    add(e) {
      const key = String((e as { reason?: unknown }).reason);
      const hit = pending.get(key);
      if (hit) hit.count++;
      else pending.set(key, { e, count: 1 });
    },
    flush,
    stop() { clearInterval(timer); flush(); }
  };
}
