import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWake, WAKE_AFTER_HIDDEN_MS } from '../../src/link/wake';
import { fakeLink } from '../state/helpers';

const visibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
  document.dispatchEvent(new Event('visibilitychange'));
};
const pageshow = (persisted: boolean) => {
  const e = new Event('pageshow');
  Object.defineProperty(e, 'persisted', { value: persisted });
  window.dispatchEvent(e);
};
const resumes = (t: ReturnType<typeof fakeLink>) => t.calls.filter((c) => c === 'resume').length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(document, 'visibilityState'); });

describe('startWake', () => {
  it('resumes the link once visible again after being hidden long enough, not after a glance away', () => {
    const t = fakeLink();
    const stop = startWake(t.link);
    visibility('hidden');
    vi.advanceTimersByTime(WAKE_AFTER_HIDDEN_MS - 1);
    visibility('visible');
    expect(resumes(t)).toBe(0);
    visibility('hidden');
    vi.advanceTimersByTime(WAKE_AFTER_HIDDEN_MS);
    visibility('visible');
    expect(resumes(t)).toBe(1);
    stop();
  });

  it('resumes after any time hidden when the PC is not reached', () => {
    const t = fakeLink('pc_offline');
    t.setReach('relay_unreachable');
    const stop = startWake(t.link);
    visibility('hidden');
    visibility('visible');
    expect(resumes(t)).toBe(1);
    stop();
  });

  it('resumes on a page back from the back-forward cache, and when the network is back', () => {
    const t = fakeLink();
    const stop = startWake(t.link);
    pageshow(false);
    expect(resumes(t)).toBe(0);
    pageshow(true);
    window.dispatchEvent(new Event('online'));
    expect(resumes(t)).toBe(2);
    stop();
  });

  it('listens no more once stopped', () => {
    const t = fakeLink('pc_offline');
    t.setReach('relay_unreachable');
    startWake(t.link)();
    visibility('hidden');
    visibility('visible');
    pageshow(true);
    window.dispatchEvent(new Event('online'));
    expect(resumes(t)).toBe(0);
  });
});
