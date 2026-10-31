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
  { name: 'teams' },
  { name: 'team', key: 'new' },
  { name: 'team', key: 'repo~ledge~un chef' },
  { name: 'team-copy', teamId: 'team-a1b2' },
  { name: 'role', key: 'home~~lead' },
  { name: 'role', key: 'repo~mon dépôt~lead' },
  { name: 'team', key: 'repo~a/b~x' },
  { name: 'role', key: 'repo~a/b~x' },
  { name: 'live', teamId: 'team-a1b2' },
  { name: 'compose', teamId: 'team-a1b2' }
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

  it('writes the team routes as #/teams, #/team/<key>, #/team-copy/<id>, #/role/<key>, #/live/<id>, #/compose/<id>', () => {
    expect(href({ name: 'teams' })).toBe('#/teams');
    expect(href({ name: 'team', key: 'new' })).toBe('#/team/new');
    expect(href({ name: 'team', key: 'repo~ledge~a b' })).toBe('#/team/repo~ledge~a%20b');
    expect(href({ name: 'team-copy', teamId: 'team-a1b2' })).toBe('#/team-copy/team-a1b2');
    expect(href({ name: 'live', teamId: 'team-a1b2' })).toBe('#/live/team-a1b2');
    expect(href({ name: 'compose', teamId: 'team-a1b2' })).toBe('#/compose/team-a1b2');
    expect(parseRoute('#/team')).toEqual({ name: 'inbox' });
  });

  it('falls back to the inbox on a malformed escape', () => {
    expect(parseRoute('#/thread/%E0%A4%A')).toEqual({ name: 'inbox' });
  });
});
