import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/router';

const routes: Route[] = [
  { name: 'inbox' },
  { name: 'agents' },
  { name: 'chat' },
  { name: 'thread', sessionId: 's1' },
  { name: 'terminal', sessionId: 's1' },
  { name: 'request', sessionId: 's1', key: 'k1' },
  { name: 'connection' },
  { name: 'login' },
  { name: 'link' },
  { name: 'key-changed' },
  { name: 'update' }
];

describe('router', () => {
  it.each(routes)('round-trips %j', (r) => {
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('sends #/pair and unknown hashes to the inbox', () => {
    expect(parseRoute('#/pair')).toEqual({ name: 'inbox' });
    expect(parseRoute('#/nimporte')).toEqual({ name: 'inbox' });
    expect(parseRoute('')).toEqual({ name: 'inbox' });
  });

  it('decodes an encoded sid or key once', () => {
    expect(parseRoute('#/thread/a%2Fb')).toEqual({ name: 'thread', sessionId: 'a/b' });
    expect(parseRoute('#/request/a%2Fb/c%252Fd')).toEqual({ name: 'request', sessionId: 'a/b', key: 'c%2Fd' });
    const r: Route = { name: 'request', sessionId: 'a/b', key: 'x/y%z' };
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('falls back to the inbox on a malformed escape', () => {
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ name: 'inbox' });
  });
});
