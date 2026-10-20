import { describe, it, expect } from 'vitest';
import { createChallengeStore, type ChallengeBinding } from '../src/mobile/challenges.js';

const bind = (over: Partial<ChallengeBinding> = {}): ChallengeBinding => ({ deviceId: 'dev-1', purpose: 'decide', subject: 's1:3', ...over });
const clock = () => {
  let t = 0;
  return { now: () => t, at: (ms: number) => { t = ms; } };
};

describe('createChallengeStore', () => {
  it('accepts a challenge once', () => {
    const store = createChallengeStore();
    const c = store.issue(bind());
    expect(store.consume(c, bind())).toBe('ok');
    expect(store.consume(c, bind())).toBe('unknown');
  });

  it('expires after the TTL and drops the challenge', () => {
    const k = clock();
    const store = createChallengeStore({ now: k.now });
    const c = store.issue(bind());
    k.at(60_001);
    expect(store.consume(c, bind())).toBe('expired');
    expect(store.consume(c, bind())).toBe('unknown');
  });

  it.each([
    ['device', bind({ deviceId: 'dev-2' })],
    ['subject', bind({ subject: 's1:4' })],
    ['purpose', bind({ purpose: 'launch' })],
  ])('refuses a challenge bound to another %s and drops it', (_, other) => {
    const store = createChallengeStore();
    const c = store.issue(bind());
    expect(store.consume(c, other)).toBe('mismatch');
    expect(store.consume(c, bind())).toBe('unknown');
  });

  it('a second issue for the same device, purpose and subject evicts the first', () => {
    const store = createChallengeStore();
    const first = store.issue(bind());
    const second = store.issue(bind());
    expect(store.consume(first, bind())).toBe('unknown');
    expect(store.consume(second, bind())).toBe('ok');
  });

  it('evicts the oldest challenge when more than max are outstanding', () => {
    const store = createChallengeStore({ max: 2 });
    const a = store.issue(bind({ deviceId: 'a' }));
    const b = store.issue(bind({ deviceId: 'b' }));
    const c = store.issue(bind({ deviceId: 'c' }));
    expect(store.consume(a, bind({ deviceId: 'a' }))).toBe('unknown');
    expect(store.consume(b, bind({ deviceId: 'b' }))).toBe('ok');
    expect(store.consume(c, bind({ deviceId: 'c' }))).toBe('ok');
  });

  it('issues 32 random bytes encoded as 43 base64url characters', () => {
    const store = createChallengeStore();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const c = store.issue(bind({ deviceId: `d${i}` }));
      expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(20);
  });

  it('answers unknown, without throwing, for a value that is not a challenge', () => {
    const store = createChallengeStore();
    expect(store.consume('', bind())).toBe('unknown');
    expect(store.consume(undefined as unknown as string, bind())).toBe('unknown');
    expect(store.consume(42 as unknown as string, bind())).toBe('unknown');
  });
});
