import { useState } from 'react';
import type { ClientMessage } from '@ledge/protocol';
import { copy } from '../copy';
import { mobileStore, useMobile } from '../state/store';
import { enableNotifications, type EnableResult } from './subscribe';

export type EnableState = 'idle' | 'working' | EnableResult;

/** How long the PC gets to refuse a subscription, counted from the moment it was sent (it sends an `error`; it sends nothing when it accepts). */
const REFUSAL_MS = 1500;
/** The daemon's refusals of `push.subscribe`; any other `error` on the link is about something else. */
const PUSH_REFUSAL = /push|mobile not available/i;

const refused = (ms: number): Promise<boolean> => new Promise(done => {
  const stop = mobileStore.listen(m => { if (m.type === 'error' && PUSH_REFUSAL.test(m.message)) { stop(); clearTimeout(t); done(true); } });
  const t = setTimeout(() => { stop(); done(false); }, ms);
});

/** The notifications button's logic, shared by the pairing step and the Connexion panel. `start` must run from the tap. */
export function useEnableNotifications(enable: typeof enableNotifications = enableNotifications, refusalMs = REFUSAL_MS) {
  const { vapidPublicKey, link, pushStale } = useMobile();
  const [state, setState] = useState<EnableState>('idle');
  const start = async (): Promise<EnableResult | null> => {
    if (!vapidPublicKey) return null;
    setState('working');
    let r: EnableResult;
    try {
      let watch: Promise<boolean> | null = null;
      // The window opens when the subscription leaves, not at the tap: the permission prompt can take any time.
      const send = (m: ClientMessage): boolean => {
        const sent = mobileStore.send(m);
        if (sent && !watch) watch = refused(refusalMs);
        return sent;
      };
      r = await enable({ vapidPublicKey, send });
      if (r === 'granted' && watch && await watch) r = 'failed';
    } catch { r = 'failed'; }
    if (r === 'granted') mobileStore.setPushStale(false);
    setState(r);
    return r;
  };
  const noPush = vapidPublicKey === null && link === 'online';
  const t = copy.notifications;
  const message = noPush ? t.noPush : state === 'denied' ? t.denied : state === 'unsupported' ? t.unsupported : state === 'failed' ? t.failed : pushStale && state === 'idle' ? t.stale : null;
  // Without a key the PC either has not answered yet or has no push; either way nothing can be asked.
  return { state, start, stale: pushStale, ready: vapidPublicKey !== null, noPush, message };
}
