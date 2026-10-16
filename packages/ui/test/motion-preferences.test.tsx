import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, renderHook, act, cleanup } from '@testing-library/react';
import { createMotionPreferences, setDefaultMotionPreferences } from '../src/motionPreferences';
import { Bot } from '../src/bots/Bot';

const { useMotionPreferences } = createMotionPreferences('ledge');

beforeEach(() => localStorage.clear());

describe('the default store the mascots read', () => {
  it('follows the registered store and ignores the island key', () => {
    vi.stubEnv('VITE_LEDGE_MOTION', '1');
    localStorage.setItem('ledge.reducedMotion', 'true');
    localStorage.setItem('desktop.reducedMotion', 'false');
    setDefaultMotionPreferences(createMotionPreferences('desktop').useMotionPreferences);
    const props = { tool: 'claude', state: 'working', pose: 1, size: 48, theme: 'dark', seed: 'a' } as const;
    expect(render(<Bot {...props} />).container.querySelector('svg')).toHaveAttribute('data-reduced', 'false');
    cleanup(); localStorage.setItem('desktop.reducedMotion', 'true');
    setDefaultMotionPreferences(createMotionPreferences('desktop').useMotionPreferences);
    expect(render(<Bot {...props} />).container.querySelector('svg')).toHaveAttribute('data-reduced', 'true');
    vi.unstubAllEnvs();
  });
});

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
