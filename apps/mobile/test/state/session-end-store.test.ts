import { afterEach, describe, expect, it } from 'vitest';
import { closedHere, endingOf } from '../../src/model/sessionEnd';
import { createStore, type MobileStore } from '../../src/state/store';
import { OPS_KEY } from '../../src/state/operations';
import { session } from '../model/fixtures';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

const stores: MobileStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

function setup() {
  const f = fakeLink('ready');
  const storage = new MemoryStorage();
  const store = createStore(f.link, storage);
  stores.push(store);
  f.deliver({ ...snapshot([session('a', { name: 'Nova' })]), daemon: { version: '0.29.0', name: 'PC', sessionClose: true } } as never);
  return { ...f, store, storage };
}
const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };

describe('a session closed or resumed from its page, in the store', () => {
  it('knows the PC takes them from its snapshot', () => {
    expect(setup().store.getState().daemon).toMatchObject({ sessionClose: true });
  });

  it('asks a challenge over the session', async () => {
    const t = setup();
    void t.store.prepareConfirm({ purpose: 'close', id: 'a' }).catch(() => undefined);
    void t.store.prepareConfirm({ purpose: 'act', id: 'a' }).catch(() => undefined);
    expect(t.of('confirm.prepare')).toEqual([{ type: 'confirm.prepare', purpose: 'close', id: 'a' }, { type: 'confirm.prepare', purpose: 'act', id: 'a' }]);
  });

  it('sends the close with its assertion once: a second one waits for the first', () => {
    const t = setup();
    const op = t.store.sessionClose('a', assertion);
    expect(op).not.toBeNull();
    expect(t.of('session.close')).toEqual([{ type: 'session.close', op, id: 'a', assertion }]);
    expect(t.store.sessionClose('a', assertion)).toBeNull();
    expect(t.of('session.close')).toHaveLength(1);
    expect(t.store.sessionClose('nope', assertion)).toBeNull();
  });

  it('keeps how the PC closed the agent, and keeps nothing across a reload: the op carries an assertion', () => {
    const t = setup();
    const op = t.store.sessionClose('a', assertion)!;
    t.deliver({ type: 'operation.result', op, status: 'received' });
    t.deliver({ type: 'operation.result', op, status: 'applied', how: 'killed' });
    expect(t.store.getState().ops[op]).toMatchObject({ phase: 'applied', how: 'killed' });
    expect(JSON.parse(t.storage.getItem(OPS_KEY) ?? '{}')).toEqual({});
    // Finished, it no longer holds a new close back (a session resumed then closed again).
    expect(t.store.sessionClose('a', assertion)).not.toBeNull();
  });

  it('keeps on the op the session’s startedAt as the PC gave it: the run it is about, never this phone’s clock', () => {
    const t = setup();
    const close = t.store.sessionClose('a', assertion)!;
    expect(t.store.getState().ops[close]).toMatchObject({ startedAt: session('a').startedAt });
    t.deliver({ type: 'operation.result', op: close, status: 'applied', how: 'exit' });
    t.deliver({ type: 'session.updated', session: session('a', { name: 'Nova', state: 'exited' }) });
    const resume = t.store.sessionResume('a', assertion)!;
    expect(t.store.getState().ops[resume]).toMatchObject({ startedAt: session('a').startedAt });
  });

  it('a close sent while the session starts takes the startedAt of the run that start gives, then owns its end (#133)', () => {
    const t = setup();
    const S0 = session('a').startedAt, S2 = new Date().toISOString();
    t.deliver({ type: 'session.updated', session: session('a', { name: 'Nova', state: 'starting' }) });
    const close = t.store.sessionClose('a', assertion)!;
    expect(t.store.getState().ops[close]).toMatchObject({ startedAt: S0, starting: true });
    t.deliver({ type: 'operation.result', op: close, status: 'received' });
    t.deliver({ type: 'session.updated', session: session('a', { name: 'Nova', state: 'idle', startedAt: S2 }) });
    expect(t.store.getState().ops[close]).toMatchObject({ startedAt: S2 });
    expect(t.store.getState().ops[close]!.starting).toBeUndefined();
    t.deliver({ type: 'operation.result', op: close, status: 'applied', how: 'killed' });
    const ended = session('a', { name: 'Nova', state: 'exited', startedAt: S2 });
    t.deliver({ type: 'session.updated', session: ended });
    expect(closedHere(ended, t.store.getState().ops)).toBe(true);
    expect(endingOf(ended, t.store.getState().ops)).toMatchObject({ kind: 'ended', killed: true });
  });

  it('a close sent on a running session is not marked: a later start is not its run', () => {
    const t = setup();
    const close = t.store.sessionClose('a', assertion)!;
    expect(t.store.getState().ops[close]!.starting).toBeUndefined();
  });

  it('sends the resume with its assertion', () => {
    const t = setup();
    const op = t.store.sessionResume('a', assertion);
    expect(t.of('session.resume')).toEqual([{ type: 'session.resume', op, id: 'a', assertion }]);
  });

  it('sends nothing while the PC cannot be reached', () => {
    const t = setup();
    t.set('pc_offline');
    expect(t.store.sessionClose('a', assertion)).toBeNull();
    expect(t.store.sessionResume('a', assertion)).toBeNull();
  });
});
