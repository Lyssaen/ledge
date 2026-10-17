import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetView } from '../fleet/useFleet';
import { LAUNCH_TIMEOUT_MS, type LaunchMessage } from './model';

export type LaunchState = { status: 'idle' } | { status: 'launching' } | { status: 'refused'; message: string } | { status: 'timeout' };

const IDLE: LaunchState = { status: 'idle' };

/** What the launch in flight waits for: a `session.launched` or a launch error newer than those seen at the send. */
interface Awaited { launchedSeq: number; errorSeq: number; timer: ReturnType<typeof setTimeout> | null }

/** One launch at a time, nothing optimistic: `launch` sends, then the next `lastLaunched` (a seq above the one seen before the send)
 *  calls `onLaunched(id)`, the next `session.launch` error (no session id) says `refused`, and LAUNCH_TIMEOUT_MS without either says
 *  `timeout`. A timed out launch still hears a late answer while the form is open; after `reset` (the form closed) it is ignored. */
export function useLaunch(view: Pick<FleetView, 'client' | 'lastLaunched' | 'errors'>, onLaunched: (id: string) => void): { state: LaunchState; launch(msg: LaunchMessage): void; reset(): void } {
  const [state, setState] = useState<LaunchState>(IDLE);
  // A synchronous mirror of the launch in flight: two Ctrl ↵ in the same frame see the first send before React renders again.
  const awaited = useRef<Awaited | null>(null);
  const latest = useRef({ view, onLaunched });
  latest.current = { view, onLaunched };
  useEffect(() => () => { const a = awaited.current; if (a?.timer) clearTimeout(a.timer); awaited.current = null; }, []);

  const settle = () => {
    const a = awaited.current;
    if (a?.timer) clearTimeout(a.timer);
    awaited.current = null;
  };

  const launch = useCallback((msg: LaunchMessage) => {
    if (awaited.current?.timer) return;
    settle();
    const { view: v } = latest.current;
    const a: Awaited = { launchedSeq: v.lastLaunched?.seq ?? 0, errorSeq: v.errors.at(-1)?.seq ?? 0, timer: null };
    a.timer = setTimeout(() => {
      if (awaited.current !== a) return;
      a.timer = null;
      setState({ status: 'timeout' });
    }, LAUNCH_TIMEOUT_MS);
    awaited.current = a;
    setState({ status: 'launching' });
    // The fleet answers an offline machine with an error at once: the seqs above were read before it.
    try { v.client.send(msg); } catch (e) { settle(); setState({ status: 'refused', message: e instanceof Error ? e.message : String(e) }); }
  }, []);

  const reset = useCallback(() => {
    settle();
    setState(s => (s.status === 'idle' ? s : IDLE));
  }, []);

  const { lastLaunched, errors } = view;
  useEffect(() => {
    const a = awaited.current;
    if (!a) return;
    if (lastLaunched && lastLaunched.seq > a.launchedSeq) {
      settle();
      setState(IDLE);
      latest.current.onLaunched(lastLaunched.id);
      return;
    }
    const refusal = errors.find(e => e.seq > a.errorSeq && e.request === 'session.launch' && e.id === undefined);
    if (refusal) { settle(); setState({ status: 'refused', message: refusal.message }); }
  }, [lastLaunched, errors]);

  return { state, launch, reset };
}
