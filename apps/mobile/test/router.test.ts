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
  it('parses the agents, thread and terminal routes', () => {
    expect(parseRoute('#/agents')).toEqual({ name: 'agents' });
    expect(parseRoute('#/thread/s%2F1')).toEqual({ name: 'thread', sessionId: 's/1' });
    expect(parseRoute('#/terminal/s1')).toEqual({ name: 'terminal', sessionId: 's1' });
    expect(parseRoute('#/thread')).toEqual({ name: 'inbox' });
    expect(parseRoute('#/thread/%E0')).toEqual({ name: 'inbox' });
    for (const r of [{ name: 'thread', sessionId: 'a b' }, { name: 'terminal', sessionId: 'x' }, { name: 'agents' }] as const) expect(parseRoute(href(r))).toEqual(r);
  });
  it('round-trips through href', () => {
    const r = { name: 'request', sessionId: 'a/b', pendingId: 'c d' } as const;
    expect(parseRoute(href(r))).toEqual(r);
    expect(href({ name: 'inbox' })).toBe('#/');
  });
});
