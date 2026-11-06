import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, screen } from '@testing-library/react';
import { loadSettings } from '../../src/settings/lazy';
import { loadChat } from '../../src/chat/lazy';
import { loadIdeEnabled, saveIdeEnabled, useIdeEnabled } from '../../src/workspace/prefs';
import { boot, closeDaemons, recordToasts, savedNotices, TWO_PROJECTS } from '../helpers';

let log: string[] = [];
beforeEach(async () => { log = recordToasts(); localStorage.clear(); saveIdeEnabled(false); await loadChat(); });
afterEach(async () => { await closeDaemons(); });

describe('the IDE preference', () => {
  it('is off by default, and any non-boolean reads as off', () => {
    localStorage.clear();
    expect(loadIdeEnabled()).toBe(false);
    for (const raw of ['"yes"', '1', 'null', '{}', 'not json']) { localStorage.setItem('ledge.ide.enabled', raw); expect(loadIdeEnabled()).toBe(false); }
    localStorage.setItem('ledge.ide.enabled', 'true');
    expect(loadIdeEnabled()).toBe(true);
  });

  it('useIdeEnabled: setting it in one consumer re-renders the others', () => {
    const a = renderHook(() => useIdeEnabled());
    const b = renderHook(() => useIdeEnabled());
    expect(a.result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(true);
    expect(loadIdeEnabled()).toBe(true);
  });
});

describe('Settings › General: the IDE interface switch', () => {
  it('toggles the preference and says so through « Setting saved »', async () => {
    await loadSettings();
    const env = await boot({ projects: TWO_PROJECTS, machines: [{ id: 'local', label: 'Local' }] });
    await env.user.keyboard('{Control>},{/Control}');
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const sw = screen.getByRole('switch', { name: 'IDE interface (preview)' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription(expect.stringContaining('Tab groups, panels and an activity bar'));
    await env.user.click(sw);
    expect(loadIdeEnabled()).toBe(true);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(savedNotices(log)).toEqual(['Setting saved · IDE interface (preview)']);
    await env.user.click(sw);
    expect(loadIdeEnabled()).toBe(false);
    expect(savedNotices(log).at(-1)).toBe('Setting saved · IDE interface (preview) off');
  });
});
