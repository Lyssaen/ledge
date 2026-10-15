import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { createMobileStore } from '../src/state/store';
import { loadLastState, saveLastState } from '../src/state/persist';

const s = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: '/w/x', project: 'x', title: 'Otto · x', tmuxSession: null, state: 'working', helpers: [], startedAt: '2026-10-09T18:00:00.000Z', lastActivityAt: '2026-10-09T18:00:00.000Z', source: 'launcher', ...extra } as Session);

beforeEach(() => localStorage.clear());

describe('mobile store', () => {
  it('applies snapshot, update, preview and removal', () => {
    const st = createMobileStore();
    st.apply({ type: 'snapshot', sessions: [s('a'), s('b')] });
    st.apply({ type: 'session.updated', session: s('a', { state: 'idle' }) });
    st.apply({ type: 'session.preview', id: 'a', lines: ['hi'] });
    expect(st.getState().sessions.map(x => [x.id, x.state])).toEqual([['a', 'idle'], ['b', 'working']]);
    expect(st.getState().previews).toEqual({ a: ['hi'] });
    st.apply({ type: 'session.removed', id: 'a' });
    expect(st.getState().sessions.map(x => x.id)).toEqual(['b']);
    expect(st.getState().previews).toEqual({});
    expect(st.getState().syncedAt).not.toBeNull();
  });

  it('auth.ok marks the link online and records the device and the PC', () => {
    const st = createMobileStore();
    st.apply({ type: 'auth.ok', deviceId: 'd1', deviceName: 'iPhone', pcName: 'DESKTOP' });
    expect(st.getState()).toMatchObject({ link: 'online', device: { id: 'd1', name: 'iPhone' }, pcName: 'DESKTOP' });
  });

  it('the last state survives a reload', () => {
    const st = createMobileStore();
    st.apply({ type: 'auth.ok', deviceId: 'd1', deviceName: 'iPhone', pcName: 'DESKTOP' });
    st.apply({ type: 'snapshot', sessions: [s('a')] });
    const reloaded = createMobileStore();
    expect(reloaded.getState().sessions.map(x => x.id)).toEqual(['a']);
    expect(reloaded.getState().device).toEqual({ id: 'd1', name: 'iPhone' });
    expect(loadLastState()).toMatchObject({ pcName: 'DESKTOP' });
  });

  it('saveLastState then loadLastState round-trips, and garbage reads as null', () => {
    saveLastState({ sessions: [s('a')], previews: { a: ['x'] }, syncedAt: 't', pcName: 'P' });
    expect(loadLastState()).toEqual({ turns: {}, sessions: [s('a')], previews: { a: ['x'] }, syncedAt: 't', pcName: 'P' });
    localStorage.setItem('ledge.mobile.lastState', '{nope');
    expect(loadLastState()).toBeNull();
  });
});
