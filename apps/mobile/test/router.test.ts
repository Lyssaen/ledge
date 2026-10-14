import { describe, expect, it } from 'vitest';
import { href, parseRoute } from '../src/router';

describe('router', () => {
  it('parses #/request/<sid>/<pid> and falls back to the inbox', () => {
    expect(parseRoute('#/request/s1/p%201')).toEqual({ name: 'request', sessionId: 's1', pendingId: 'p 1' });
    expect(parseRoute('#/pair')).toEqual({ name: 'pair' });
    expect(parseRoute('')).toEqual({ name: 'inbox' });
    expect(parseRoute('#/request/onlyone')).toEqual({ name: 'inbox' });
    expect(parseRoute('#/nonsense')).toEqual({ name: 'inbox' });
  });
  it('round-trips through href', () => {
    const r = { name: 'request', sessionId: 'a/b', pendingId: 'c d' } as const;
    expect(parseRoute(href(r))).toEqual(r);
    expect(href({ name: 'inbox' })).toBe('#/');
  });
});
