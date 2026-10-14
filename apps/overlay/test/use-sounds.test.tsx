import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { DaemonStatus } from '@ledge/client';
import { useSounds } from '../src/sounds/useSounds';
import { DEFAULT_SOUNDS, VOLUME_GAIN, resetSoundPrefsForTests } from '../src/sounds/preferences';

describe('useSounds().test', () => {
  beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); });
  it('plays the question cue at the current volume, even with the switch off and DND on', () => {
    localStorage.setItem('ledge.sounds', JSON.stringify({ ...DEFAULT_SOUNDS, enabled: false, volume: 'loud' })); resetSoundPrefsForTests();
    const played: Array<[string, number]> = [];
    const player = { play: (c: string, g: number) => { played.push([c, g]); } };
    const { result } = renderHook(() => useSounds({ player: player as never, dnd: true, status: 'open' }));
    result.current.test();
    expect(played).toEqual([['question', VOLUME_GAIN.loud]]);
  });
});

describe('useSounds: daemon lost', () => {
  beforeEach(() => { localStorage.clear(); resetSoundPrefsForTests(); });
  const flush = () => new Promise(r => setTimeout(r, 0));
  it('plays the error cue once per outage: open -> unreachable, never on retries, silent on reconnect', async () => {
    const played: Array<[string, number]> = [];
    const player = { play: (c: string, g: number) => { played.push([c, g]); } };
    const { rerender } = renderHook(({ status }: { status: DaemonStatus }) => useSounds({ player: player as never, dnd: false, status, terminalInFront: async () => false }), { initialProps: { status: 'connecting' as DaemonStatus } });
    rerender({ status: 'unreachable' }); await flush();
    expect(played).toEqual([]);                       // never connected: no outage
    rerender({ status: 'open' }); await flush();
    rerender({ status: 'unreachable' });
    await waitFor(() => expect(played).toEqual([['error', 1]]));
    rerender({ status: 'connecting' }); await flush();
    rerender({ status: 'unreachable' }); await flush();
    expect(played).toEqual([['error', 1]]);
    rerender({ status: 'open' }); await flush();
    expect(played).toEqual([['error', 1]]);
  });
});
