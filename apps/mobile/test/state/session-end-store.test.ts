import { afterEach, describe, expect, it } from 'vitest';
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
