import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_PAUSED_MS, type NowPlaying } from '@ledge/protocol';
import type * as NotchBridge from '../src/tauri/bridge';
import { musicShown, useNowPlaying } from '../src/music/nowPlaying';

const watch = vi.hoisted(() => vi.fn());
const control = vi.hoisted(() => vi.fn(async () => {}));
const nowFn = vi.hoisted(() => vi.fn(async () => null as NowPlaying | null));

vi.mock('../src/tauri/bridge', async () => {
  const actual = await vi.importActual<typeof NotchBridge>('../src/tauri/bridge');
  return { ...actual, mediaWatch: watch, mediaControl: control, mediaNow: nowFn };
});

const NOW: NowPlaying = { title: 'Quai 9', artist: 'Mira Volant', playing: true, cover: null, canPrev: true, canNext: true, source: 'Chrome' };
const on = { enabled: true, hover: 'controls', paused: '5min' } as const;
const post = (detail: unknown) => window.dispatchEvent(new CustomEvent('ledge:media', { detail }));

afterEach(() => { vi.useRealTimers(); watch.mockReset(); control.mockReset(); nowFn.mockReset(); nowFn.mockResolvedValue(null); });

describe('musicShown', () => {
  it('off shows nothing', () => expect(musicShown({ prefs: { ...on, enabled: false }, now: NOW, pausedSince: null, at: 0 })).toBe(false));
  it('nothing playing shows nothing', () => expect(musicShown({ prefs: on, now: null, pausedSince: null, at: 0 })).toBe(false));
  it('playing shows', () => expect(musicShown({ prefs: on, now: NOW, pausedSince: null, at: 0 })).toBe(true));
  it('paused 5min: shown until 300 000 ms, gone at 300 000', () => {
    const p = { ...NOW, playing: false };
    expect(musicShown({ prefs: on, now: p, pausedSince: 0, at: 299_999 })).toBe(true);
    expect(musicShown({ prefs: on, now: p, pausedSince: 0, at: 300_000 })).toBe(false);
  });
  it('paused always stays', () => expect(musicShown({ prefs: { ...on, paused: 'always' }, now: { ...NOW, playing: false }, pausedSince: 0, at: 9e9 })).toBe(true));
  it('paused hide goes at once', () => expect(musicShown({ prefs: { ...on, paused: 'hide' }, now: { ...NOW, playing: false }, pausedSince: 0, at: 0 })).toBe(false));
});

describe('useNowPlaying', () => {
  it('resuming before 5 min resets the countdown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { result } = renderHook(() => useNowPlaying(on, true));
    await act(async () => { post({ ...NOW, playing: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); post(NOW); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); post({ ...NOW, playing: false }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(MUSIC_PAUSED_MS - 1_000); });
    expect(result.current.shown).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.shown).toBe(false);
  });

  it('a vanished session hides the slot', async () => {
    const { result } = renderHook(() => useNowPlaying(on, true));
    await act(async () => { post(NOW); });
    expect(result.current.shown).toBe(true);
    await act(async () => { post(null); });
    expect(result.current.now).toBeNull();
    expect(result.current.shown).toBe(false);
  });

  it('watch follows the setting', () => {
    const { rerender, unmount } = renderHook(({ enabled, active }) => useNowPlaying({ ...on, enabled }, active), { initialProps: { enabled: true, active: true } });
    expect(watch).toHaveBeenCalledWith(true);
    rerender({ enabled: false, active: true });
    expect(watch).toHaveBeenLastCalledWith(false);
    watch.mockClear();
    unmount();
    expect(watch).toHaveBeenCalledWith(false);
  });

  it('a refused control is swallowed', async () => {
    control.mockRejectedValueOnce(new Error('no'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useNowPlaying(on, true));
    await act(async () => { result.current.control('next'); });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an invalid payload counts as nothing playing', async () => {
    const { result } = renderHook(() => useNowPlaying(on, true));
    await act(async () => { post(NOW); });
    await act(async () => { post({ title: 1 }); });
    expect(result.current.now).toBeNull();
    expect(result.current.shown).toBe(false);
  });
});
