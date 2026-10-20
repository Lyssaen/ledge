import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPresence } from '../../src/push/presence';
import { setup } from '../screens/setup';

const visibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
  document.dispatchEvent(new Event('visibilitychange'));
};
afterEach(() => { Reflect.deleteProperty(document, 'visibilityState'); Reflect.deleteProperty(navigator, 'clearAppBadge'); });

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
    const stop = startPresence(t.store);
    visibility('hidden');
    expect(t.of('presence')).toEqual([]);
    t.set('ready');
    expect(t.of('presence')).toEqual([{ type: 'presence', visible: false }]);
    t.set('pc_offline');
    t.set('ready');
    expect(t.of('presence')).toHaveLength(2);
    stop();
  });

  it('clears the app badge whenever the app is in front, and only then', () => {
    const clearAppBadge = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge });
    const t = setup();
    const stop = startPresence(t.store);
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    visibility('hidden');
    expect(clearAppBadge).toHaveBeenCalledTimes(1);
    visibility('visible');
    expect(clearAppBadge).toHaveBeenCalledTimes(2);
    stop();
  });

  it('works without the badge API, and when it throws or rejects', async () => {
    const t = setup();
    let stop = () => {};
    expect(() => { stop = startPresence(t.store); }).not.toThrow();
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: () => { throw new Error('no'); } });
    expect(() => visibility('visible')).not.toThrow();
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: () => Promise.reject(new Error('no')) });
    expect(() => visibility('visible')).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
    stop();
  });
});
