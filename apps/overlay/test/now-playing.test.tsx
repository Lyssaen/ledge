import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { NowPlaying, NowPlayingState } from '@ledge/protocol';

/* The shell sends changes only: the hook must listen before it reads, and a read older than an event must not win. */
const bridge = vi.hoisted(() => ({
  listener: null as ((s: NowPlayingState) => void) | null,
  ready: null as (() => void) | null,
  reads: [] as Array<(s: NowPlayingState) => void>
}));
vi.mock('../src/tauri/bridge', () => ({
  onNowPlaying: (fn: (s: NowPlayingState) => void, onReady?: () => void) => { bridge.listener = fn; bridge.ready = onReady ?? null; return () => { bridge.listener = null; }; },
  nowPlaying: () => new Promise<NowPlayingState>(r => { bridge.reads.push(r); })
}));
const { useNowPlaying, PAUSED_KEEP_MS } = await import('../src/notch/useNotch');

const track = (title: string, extra: Partial<NowPlaying> = {}): NowPlaying => ({ title, artist: 'Atelier Nord', playing: true, can: { previous: true, playPause: true, next: true }, player: { id: 'Spotify.exe' }, ...extra });

beforeEach(() => { bridge.listener = null; bridge.ready = null; bridge.reads = []; });

describe('useNowPlaying', () => {
  it('reads only once the listener is in place', () => {
    renderHook(() => useNowPlaying(() => {}));
    expect(bridge.listener).not.toBeNull();
    expect(bridge.reads).toHaveLength(0);
    act(() => bridge.ready!());
    expect(bridge.reads).toHaveLength(1);
  });

  it('a change during the first read wins over that read, and the state at start wakes nothing', async () => {
    const onTrack = vi.fn();
    const { result } = renderHook(() => useNowPlaying(onTrack));
    act(() => bridge.ready!());
    act(() => bridge.listener!(track('B')));
    await act(async () => { bridge.reads[0]!(track('A')); await Promise.resolve(); });
    expect(result.current?.title).toBe('B');
    expect(onTrack).not.toHaveBeenCalled();
  });

  it('after the first read, a new track wakes the notch; play/pause and a late cover do not', async () => {
    const onTrack = vi.fn();
    const { result } = renderHook(() => useNowPlaying(onTrack));
    act(() => bridge.ready!());
    await act(async () => { bridge.reads[0]!(track('A')); await Promise.resolve(); });
    expect(result.current?.title).toBe('A');
    act(() => bridge.listener!(track('A', { playing: false })));
    act(() => bridge.listener!(track('A', { playing: false, artwork: 'data:image/png;base64,AA' })));
    expect(onTrack).not.toHaveBeenCalled();
    act(() => bridge.listener!(track('B')));
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack.mock.calls[0]![0].title).toBe('B');
  });

  it('a paused track leaves after 5 min, and comes back when it plays', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNowPlaying(() => {}));
    act(() => bridge.ready!());
    await act(async () => { bridge.reads[0]!(track('A', { playing: false })); await Promise.resolve(); });
    expect(result.current?.title).toBe('A');
    act(() => { vi.advanceTimersByTime(PAUSED_KEEP_MS); });
    expect(result.current).toBeNull();
    act(() => bridge.listener!(track('A')));
    expect(result.current?.playing).toBe(true);
    vi.useRealTimers();
  });
});
