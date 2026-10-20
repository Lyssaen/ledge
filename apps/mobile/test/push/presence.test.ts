import { afterEach, describe, expect, it } from 'vitest';
import { startPresence } from '../../src/push/presence';
import { setup } from '../screens/setup';

const visibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); });

describe('startPresence', () => {
  it('tells the PC whether the app is in front, at start and at every visibilitychange', () => {
    const t = setup();
    const stop = startPresence(t.store);
    expect(t.of('presence')).toEqual([{ type: 'presence', visible: true }]);
    visibility('hidden');
    expect(t.of('presence').at(-1)).toEqual({ type: 'presence', visible: false });
    visibility('visible');
    expect(t.of('presence').at(-1)).toEqual({ type: 'presence', visible: true });
    stop();
    const n = t.of('presence').length;
    visibility('hidden');
    expect(t.of('presence')).toHaveLength(n);
  });

  it('says it again after every ready, from what is true then', () => {
    const t = setup('pc_offline');
    startPresence(t.store);
    visibility('hidden');
    expect(t.of('presence')).toEqual([]);
    t.set('ready');
    expect(t.of('presence')).toEqual([{ type: 'presence', visible: false }]);
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('presence')).toHaveLength(2);
  });
});
