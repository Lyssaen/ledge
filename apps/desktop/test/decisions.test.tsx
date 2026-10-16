import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type React from 'react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { useDecisions } from '../src/fleet/decisions';
import { LangProvider } from '../src/i18n/lang';

afterEach(() => cleanup());

const otto = fakeSession('local:otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
type P = Parameters<typeof useDecisions>[0];
const wrapper = ({ children }: { children: React.ReactNode }) => <LangProvider lang="en">{children}</LangProvider>;
const setup = (over: Partial<P> = {}) => {
  const props: P = { client: { send: vi.fn() }, sessions: [otto], lastError: null, notify: vi.fn(), ...over };
  const hook = renderHook((p: P) => useDecisions(p), { initialProps: props, wrapper });
  return { ...hook, props };
};

describe('useDecisions', () => {
  it('one decision per request, even clicked twice; it lands when the request changes', () => {
    const { result, rerender, props } = setup();
    act(() => { expect(result.current.decide(otto, 'accept')).toBe(true); });
    act(() => { expect(result.current.decide(otto, 'deny')).toBe(false); });
    expect(props.client.send).toHaveBeenCalledTimes(1);
    expect(props.client.send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept' });
    expect(result.current.busy('local:otto')).toBe(true);
    rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }] });
    expect(result.current.busy('local:otto')).toBe(false);
    expect(result.current.landed).toBe('local:otto');
    expect(props.notify).not.toHaveBeenCalled();
  });
  it('two decisions in the same frame still send once', () => {
    const { result, props } = setup();
    act(() => {
      expect(result.current.decide(otto, 'accept')).toBe(true);
      expect(result.current.decide(otto, 'accept')).toBe(false);
    });
    expect(props.client.send).toHaveBeenCalledTimes(1);
  });
  it('the flash lasts 1.8 s', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender, props } = setup();
      act(() => { result.current.decide(otto, 'accept'); });
      rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }] });
      expect(result.current.landed).toBe('local:otto');
      act(() => { vi.advanceTimersByTime(1799); });
      expect(result.current.landed).toBe('local:otto');
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.landed).toBeNull();
      // Landed: the 8 s notice never comes.
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(props.notify).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('a session that goes away is forgotten without a word; an offline one is not taken for landed', () => {
    const { result, rerender, props } = setup();
    act(() => { result.current.decide(otto, 'accept'); });
    rerender({ ...props, sessions: [{ ...otto, offline: true, pending: undefined }] });
    expect(result.current.busy('local:otto')).toBe(true);
    expect(result.current.landed).toBeNull();
    rerender({ ...props, sessions: [] });
    expect(result.current.busy('local:otto')).toBe(false);
    expect(result.current.landed).toBeNull();
    expect(props.notify).not.toHaveBeenCalled();
  });
  it('an error for that session after the send frees it and says why; an older or another one does not', () => {
    const { result, rerender, props } = setup({ lastError: { id: 'local:otto', message: 'old', seq: 1 } });
    act(() => { result.current.decide(otto, 'deny'); });
    rerender({ ...props, lastError: { id: 'local:nova', message: 'other', seq: 2 } });
    expect(result.current.busy('local:otto')).toBe(true);
    rerender({ ...props, lastError: { id: 'local:otto', message: 'Dev SSH is offline', seq: 3 } });
    expect(result.current.busy('local:otto')).toBe(false);
    expect(props.notify).toHaveBeenCalledWith('Could not send the decision to Otto: Dev SSH is offline');
    // Free again: a new decision goes.
    act(() => { expect(result.current.decide(otto, 'accept')).toBe(true); });
    expect(props.client.send).toHaveBeenCalledTimes(2);
  });
  it('never for an offline, read-only or question session, nor without a request', () => {
    const { result, props } = setup();
    for (const s of [{ ...otto, offline: true }, { ...otto, source: 'hook_only' as const }, { ...otto, state: 'waiting_input' as const, pending: { kind: 'question' as const, text: 'Port?', source: 'hook' as const } }, { ...otto, pending: undefined }])
      act(() => { expect(result.current.decide(s, 'accept')).toBe(false); });
    expect(props.client.send).not.toHaveBeenCalled();
  });
  it('a decision nobody confirms within 8 s comes back with a notice', () => {
    vi.useFakeTimers();
    try {
      const { result, props } = setup();
      act(() => { result.current.decide(otto, 'accept'); });
      act(() => { vi.advanceTimersByTime(7999); });
      expect(result.current.busy('local:otto')).toBe(true);
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.busy('local:otto')).toBe(false);
      expect(props.notify).toHaveBeenCalledWith('Ledge did not see the decision for Otto land. Open the session to check.');
    } finally { vi.useRealTimers(); }
  });
});
