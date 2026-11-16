import { deviceKindOfLabel, type DeviceKind, type MobilePairing, type MobileState } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';

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

/** A device as a sentence names it: the name the user gave, said bare, or else its model (the label's first part), which the copy gives an article. */
export function deviceWord(d: Pick<Device, 'name' | 'label'> | undefined): { text: string; named: boolean } | null {
  return d === undefined ? null : d.name ? { text: d.name, named: true } : { text: d.label.split(' · ')[0] || d.label, named: false };
}
