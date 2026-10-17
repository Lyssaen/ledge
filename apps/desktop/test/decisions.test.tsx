import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type React from 'react';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { UNCONFIRMED_MS, useDecisions } from '../src/fleet/decisions';
import { LangProvider } from '../src/i18n/lang';

afterEach(() => cleanup());

const otto = fakeSession('local:otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } });
type P = Parameters<typeof useDecisions>[0];
const wrapper = ({ children }: { children: React.ReactNode }) => <LangProvider lang="en">{children}</LangProvider>;
const setup = (over: Partial<P> = {}) => {
  const props: P = { client: { send: vi.fn() }, sessions: [otto], errors: [], notify: vi.fn(), ...over };
  const hook = renderHook((p: P) => useDecisions(p), { initialProps: props, wrapper });
  return { ...hook, props };
};

describe('useDecisions', () => {
  it('one decision per request, even clicked twice; it lands when the request changes', () => {
    const { result, rerender, props } = setup();
    act(() => { expect(result.current.decide(otto, 'accept')).toBe(true); });
    act(() => { expect(result.current.decide(otto, 'deny')).toBe(false); });
    expect(props.client.send).toHaveBeenCalledTimes(1);
    // The request the user saw goes with it: the daemon refuses it if another one is pending by then.
    expect(props.client.send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'accept', expect: { kind: 'permission', text: 'npm test' } });
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
    const { result, rerender, props } = setup({ errors: [{ id: 'local:otto', message: 'old', seq: 1, request: 'session.decide' }] });
    act(() => { result.current.decide(otto, 'deny'); });
    rerender({ ...props, errors: [{ id: 'local:nova', message: 'other', seq: 2, request: 'session.decide' }] });
    expect(result.current.busy('local:otto')).toBe(true);
    rerender({ ...props, errors: [{ id: 'local:otto', message: 'Dev SSH is offline', seq: 3, request: 'session.decide' }] });
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
  it('an error without its request (an older daemon) is not taken for a refusal: the send waits for its 8 s', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender, props } = setup();
      act(() => { result.current.decide(otto, 'accept'); });
      rerender({ ...props, errors: [{ id: 'local:otto', message: 'nothing to decide', seq: 1 }] });
      expect(result.current.busy('local:otto')).toBe(true);
      expect(props.notify).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS); });
      expect(result.current.busy('local:otto')).toBe(false);
      expect(props.notify).toHaveBeenCalledWith('Ledge did not see the decision for Otto land. Open the session to check.');
    } finally { vi.useRealTimers(); }
  });
  it('a reply nobody confirms within 8 s comes back with its own notice', () => {
    vi.useFakeTimers();
    try {
      const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
      const { result, props } = setup({ sessions: [bix] });
      act(() => { result.current.reply(bix, 'Go on'); });
      act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS - 1); });
      expect(result.current.busy('local:bix')).toBe(true);
      act(() => { vi.advanceTimersByTime(1); });
      expect(result.current.busy('local:bix')).toBe(false);
      expect(props.notify).toHaveBeenCalledWith('Ledge did not see the reply to Bix land. Check the thread.');
    } finally { vi.useRealTimers(); }
  });
  it('a refusal answers its own request: a refused reply is not blamed on the decision in flight', () => {
    const { result, rerender, props } = setup();
    act(() => { result.current.decide(otto, 'accept'); });
    const replyRefused = { id: 'local:otto', message: 'empty reply', seq: 1, request: 'session.reply' };
    rerender({ ...props, errors: [replyRefused] });
    expect(result.current.busy('local:otto')).toBe(true);
    expect(props.notify).not.toHaveBeenCalled();
    rerender({ ...props, errors: [replyRefused, { id: 'local:otto', message: 'nothing to decide', seq: 2, request: 'session.decide' }] });
    expect(result.current.busy('local:otto')).toBe(false);
    expect(props.notify).toHaveBeenCalledWith('Could not send the decision to Otto: nothing to decide');
  });
  it('two refusals in one batch are both said', () => {
    const nova = fakeSession('local:nova', { name: 'Nova', state: 'waiting_permission', pending: { kind: 'permission', text: 'rm -rf dist', source: 'hook' } });
    const { result, rerender, props } = setup({ sessions: [otto, nova] });
    act(() => { result.current.decide(otto, 'accept'); result.current.decide(nova, 'deny'); });
    rerender({ ...props, errors: [{ id: 'local:otto', message: 'a', seq: 1, request: 'session.decide' }, { id: 'local:nova', message: 'b', seq: 2, request: 'session.decide' }] });
    expect((props.notify as ReturnType<typeof vi.fn>).mock.calls).toEqual([['Could not send the decision to Otto: a'], ['Could not send the decision to Nova: b']]);
    expect([result.current.busy('local:otto'), result.current.busy('local:nova')]).toEqual([false, false]);
  });
  it('always and a note travel with the decision; what the harness does not offer is never sent', () => {
    const { result, props } = setup({ sessions: [otto] });
    act(() => { expect(result.current.decide(otto, 'accept', 'why')).toBe(false); });
    act(() => { expect(result.current.decide({ ...otto, tool: 'cursor' }, 'always')).toBe(false); });
    act(() => { expect(result.current.decide(otto, 'deny', 'Use pnpm')).toBe(true); });
    expect(props.client.send).toHaveBeenCalledWith({ type: 'session.decide', id: 'local:otto', decision: 'deny', note: 'Use pnpm', expect: { kind: 'permission', text: 'npm test' } });
    expect(props.client.send).toHaveBeenCalledTimes(1);
  });
  it('a reply lands when the session moves; refused, its text comes back', () => {
    const bix = fakeSession('local:bix', { name: 'Bix', state: 'idle' });
    const onRefused = vi.fn();
    const { result, rerender, props } = setup({ sessions: [bix] });
    act(() => { expect(result.current.reply(otto, 'x')).toBe(false); });           // a permission waits for its buttons
    act(() => { expect(result.current.reply(bix, '   ')).toBe(false); });
    act(() => { expect(result.current.reply(bix, 'Go on', onRefused)).toBe(true); });
    act(() => { expect(result.current.reply(bix, 'again')).toBe(false); });
    expect(props.client.send).toHaveBeenCalledWith({ type: 'session.reply', id: 'local:bix', text: 'Go on' });
    rerender({ ...props, sessions: [bix], errors: [{ id: 'local:bix', message: 'the terminal did not take it', seq: 1, request: 'session.reply' }] });
    expect(props.notify).toHaveBeenCalledWith('Could not send the reply to Bix: the terminal did not take it');
    expect(onRefused).toHaveBeenCalledWith('Go on');
    act(() => { result.current.reply(bix, 'Go on'); });
    rerender({ ...props, sessions: [{ ...bix, state: 'working', lastActivityAt: '2026-10-09T18:01:00.000Z' }], errors: [] });
    expect(result.current.busy('local:bix')).toBe(false);
    expect(props.notify).toHaveBeenCalledTimes(1);
  });
  it('a reply that lands is still answered by a refusal that comes late (a working session moves at once)', () => {
    vi.useFakeTimers();
    try {
      const nova = fakeSession('local:nova', { name: 'Nova', state: 'working' });
      const onRefused = vi.fn();
      const { result, rerender, props } = setup({ sessions: [nova] });
      act(() => { expect(result.current.reply(nova, 'Go on', onRefused)).toBe(true); });
      // InjectFailed reaches the store before the refusal: the session moves, the reply looks landed.
      rerender({ ...props, sessions: [{ ...nova, state: 'error', lastActivityAt: '2026-10-09T18:01:00.000Z' }] });
      expect(result.current.busy('local:nova')).toBe(false);
      rerender({ ...props, sessions: [{ ...nova, state: 'error' }], errors: [{ id: 'local:nova', message: 'the terminal did not take it', seq: 1, request: 'session.reply' }] });
      expect(props.notify).toHaveBeenCalledWith('Could not send the reply to Nova: the terminal did not take it');
      expect(onRefused).toHaveBeenCalledWith('Go on');
      // Once the window has passed, a refusal is no longer this reply's.
      act(() => { result.current.reply(nova, 'Again', onRefused); });
      rerender({ ...props, sessions: [{ ...nova, lastActivityAt: '2026-10-09T18:02:00.000Z' }], errors: [{ id: 'local:nova', message: 'the terminal did not take it', seq: 1, request: 'session.reply' }] });
      act(() => { vi.advanceTimersByTime(UNCONFIRMED_MS); });
      rerender({ ...props, sessions: [{ ...nova, lastActivityAt: '2026-10-09T18:02:00.000Z' }], errors: [{ id: 'local:nova', message: 'late', seq: 2, request: 'session.reply' }] });
      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(props.notify).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('a decision sent meanwhile does not take the landed reply\'s late refusal away', () => {
    const nova = fakeSession('local:nova', { name: 'Nova', state: 'working' });
    const onRefused = vi.fn();
    const { result, rerender, props } = setup({ sessions: [nova] });
    act(() => { expect(result.current.reply(nova, 'Go on', onRefused)).toBe(true); });
    const asking = { ...nova, state: 'waiting_permission' as const, lastActivityAt: '2026-10-09T18:01:00.000Z', pending: { kind: 'permission' as const, text: 'npm test', source: 'hook' as const } };
    rerender({ ...props, sessions: [asking] });                                     // the reply looks landed
    expect(result.current.busy('local:nova')).toBe(false);
    act(() => { expect(result.current.decide(asking, 'accept')).toBe(true); });
    rerender({ ...props, sessions: [asking], errors: [{ id: 'local:nova', message: 'the terminal did not take it', seq: 1, request: 'session.reply' }] });
    expect(props.notify).toHaveBeenCalledWith('Could not send the reply to Nova: the terminal did not take it');
    expect(onRefused).toHaveBeenCalledWith('Go on');
    expect(result.current.busy('local:nova')).toBe(true);                         // the decision still waits for its own answer
  });
  it('a deny whose note could not be typed says so and gives the note back, even once the request is gone', () => {
    const onRefused = vi.fn();
    const { result, rerender, props } = setup();
    act(() => { expect(result.current.decide(otto, 'deny', 'Use pnpm', onRefused)).toBe(true); });
    // The daemon applies the deny (the request goes) before it sends the refusal.
    rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }] });
    expect(result.current.landed).toBe('local:otto');
    rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }], errors: [{ id: 'local:otto', message: 'denied, but the note could not be typed', seq: 1, request: 'session.decide', code: 'note_not_typed' }] });
    expect(props.notify).toHaveBeenCalledWith('Refused, but the note could not be typed.');
    expect(onRefused).toHaveBeenCalledWith('Use pnpm');
  });
  it('a landed deny with a note hears only that code: another late refusal neither says it nor gives the note back', () => {
    const onRefused = vi.fn();
    const { result, rerender, props } = setup();
    act(() => { result.current.decide(otto, 'deny', 'Use pnpm', onRefused); });
    const gone = [{ ...otto, state: 'working' as const, pending: undefined }];
    rerender({ ...props, sessions: gone });
    rerender({ ...props, sessions: gone, errors: [{ id: 'local:otto', message: 'late', seq: 1, request: 'session.decide' }] });
    expect(props.notify).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
  });
  it('a plain decision that landed hears no late refusal', () => {
    const { result, rerender, props } = setup();
    act(() => { result.current.decide(otto, 'deny'); });
    rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }] });
    rerender({ ...props, sessions: [{ ...otto, state: 'working', pending: undefined }], errors: [{ id: 'local:otto', message: 'late', seq: 1, request: 'session.decide' }] });
    expect(props.notify).not.toHaveBeenCalled();
  });
  it('a refused note comes back like a refused reply', () => {
    const onRefused = vi.fn();
    const { result, rerender, props } = setup();
    act(() => { expect(result.current.decide(otto, 'deny', 'Use pnpm', onRefused)).toBe(true); });
    rerender({ ...props, errors: [{ id: 'local:otto', message: 'no prompt', seq: 1, request: 'session.decide' }] });
    expect(props.notify).toHaveBeenCalledWith('Could not send the decision to Otto: no prompt');
    expect(onRefused).toHaveBeenCalledWith('Use pnpm');
  });
});
