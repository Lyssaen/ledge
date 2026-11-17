import { describe, it, expect } from 'vitest';
import type { MobileState } from '@ledge/protocol';
import { replaceable } from '@ledge/fleet';
import { deviceGlyph, deviceName, deviceWord, mobileSummary, waitingPairings } from '../src/tui/model/mobile.js';
import { copyText } from '../src/tui/clipboard.js';
import { glyphsFor } from '../src/tui/glyphs.js';

const g = glyphsFor({ LANG: 'en_US.UTF-8' });
const dev = (o: Record<string, unknown>) => ({ id: 'd', label: 'iPhone · Safari', approvedAt: '2026-01-01T00:00:00.000Z', online: false, ...o });
const state = (o: Record<string, unknown>) => ({ enabled: true, account: { login: 'me' }, link: { state: 'online' }, devices: [], pairings: [], ...o }) as unknown as MobileState;
const pairing = (id: string, s: string, expiresAt: string) => ({ id, label: 'iPhone', code: null, expiresAt, state: s });

describe('waitingPairings', () => {
  it('keeps the confirm ones, oldest expiry first', () => {
    const m = state({ pairings: [pairing('a', 'confirm', '2026-01-01T00:02:00.000Z'), pairing('b', 'waiting', '2026-01-01T00:00:00.000Z'), pairing('c', 'confirm', '2026-01-01T00:01:00.000Z')] });
    expect(waitingPairings(m).map(p => p.id)).toEqual(['c', 'a']);
    expect(waitingPairings(undefined)).toEqual([]);
  });
});

describe('mobileSummary', () => {
  it('follows the rules in order', () => {
    expect(mobileSummary(undefined)).toEqual({ kind: 'absent' });
    expect(mobileSummary(state({ enabled: false, link: { state: 'unavailable', error: 'x' } }))).toEqual({ kind: 'unavailable' });
    expect(mobileSummary(state({ enabled: false }))).toEqual({ kind: 'off' });
    expect(mobileSummary(state({ account: null }))).toEqual({ kind: 'signedOut' });
    expect(mobileSummary(state({ link: { state: 'offline' } }))).toEqual({ kind: 'offline' });
    expect(mobileSummary(state({ link: { state: 'signed_out' } }))).toEqual({ kind: 'offline' });
    const m = state({ devices: [dev({ id: 'x' })], pairings: [pairing('a', 'confirm', '2026-01-01T00:02:00.000Z')] });
    expect(mobileSummary(m)).toEqual({ kind: 'online', devices: 1, requests: 1 });
  });
});

describe('devices', () => {
  it('draws a glyph by kind, or by label when the kind is absent', () => {
    expect(deviceGlyph('tablet', g)).toBe('▭');
    expect(deviceGlyph('phone', g)).toBe('▯');
    expect(deviceGlyph(undefined, g)).toBe('▯');
    expect(deviceGlyph(undefined, g, 'iPad')).toBe('▭');
    expect(deviceGlyph('tablet', glyphsFor({ LEDGE_TUI_ASCII: '1' }))).toBe('[=]');
  });
  it('prefers the given name', () => {
    expect(deviceName(dev({ name: 'Mon tel' }) as never)).toBe('Mon tel');
    expect(deviceName(dev({}) as never)).toBe('iPhone · Safari');
  });
  it('words a device like Desktop does', () => {
    expect(deviceWord(undefined)).toBeNull();
    expect(deviceWord(dev({ name: 'Mon tel' }) as never)).toEqual({ text: 'Mon tel', named: true });
    expect(deviceWord(dev({}) as never)).toEqual({ text: 'iPhone', named: false });
  });
});

describe('copyText', () => {
  it('writes the OSC 52 sequence', () => {
    const out: string[] = [];
    copyText('WDJB-MJHT', s => out.push(s));
    expect(out).toEqual(['\x1b]52;c;' + Buffer.from('WDJB-MJHT').toString('base64') + '\x07']);
  });
});

describe('replaceable', () => {
  it('gives the offline device of the same label seen last', () => {
    const m = state({ devices: [dev({ id: 'old', lastSeenAt: '2026-01-02T00:00:00.000Z' }), dev({ id: 'older', lastSeenAt: '2026-01-01T00:00:00.000Z' }), dev({ id: 'on', online: true }), dev({ id: 'other', label: 'Pixel' })] });
    expect(replaceable(m, 'iPhone · Safari')?.id).toBe('old');
    expect(replaceable(state({ devices: [dev({ online: true })] }), 'iPhone · Safari')).toBeNull();
    expect(replaceable(m, 'Nokia')).toBeNull();
  });
});
