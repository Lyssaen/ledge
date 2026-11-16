import { deviceKindOfLabel, type DeviceKind, type MobileClientMessage, type MobilePairing, type MobileState } from '@ledge/protocol';
import type { Tui } from '../context.js';
import type { Glyphs } from '../glyphs.js';
import type { Lang, Messages } from '../i18n/lang.js';
import { ago, clock } from './time.js';

type Device = MobileState['devices'][number];

/** The pairings waiting for the user's decision, the oldest first: every pairing lives as long, so the one that expires first came first. */
export function waitingPairings(m: MobileState | undefined): MobilePairing[] {
  return (m?.pairings ?? []).filter(p => p.state === 'confirm').sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
}

/** What the Réglages row says about mobile access in one glance. */
export type MobileSummary =
  | { kind: 'online'; devices: number; requests: number }
  | { kind: 'off' } | { kind: 'offline' } | { kind: 'signedOut' } | { kind: 'unavailable' } | { kind: 'absent' };

/** Reduces the daemon's mobile state to the row's summary; the first matching rule wins. */
export function mobileSummary(m: MobileState | undefined): MobileSummary {
  if (m === undefined) return { kind: 'absent' };
  if (m.link.state === 'unavailable') return { kind: 'unavailable' };
  if (!m.enabled) return { kind: 'off' };
  if (m.account === null) return { kind: 'signedOut' };
  if (m.link.state === 'offline' || m.link.state === 'signed_out') return { kind: 'offline' };
  return { kind: 'online', devices: m.devices.length, requests: waitingPairings(m).length };
}

/** A device's glyph: a tablet gets the wide one; without a kind, the label tells (`iPad` is a tablet). */
export function deviceGlyph(kind: DeviceKind | undefined, g: Glyphs, label = ''): string {
  return (kind ?? deviceKindOfLabel(label)) === 'tablet' ? g.tablet : g.phone;
}

/** The name the user gave a device, or else its label. */
export const deviceName = (d: Device): string => d.name ?? d.label;

export { deviceWord } from '@ledge/fleet';

/** Sends a mobile command to the local daemon; a refusal to send (offline, too old to know mobile access) is a toast, not a crash. True when sent. */
export function sendMobile(tui: Pick<Tui, 'client' | 'toast' | 't'>, msg: MobileClientMessage): boolean {
  const fleet = tui.client.fleet;
  if (!fleet) return false;
  try { fleet.sendMobile(msg); return true; } catch (e) {
    tui.toast({ text: (e as Error).name === 'DaemonOutdated' ? tui.t.mobile.refusedOutdated : tui.t.mobile.refusedOffline, tone: 'error' });
    return false;
  }
}

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

/** « 3 nov » or « Nov 3 »: the day without its year, in the interface's language. */
export function shortDate(iso: string, lang: Lang): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short' }).format(at).replace(/\.$/, '');
}

/** When a device's last sign of life was, as the hint says it: « vu à l'instant », « vu il y a 2 min », « vu hier »; nothing when never seen. */
export function seenText(d: Device, now: number, c: Messages['mobile'], time: Messages['time']): string {
  if (d.online) return c.seenNow;
  const at = d.lastSeenAt ? Date.parse(d.lastSeenAt) : NaN;
  if (Number.isNaN(at)) return '';
  if (sameDay(at, now - 86_400_000)) return c.seenYesterday;
  const span = ago(d.lastSeenAt!, now, time);
  return span === time.now ? c.seenNow : c.seenAgo(span);
}

/** « Aujourd'hui à 10:12 » for a moment of today, else « Le 3 nov à 10:12 ». */
export function whenAt(iso: string, now: number, c: Messages['mobile'], lang: Lang): string {
  return sameDay(Date.parse(iso), now) ? c.todayAt(clock(iso)) : c.dateAt(shortDate(iso, lang), clock(iso));
}
