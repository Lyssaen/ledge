import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { mobileStore } from '../src/state/store';
import { useEnableNotifications } from '../src/push/useEnable';

describe('useEnableNotifications refusal window', () => {
  beforeEach(() => {
    mobileStore.setSender(() => {});
    mobileStore.apply({ type: 'auth.ok', deviceId: 'd', deviceName: 'T', pcName: 'PC', vapidPublicKey: 'K' });
  });
  const run = async (enable: never, ms = 60) => {
    const { result } = renderHook(() => useEnableNotifications(enable, ms));
    let r: unknown;
    await act(async () => { r = await result.current.start(); });
    return r;
  };

  it('starts counting when the subscription is sent, not at the tap: a slow permission prompt does not eat it', async () => {
    const enable = vi.fn(async (o: { send(m: unknown): boolean }) => {
      await new Promise(r => setTimeout(r, 120)); // the permission prompt
      o.send({ type: 'push.subscribe' });
      setTimeout(() => mobileStore.apply({ type: 'error', message: 'unsupported push service' }), 20);
      return 'granted';
    });
    expect(await run(enable as never)).toBe('failed');
  });
  it('an error that is not about push is not a refusal', async () => {
    const enable = vi.fn(async (o: { send(m: unknown): boolean }) => {
      o.send({ type: 'push.subscribe' });
      setTimeout(() => mobileStore.apply({ type: 'error', id: 's', message: 'unknown session' }), 10);
      return 'granted';
    });
    expect(await run(enable as never)).toBe('granted');
  });
  it('a refusal arriving after the window is not counted', async () => {
    const enable = vi.fn(async (o: { send(m: unknown): boolean }) => {
      o.send({ type: 'push.subscribe' });
      setTimeout(() => mobileStore.apply({ type: 'error', message: 'unsupported push service' }), 150);
      return 'granted';
    });
    expect(await run(enable as never)).toBe('granted');
  });
});
