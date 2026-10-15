import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineState } from '@ledge/fleet';
import { useLaunch } from '../src/launch/useLaunch';
import type { LaunchRequest } from '../src/launch/form';
import { fakeFleet, machine } from './launch-helpers';

const req: LaunchRequest = { machine: 'devbox', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const wire = { type: 'session.launch', tool: 'codex', cwd: '~/w/api', prompt: 'Run the tests' };
const both = [machine('local'), machine('devbox')];

function setup(f = fakeFleet(), machines: MachineState[] = both) {
  const launched = vi.fn();
  const hook = renderHook(({ ms }) => useLaunch(f, ms, launched), { initialProps: { ms: machines } });
  const api = () => hook.result.current;
  const start = () => act(() => { api().open(); api().launch(req); });
  return { f, launched, hook, api, start };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLaunch', () => {
  it('sends session.launch to the chosen machine only, once however often it is asked', () => {
    const { f, api, start } = setup();
    start();
    act(() => api().launch(req));
    expect(f.sent).toEqual([{ machine: 'devbox', msg: wire }]);
    expect(api().flow.stage).toBe('starting');
  });
  it('the chosen machine\'s launched closes the screen with the qualified id', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => f.emit('devbox', { type: 'session.launched', id: 'a/b' }));
    expect(launched).toHaveBeenCalledWith('devbox:a%2Fb');
    expect(api().flow.stage).toBe('closed');
  });
  it('ignores answers that are not this launch\'s', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => {
      f.emit('local', { type: 'session.launched', id: 'x' });
      f.emit('local', { type: 'error', message: 'local refused' });
      f.emit('devbox', { type: 'error', id: 'nova', message: 'reply failed' });   // a session command's error (lot 4)
      f.emit('devbox', { type: 'folder.listing', path: '/', parent: null, entries: [] });
      f.emit('devbox', { type: 'folder.listing', path: '/x', parent: '/', entries: [], error: 'no such folder' });   // a folder failure arrives as a listing, never as an id-less error
    });
    expect(launched).not.toHaveBeenCalled();
    expect(api().flow.stage).toBe('starting');
  });
  it('a daemon error fails with its message; Retry sends the identical request', () => {
    const { f, api, start } = setup();
    start();
    act(() => f.emit('devbox', { type: 'error', message: 'no such folder: ~/w/api' }));
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'daemon', message: 'no such folder: ~/w/api' } });
    act(() => api().retry());
    expect(f.sent).toEqual([{ machine: 'devbox', msg: wire }, { machine: 'devbox', msg: wire }]);
    expect(api().flow.stage).toBe('starting');
  });
  it('fails after exactly 15 s without an answer, and a late launched never passes for the retry\'s', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => vi.advanceTimersByTime(14_999));
    expect(api().flow.stage).toBe('starting');
    act(() => vi.advanceTimersByTime(1));
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'timeout' } });
    act(() => api().retry());
    act(() => f.emit('devbox', { type: 'session.launched', id: 'first' }));
    expect(launched).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(api().flow.stage).toBe('starting');   // the retry has its own 15 s
    act(() => f.emit('devbox', { type: 'session.launched', id: 'second' }));
    expect(launched).toHaveBeenCalledWith('devbox:second');
  });
  it('Cancel closes the screen and ignores the late launched; the next launch gets its own', () => {
    const { f, api, launched, start } = setup();
    start();
    act(() => api().close());
    expect(api().flow.stage).toBe('closed');
    act(() => f.emit('devbox', { type: 'session.launched', id: 'late' }));
    expect(launched).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(20_000));
    expect(api().flow.stage).toBe('closed');   // no timeout fires on a closed screen
    start();
    act(() => f.emit('devbox', { type: 'session.launched', id: 'next' }));
    expect(launched).toHaveBeenCalledWith('devbox:next');
  });
  it('a machine that refuses the send fails at once as offline, with no timer left', () => {
    const { f, api, start } = setup(fakeFleet(['devbox']));
    start();
    expect(f.sent).toEqual([]);
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'offline' } });
    act(() => vi.advanceTimersByTime(20_000));
    expect(api().flow.error).toEqual({ kind: 'offline' });
  });
  it('a machine lost during the start fails at once, and what it owed is forgotten', () => {
    const { f, api, launched, hook, start } = setup();
    start();
    hook.rerender({ ms: [machine('local'), machine('devbox', { ready: false, status: 'connecting' })] });
    expect(api().flow).toMatchObject({ stage: 'failed', error: { kind: 'lost' } });
    hook.rerender({ ms: both });
    act(() => api().retry());
    act(() => f.emit('devbox', { type: 'session.launched', id: 'ari' }));
    expect(launched).toHaveBeenCalledWith('devbox:ari');
  });
  it('stops listening and clears its timer when unmounted', () => {
    const { f, hook, start } = setup();
    start();
    hook.unmount();
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
