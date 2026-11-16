import { useEffect, useRef } from 'react';
import { deviceWord, useMobileError } from '@ledge/fleet';
import type { Tui } from '../context.js';

/**
 * The toasts the local daemon's mobile access asks for: a passkey recovery that brought a device back or refused another one
 * (`blocked` has no toast, only the Mobile screen's well), and each mobile command the daemon refused, with its own message.
 */
export function useMobileToasts(tui: Pick<Tui, 'fleet' | 'client' | 't' | 'toast'>): void {
  // The latest values, read when a message comes, so the subscription is made once.
  const live = useRef(tui);
  live.current = tui;
  const { fleet } = tui;
  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (machine !== 'local' || m.type !== 'mobile.recovery' || m.event === 'blocked' || !m.id) return;
    const { t, toast } = live.current;
    const id = m.id;
    // The fleet's state, not the last render's: the `mobile` that came just before this message may not be drawn yet.
    // A device the daemon does not list is still worth a toast, said as « l'appareil ».
    const word = deviceWord(fleet.mobile()?.devices.find(d => d.id === id)) ?? { text: t.mobile.someDevice, named: false };
    if (m.event === 'recovered') toast({ text: t.mobile.recToast(word), tone: 'ok' });
    else toast({ text: t.mobile.refusedToast(word), tone: 'info' });
  }), [fleet]);

  const error = useMobileError(tui.client);
  const seen = useRef(error);
  useEffect(() => {
    if (error === undefined || error === seen.current) { seen.current = error; return; }
    seen.current = error;
    live.current.toast({ text: error.message, tone: 'error' });
  }, [error]);
}
