import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDelayed } from '../src/surface/useDelayed';

describe('useDelayed', () => {
  afterEach(() => vi.useRealTimers());
  it('turns on only after the delay and off at once', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDelayed(v, 500), { initialProps: { v: true } });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ v: false });
    expect(result.current).toBe(false);
    rerender({ v: true });
    act(() => { vi.advanceTimersByTime(200); });
    rerender({ v: false });
    rerender({ v: true });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(false); // the delay restarted on the interruption
  });
});
