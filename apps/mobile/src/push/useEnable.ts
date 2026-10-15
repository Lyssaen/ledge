import { useState } from 'react';
import { mobileStore, useMobile } from '../state/store';
import { enableNotifications, type EnableResult } from './subscribe';

export type EnableState = 'idle' | 'working' | EnableResult;

/** The notifications button's logic, shared by the pairing step and the Connexion panel. `start` must run from the tap. */
export function useEnableNotifications(enable: typeof enableNotifications = enableNotifications) {
  const { vapidPublicKey, link } = useMobile();
  const [state, setState] = useState<EnableState>('idle');
  const start = (): Promise<EnableResult | null> => {
    if (!vapidPublicKey) return Promise.resolve(null);
    setState('working');
    return enable({ vapidPublicKey, send: m => { mobileStore.send(m); } }).then(r => { setState(r); return r; }, () => { setState('unsupported'); return 'unsupported' as const; });
  };
  // Without a key the PC either has not answered yet or has no push; either way nothing can be asked.
  return { state, start, ready: vapidPublicKey !== null, noPush: vapidPublicKey === null && link === 'online' };
}
