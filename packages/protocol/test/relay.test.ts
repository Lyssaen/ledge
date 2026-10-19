import { describe, it, expect } from 'vitest';
import { SEALED_MAX, parseRelayClientMessage, parseRelayServerMessage, SealedFrameSchema, PAIR_LABEL_MAX } from '../src/index.js';

const DEV = 'd_' + 'a'.repeat(16);

describe('relay frames', () => {
  it('accepts a send to the pc and to a device', () => {
    expect(parseRelayClientMessage({ type: 'send', to: 'pc', body: 'x' }).to).toBe('pc');
    expect(parseRelayClientMessage({ type: 'send', to: DEV, body: 'x' }).to).toBe(DEV);
  });
  it('refuses a short device id, an unknown peer and an oversize body', () => {
    expect(() => parseRelayClientMessage({ type: 'send', to: 'd_court', body: 'x' })).toThrow();
    expect(() => parseRelayClientMessage({ type: 'send', to: 'admin', body: 'x' })).toThrow();
    expect(() => parseRelayClientMessage({ type: 'send', to: 'pc', body: 'x'.repeat(SEALED_MAX + 1) })).toThrow();
    expect(parseRelayClientMessage({ type: 'send', to: 'pc', body: 'x'.repeat(SEALED_MAX) }).body).toHaveLength(SEALED_MAX);
  });
  it('parses every server frame', () => {
    for (const m of [
      { type: 'welcome', accountId: 'a', self: 'pc', online: [DEV] },
      { type: 'deliver', from: DEV, body: 'b' },
      { type: 'presence', peer: 'pc', online: true },
      { type: 'error', code: 'offline', to: 'pc' },
      { type: 'error', code: 'bad_frame' }
    ]) expect(parseRelayServerMessage(m)).toEqual(m);
    expect(() => parseRelayServerMessage({ type: 'error', code: 'nope' })).toThrow();
  });
  it('knows the sealed frame kinds', () => {
    const key = 'A'.repeat(87);
    const n43 = 'B'.repeat(43);
    const frames = [
      { k: 'hello', e: key, f: 'C'.repeat(22) },
      { k: 'msg', s: 'x' },
      { k: 'pair_commit', c: n43, label: 'My phone' },
      { k: 'pair_offer', pc: key, n: n43 },
      { k: 'pair_reveal', d: key, n: n43 },
      { k: 'pair_ok' },
      { k: 'pair_no' },
      { k: 'denied' },
      { k: 'rekey' }
    ];
    for (const f of frames) expect(SealedFrameSchema.parse(f)).toEqual(f);
    expect(SealedFrameSchema.safeParse({ k: 'other' }).success).toBe(false);
  });
  it('bounds the sealed frame fields', () => {
    const key = 'A'.repeat(87);
    const n43 = 'B'.repeat(43);
    expect(() => SealedFrameSchema.parse({ k: 'hello', e: key })).toThrow();
    expect(() => SealedFrameSchema.parse({ k: 'pair_commit', c: n43, label: 'x'.repeat(PAIR_LABEL_MAX + 1) })).toThrow();
    expect(PAIR_LABEL_MAX).toBe(40);
    expect(() => SealedFrameSchema.parse({ k: 'pair_commit', c: n43, label: '   ' })).toThrow();
    expect(() => SealedFrameSchema.parse({ k: 'pair_reveal', d: key, n: 'B'.repeat(42) })).toThrow();
  });
});
