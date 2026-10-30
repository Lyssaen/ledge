import { describe, expect, it } from 'vitest';
import type { Rig, Session, SessionRig, Tool } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { pairSession, unpairGone } from '../src/daemon/openrig/pairing.js';

const T0 = '2026-10-30T10:00:00.000Z';
const sess = (id: string, over: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/app', project: 'app', title: 'Otto · app', tmuxSession: null, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'hook_only', ...over });
const rig = (id: string, name: string, seats: Array<[string, string]>, cwd = '/w/app'): Rig => ({ id, name, machine: 'local', cwd, projectId: null, offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: seats.map(([ref, runtime]) => ({ ref, address: `@${ref}`, name: ref, runtime, state: 'ready' as const })) });
const SR = (name = 'dev-build@starter'): SessionRig => ({ machine: 'local', rigId: 'r1', rigName: 'starter', seat: name, pod: 'dev', member: 'build' });

/** A fake bridge over a rig list: `pair` knows names, `pairByCwd` follows the real rule (one free seat of the tool in the cwd). */
function fake(rigs: Rig[]) {
  const calls: string[] = [];
  return { calls,
    pair(id: string, name: string) { calls.push(`pair:${id}:${name}`); const r = rigs.find(x => x.seats.some(s => s.ref === name)); return r ? { ...SR(name), rigId: r.id, rigName: r.name } : null; },
    pairByCwd(id: string, cwd: string, tool: Tool) {
      calls.push(`cwd:${id}`);
      const seats = rigs.filter(r => r.cwd === cwd).flatMap(r => r.seats).filter(s => (s.runtime === 'claude-code' ? 'claude' : s.runtime) === tool);
      return seats.length === 1 ? { ...SR(seats[0]!.ref) } : null;
    } };
}

describe('pairSession', () => {
  it('pairs by the seat name and tells the bridge', () => {
    const store = new Store(); store.upsert(sess('a')); const seen: Session[] = []; store.onChange(c => { if (c.type === 'updated') seen.push(c.session); });
    const b = fake([rig('r1', 'starter', [['dev-build@starter', 'claude-code']])]);
    expect(pairSession(store, b, { id: 'a', cwd: '/w/app', agent: 'claude', openrig: { sessionName: 'dev-build@starter' } })).toBe(true);
    expect(store.get('a')!.rig).toEqual(SR());
    expect(b.calls).toEqual(['pair:a:dev-build@starter']);
    expect(seen).toHaveLength(1); // session.updated goes out
    expect(pairSession(store, b, { id: 'a', cwd: '/w/app', agent: 'claude', openrig: { sessionName: 'dev-build@starter' } })).toBe(false); // unchanged
    expect(seen).toHaveLength(1);
  });
  it('an unknown name pairs nothing (and does not fall back to the cwd)', () => {
    const store = new Store(); store.upsert(sess('a'));
    const b = fake([rig('r1', 'starter', [['dev-build@starter', 'claude-code']])]);
    expect(pairSession(store, b, { id: 'a', cwd: '/w/app', agent: 'claude', openrig: { sessionName: 'nope@starter' } })).toBe(false);
    expect(store.get('a')!.rig).toBeUndefined(); expect(b.calls).toEqual(['pair:a:nope@starter']);
  });
  it('Codex in a shared app-server (no openrig): falls back to cwd + tool, only when unique', () => {
    const one = new Store(); one.upsert(sess('c', { tool: 'codex' }));
    const b1 = fake([rig('r1', 'starter', [['dev-build@starter', 'codex']])]);
    expect(pairSession(one, b1, { id: 'c', cwd: '/w/app', agent: 'codex' })).toBe(true);
    expect(one.get('c')!.rig?.seat).toBe('dev-build@starter');
    const two = new Store(); two.upsert(sess('c', { tool: 'codex' }));
    const b2 = fake([rig('r1', 'starter', [['dev-build@starter', 'codex'], ['dev-test@starter', 'codex']])]);
    expect(pairSession(two, b2, { id: 'c', cwd: '/w/app', agent: 'codex' })).toBe(false);
    expect(two.get('c')!.rig).toBeUndefined();
  });
  it('the cwd fallback is for a read-only session without a rig only', () => {
    const b = fake([rig('r1', 'starter', [['dev-build@starter', 'claude-code']])]);
    const launched = new Store(); launched.upsert(sess('a', { source: 'launcher' }));
    expect(pairSession(launched, b, { id: 'a', cwd: '/w/app', agent: 'claude' })).toBe(false);
    const paired = new Store(); paired.upsert(sess('a', { rig: SR('x@y') }));
    expect(pairSession(paired, b, { id: 'a', cwd: '/w/app', agent: 'claude' })).toBe(false);
    expect(b.calls).toEqual(['pair:a:x@y']); expect(paired.get('a')!.rig).toEqual(SR('x@y')); // restore attempt only, no cwd fallback
    const noCwd = new Store(); noCwd.upsert(sess('a'));
    expect(pairSession(noCwd, b, { id: 'a', agent: 'claude' })).toBe(false);
  });
  it('a session that kept its rig re-tells the bridge (Ledge restarted), store untouched', () => {
    const store = new Store(); store.upsert(sess('a', { rig: SR() })); let updates = 0; store.onChange(c => { if (c.type === 'updated') updates++; });
    const b = fake([rig('r1', 'starter', [['dev-build@starter', 'claude-code']])]);
    expect(pairSession(store, b, { id: 'a', cwd: '/w/app', agent: 'claude' })).toBe(false);
    expect(b.calls).toEqual(['pair:a:dev-build@starter']); expect(updates).toBe(0);
  });
  it('an unknown session pairs nothing', () => {
    const b = fake([rig('r1', 'starter', [['dev-build@starter', 'claude-code']])]);
    expect(pairSession(new Store(), b, { id: 'zz', openrig: { sessionName: 'dev-build@starter' } })).toBe(false);
  });
});

describe('unpairGone', () => {
  it('removes `rig` from the sessions whose rig disappeared and notifies', () => {
    const store = new Store(); store.upsert(sess('a', { rig: SR() })); store.upsert(sess('b', { rig: { ...SR('x@other'), rigId: 'r2', rigName: 'other' } })); store.upsert(sess('c'));
    const seen: Session[] = []; store.onChange(c => { if (c.type === 'updated') seen.push(c.session); });
    expect(unpairGone(store, [rig('r2', 'other', [])])).toEqual(['a']);
    expect('rig' in store.get('a')!).toBe(false); expect(store.get('b')!.rig?.rigId).toBe('r2');
    expect(seen.map(s => s.id)).toEqual(['a']);
    expect(unpairGone(store, [rig('r2', 'other', [])])).toEqual([]);
  });
});
