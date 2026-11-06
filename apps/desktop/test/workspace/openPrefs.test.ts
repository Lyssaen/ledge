import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { loadOpenSession, saveOpenSession, useOpenSession } from '../../src/workspace/openPrefs';

beforeEach(() => { localStorage.clear(); });

describe('the « Ouvrir une session » preference', () => {
  it("is 'active' by default and for anything unreadable, « window » included", () => {
    expect(loadOpenSession()).toBe('active');
    for (const raw of ['"window"', '"x"', '1', 'null', 'not json']) { localStorage.setItem('ledge.ide.openSession', raw); expect(loadOpenSession()).toBe('active'); }
  });
  it("'right' is kept, and shared between consumers", () => {
    const a = renderHook(() => useOpenSession());
    const b = renderHook(() => useOpenSession());
    act(() => a.result.current[1]('right'));
    expect(b.result.current[0]).toBe('right');
    expect(loadOpenSession()).toBe('right');
    saveOpenSession('active');
    expect(loadOpenSession()).toBe('active');
  });
});
