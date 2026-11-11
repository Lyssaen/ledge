import { describe, expect, it } from 'vitest';
import { href, parseRoute, type Route } from '../src/router';

const routes: Route[] = [
  { name: 'atoi' },
  { name: 'sessions' },
  { name: 'sessions', filter: 'working' },
  { name: 'sessions', filter: 'waiting' },
  { name: 'prs' },
  { name: 'rigs' },
  { name: 'chat' },
  { name: 'thread', sessionId: 's1' },
  { name: 'terminal', sessionId: 's1' },
  { name: 'request', sessionId: 's1', key: 'k1' },
  { name: 'connection' },
  { name: 'connection', section: 'link' },
  { name: 'rig', rig: 'ledge-dev' },
  { name: 'rig', rig: 'a b/c' },
  { name: 'kernel' },
  { name: 'max' },
  { name: 'max', goalId: 'g-12345678' }
];

describe('router', () => {
  it.each(routes)('round-trips %j', (r) => {
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('sends #/pair and unknown hashes to À toi', () => {
    expect(parseRoute('#/pair')).toEqual({ name: 'atoi' });
    expect(parseRoute('#/nimporte')).toEqual({ name: 'atoi' });
    expect(parseRoute('')).toEqual({ name: 'atoi' });
  });

  it('reads #/agents, the old address of Sessions', () => {
    expect(parseRoute('#/agents')).toEqual({ name: 'sessions' });
  });

  it('decodes an encoded sid or key once', () => {
    expect(parseRoute('#/thread/a%2Fb')).toEqual({ name: 'thread', sessionId: 'a/b' });
    expect(parseRoute('#/request/a%2Fb/c%252Fd')).toEqual({ name: 'request', sessionId: 'a/b', key: 'c%2Fd' });
    const r: Route = { name: 'request', sessionId: 'a/b', key: 'x/y%z' };
    expect(parseRoute(href(r))).toEqual(r);
  });

  it('falls back to À toi on a malformed escape', () => {
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ name: 'atoi' });
  });
});
