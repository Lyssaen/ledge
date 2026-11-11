import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Fleet } from '@ledge/fleet';
import type { MobileState } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import type { ToastAction } from '../shell/Toast';

type Device = MobileState['devices'][number];

/** A device as a sentence names it (docs/mockups/ledge-mobile-passkey, 5 and 6): the name the user gave, said bare, or else its
 *  model, the label's first part (`iPad` of `iPad · Safari`), which the copy gives an article (« l'iPad », « cet iPad »). */
export interface DeviceWord { text: string; named: boolean }
export const deviceWord = (d: Pick<Device, 'name' | 'label'> | undefined): DeviceWord | null =>
  d === undefined ? null : d.name ? { text: d.name, named: true } : { text: d.label.split(' · ')[0] || d.label, named: false };

/** What a passkey recovery leaves for the user to look at: a device back that nobody said « C'était bien moi » for, another
 *  device refused its place, recovery blocked. The tab's dot (P10) stays as long as one does; its label names it (P18). */
export type RecoveryPoint = 'recovered' | 'refused' | 'blocked';
export const mobileRecovery = (m: MobileState | undefined): RecoveryPoint[] => m === undefined ? [] : [
  ...m.devices.flatMap(d => [...(d.recovered?.pending === true ? ['recovered' as const] : []), ...(d.refused !== undefined ? ['refused' as const] : [])]),
  ...(m.recovery?.blocked ? ['blocked' as const] : [])
];

/** A request to bring one device's row into view (the toast's « Voir »). `seq` makes asking twice for the same device a new request. */
export interface DeviceViewRequest { id: string; seq: number }
let wanted: DeviceViewRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const put = (r: DeviceViewRequest | null) => { wanted = r; for (const fn of [...listeners]) fn(); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const requestDeviceView = (id: string): void => put({ id, seq: ++seq });
export const clearDeviceViewRequest = (): void => put(null);
export const useDeviceViewRequest = (): DeviceViewRequest | null => useSyncExternalStore(subscribe, () => wanted, () => wanted);

/** How long the recovery toasts stay: 10 s instead of the usual 6, the time to read them (P9). */
export const RECOVERY_TOAST_MS = 10_000;

/**
 * The toast of a passkey recovery as the local daemon reports it (`mobile.recovery`, mockup 5): `recovered` says the device came
 * back, `refused` warns that another device was refused its place; `blocked` has no toast, only the well in Settings. « Voir »
 * opens Settings › Mobile access on the device (`view`), and nothing else: revoking from a passing toast is too heavy (P9).
 */
export function useRecoveryToast(fleet: Pick<Fleet, 'onMachineMessage' | 'mobile'>, notify: (text: string, action?: ToastAction) => void, view: (id: string) => void): void {
  const { t } = useI18n();
  // The latest values, read when a message comes, so the subscription is made once.
  const live = useRef({ notify, view, c: t.settings.mobile });
  live.current = { notify, view, c: t.settings.mobile };
  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (machine !== 'local' || m.type !== 'mobile.recovery' || m.event === 'blocked' || !m.id) return;
    const { notify: say, view: open, c } = live.current;
    const id = m.id;
    // The fleet's state, not the last render's: the `mobile` that came just before this message may not be drawn yet.
    const word = deviceWord(fleet.mobile()?.devices.find(d => d.id === id)) ?? { text: c.someDevice, named: false };
    const action: ToastAction = { label: c.view, run: () => open(id), ms: RECOVERY_TOAST_MS, undo: false, tone: m.event === 'refused' ? 'warn' : 'ok' };
    say(m.event === 'recovered' ? c.recovered.toast(word) : c.recoverRefused.toast(word), action);
  }), [fleet]);
}
