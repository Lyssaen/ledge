import { describe, expect, it } from 'vitest';
import type { PhoneRig } from '@ledge/protocol';
import { createStore } from '../../src/state/store';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

const rig: PhoneRig = { key: 'abc', name: 'A', project: null, offProject: true, lifecycle: 'running', kernel: false, seats: [], repos: 0 };
const at = '2026-11-01T10:00:00.000Z';
describe('OpenRig state', () => {
  it('accepts rig snapshots, replaces thread rows in place and forgets removed rigs', () => {
    const f = fakeLink('ready'); const store = createStore(f.link, new MemoryStorage());
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
  it('loads older pages once per response and retains the current ordering', () => {
    const f = fakeLink('ready'); const store = createStore(f.link, new MemoryStorage());
    const initial = snapshot([]); if (initial.type !== 'snapshot') throw new Error('missing snapshot');
    f.deliver({ ...initial, daemon: { version: '1.0', name: 'PC', openrig: true } });
    f.deliver({ type: 'ledge.thread.history', items: [{ kind: 'ledge', id: 'new', at, text: 'récent' }], before: 'cursor' });
    store.loadOlderThread(); store.loadOlderThread();
    expect(f.of('ledge.thread.request').filter(m => m.before === 'cursor')).toHaveLength(1);
    f.deliver({ type: 'ledge.thread.history', items: [{ kind: 'user', id: 'old', at, text: 'ancien' }], before: 'next' });
    expect(store.getState().ledgeThread.map(i => i.id)).toEqual(['old', 'new']);
    store.loadOlderThread(); expect(f.of('ledge.thread.request').some(m => m.before === 'next')).toBe(true); store.close();
  });
  it('queries a durable receipt after the daemon restarts without repeating the answer', () => {
    const f = fakeLink('ready'); const store = createStore(f.link, new MemoryStorage());
    const initial = snapshot([]); if (initial.type !== 'snapshot') throw new Error('missing snapshot');
    f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '11111111-1111-4111-8111-111111111111', openrig: true, answerReceipts: true } });
    const op = store.answerEscalation('q1', { text: 'go' }); if (!op) throw new Error('answer not sent');
    f.deliver({ type: 'operation.result', op, status: 'received' });
    f.set('pc_offline'); f.set('ready');
    f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '22222222-2222-4222-8222-222222222222', openrig: true, answerReceipts: true } });
    expect(f.of('escalation.answer')).toHaveLength(1);
    expect(f.of('answer.receipt.request')).toMatchObject([{ answer: { op, id: 'q1', answers: { text: 'go' } } }]);
    f.deliver({ type: 'answer.receipt', op, status: 'applied' }); expect(store.getState().ops[op]?.phase).toBe('applied'); store.close();
  });
  it('keeps an unknown receipt uncertain and never queries an old daemon', () => {
    const f = fakeLink('ready'); const store = createStore(f.link, new MemoryStorage()); const initial = snapshot([]); if (initial.type !== 'snapshot') throw new Error('missing snapshot');
    f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '11111111-1111-4111-8111-111111111111', openrig: true, answerReceipts: true } });
    const op = store.answerEscalation('q1', { text: 'go' })!; f.deliver({ type: 'operation.result', op, status: 'received' });
    f.set('pc_offline'); f.set('ready'); f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '22222222-2222-4222-8222-222222222222', openrig: true } });
    expect(f.of('answer.receipt.request')).toEqual([]); expect(f.of('escalation.answer')).toHaveLength(1); expect(store.getState().ops[op]?.phase).toBe('uncertain'); store.close();
  });
  it('does not claim application when a receipt query returns unknown', () => {
    const f = fakeLink('ready'); const store = createStore(f.link, new MemoryStorage()); const initial = snapshot([]); if (initial.type !== 'snapshot') throw new Error('missing snapshot');
    f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '11111111-1111-4111-8111-111111111111', openrig: true, answerReceipts: true } });
    const op = store.answerEscalation('q1', { text: 'go' })!; f.deliver({ type: 'operation.result', op, status: 'received' }); f.set('pc_offline'); f.set('ready');
    f.deliver({ ...initial, daemon: { version: '1', name: 'PC', boot: '22222222-2222-4222-8222-222222222222', openrig: true, answerReceipts: true } });
    f.deliver({ type: 'answer.receipt', op, status: 'unknown' }); expect(store.getState().ops[op]?.phase).toBe('uncertain'); expect(f.of('escalation.answer')).toHaveLength(1); store.close();
  });

});
