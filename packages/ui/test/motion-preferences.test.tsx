import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createMotionPreferences, useMotionPreferences } from '../src/motionPreferences';

beforeEach(() => localStorage.clear());

describe('motion preferences per prefix', () => {
  it('the default instance keeps the island key', () => {
    const { result } = renderHook(() => useMotionPreferences());
    act(() => result.current.setReduced(true));
    expect(localStorage.getItem('ledge.reducedMotion')).toBe('true');
    expect(localStorage.getItem('desktop.reducedMotion')).toBeNull();
  });
  it('another prefix reads and writes its own key only', () => {
    localStorage.setItem('ledge.reducedMotion', 'true');
    const desktop = createMotionPreferences('desktop');
    const { result } = renderHook(() => desktop.useMotionPreferences());
    expect(result.current.app).toBe(false);
    act(() => result.current.setReduced(true));
    expect(localStorage.getItem('desktop.reducedMotion')).toBe('true');
  });
});
