import { describe, it, expect } from 'vitest';
import { SEALED_MAX, parseRelayClientMessage, parseRelayServerMessage, SealedFrameSchema } from '../src/index.js';

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
    expect(SealedFrameSchema.parse({ k: 'hello', e: 'x' }).k).toBe('hello');
    expect(SealedFrameSchema.parse({ k: 'msg', s: 'x' }).k).toBe('msg');
    expect(SealedFrameSchema.safeParse({ k: 'other' }).success).toBe(false);
  });
});
