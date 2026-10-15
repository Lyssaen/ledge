import { useState } from 'react';
import { copy } from '../copy';
import { mobileStore, useMobile } from '../state/store';
import { enableNotifications, type EnableResult } from './subscribe';

export type EnableState = 'idle' | 'working' | EnableResult;

/** How long the PC gets to refuse a subscription (it sends an `error`; it sends nothing when it accepts). */
const REFUSAL_MS = 1500;
const refused = (ms: number): Promise<boolean> => new Promise(done => {
  const stop = mobileStore.listen(m => { if (m.type === 'error') { stop(); clearTimeout(t); done(true); } });
  const t = setTimeout(() => { stop(); done(false); }, ms);
});

/** The notifications button's logic, shared by the pairing step and the Connexion panel. `start` must run from the tap. */
export function useEnableNotifications(enable: typeof enableNotifications = enableNotifications, refusalMs = REFUSAL_MS) {
  const { vapidPublicKey, link } = useMobile();
  const [state, setState] = useState<EnableState>('idle');
  const start = async (): Promise<EnableResult | null> => {
    if (!vapidPublicKey) return null;
    setState('working');
    let r: EnableResult;
    try {
      const watch = refused(refusalMs);
      r = await enable({ vapidPublicKey, send: m => mobileStore.send(m) });
      if (r === 'granted' && await watch) r = 'failed';
    } catch { r = 'failed'; }
    setState(r);
    return r;
  };
  const noPush = vapidPublicKey === null && link === 'online';
  const t = copy.notifications;
  const message = noPush ? t.noPush : state === 'denied' ? t.denied : state === 'unsupported' ? t.unsupported : state === 'failed' ? t.failed : null;
  // Without a key the PC either has not answered yet or has no push; either way nothing can be asked.
  return { state, start, ready: vapidPublicKey !== null, noPush, message };
}
