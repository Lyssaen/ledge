import { describe, expect, it } from 'vitest';
import type { PhoneRig } from '@ledge/protocol';
import { createStore } from '../../src/state/store';
import { fakeLink, snapshot } from './helpers';

const rig: PhoneRig = { key: 'abc', name: 'A', project: null, offProject: true, lifecycle: 'running', kernel: false, seats: [], repos: 0 };
const at = '2026-11-01T10:00:00.000Z';
describe('OpenRig state', () => {
  it('accepts rig snapshots, replaces thread rows in place and forgets removed rigs', () => {
    const f = fakeLink('ready'); const store = createStore(f.link);
    const initial = snapshot([]); if (initial.type !== 'snapshot') throw new Error('missing snapshot');
    f.deliver({ ...initial, daemon: { version: '1.0', name: 'PC', openrig: true }, rigs: [rig], escalations: [], decisionsToday: [] });
    expect(store.getState().openrig).toBe(true); expect(store.getState().rigs.get('abc')).toEqual(rig);
    f.deliver({ type: 'ledge.thread.item', item: { kind: 'ledge', id: 'a', at, text: 'un' } });
    f.deliver({ type: 'ledge.thread.item', item: { kind: 'ledge', id: 'b', at, text: 'deux' } });
    f.deliver({ type: 'ledge.thread.item', item: { kind: 'ledge', id: 'a', at, text: 'modifié' } });
    expect(store.getState().ledgeThread.map(i => i.id)).toEqual(['a', 'b']);
    expect(store.getState().ledgeThread[0]).toMatchObject({ text: 'modifié' });
    f.deliver({ type: 'rig.removed', key: 'abc' }); expect(store.getState().rigs.size).toBe(0);
    f.deliver(snapshot([])); expect(store.getState().openrig).toBe(false); store.close();
  });
});
