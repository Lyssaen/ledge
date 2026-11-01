import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DaemonStatus, MachineState } from '@ledge/fleet';
import type { Session, Task } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { TOAST_WINDOW_MS, useAlerts, type AlertDeps } from '../src/notify/useAlerts';
import { resetDndForTests, resetSoundPrefsForTests, setDnd, setNotifyMode, setSounds } from '../src/notify/prefs';
import { machine } from './fleet-helpers';

type Props = { sessions: Session[]; machines: MachineState[]; status: DaemonStatus; daemonUpdating?: boolean; tasks?: Task[] };
const ask = (id: string, name: string, state: Session['state'] = 'waiting_permission') => fakeSession(id, { name, state, ...(state.startsWith('waiting') ? { pending: { kind: state === 'waiting_input' ? 'question' : 'permission', source: 'hook', text: `${name} asks` } } : {}) });
let now = 100_000;
function setup(focused = false) {
  const deps = { player: { play: vi.fn() }, toast: vi.fn(), terminalInFront: vi.fn(async () => false), focused: vi.fn(() => focused), now: () => now } satisfies AlertDeps;
  const local = machine('local');
  const h = renderHook((p: Props) => useAlerts(p, deps), { initialProps: { sessions: [], machines: [machine('local', { status: 'connecting', ready: false })], status: 'connecting' } });
  return { deps, local, h };
}

beforeEach(() => {
  localStorage.clear(); resetSoundPrefsForTests(); resetDndForTests();
  setSounds({ enabled: true });
  now += 60_000;
});

describe('the first look is quiet (Review Focus 1)', () => {
  it('sessions already waiting at start-up make no toast and no sound', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [ask('local:a', 'Otto'), ask('local:b', 'Nova')], machines: [local], status: 'open' });
    h.rerender({ sessions: [ask('local:a', 'Otto'), ask('local:b', 'Nova')], machines: [local], status: 'open' });
    await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });

  it('a remote machine connecting, or back from offline, brings its asks silently', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [], machines: [local, machine('devbox', { status: 'connecting', ready: false })], status: 'open' });
    h.rerender({ sessions: [ask('devbox:x', 'Rio')], machines: [local, machine('devbox')], status: 'open' });
    h.rerender({ sessions: [{ ...fakeSession('devbox:x', { name: 'Rio' }), offline: true }], machines: [local, machine('devbox', { status: 'unreachable', ready: false })], status: 'open' });
    h.rerender({ sessions: [ask('devbox:x', 'Rio', 'waiting_input')], machines: [local, machine('devbox')], status: 'open' });
    await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });

  it('five asks at once: one grouped toast and one sound', async () => {
    const { deps, local, h } = setup();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    h.rerender({ sessions: ids.map(i => fakeSession(`local:${i}`)), machines: [local], status: 'open' });
    h.rerender({ sessions: ids.map(i => ask(`local:${i}`, i)), machines: [local], status: 'open' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledTimes(1));
    expect(deps.player.play).toHaveBeenCalledWith('approval', 1);
    await vi.waitFor(() => expect(deps.toast).toHaveBeenCalledWith('Your team', '5 sessions need you or have finished'), { timeout: 3000 });
    expect(deps.toast).toHaveBeenCalledTimes(1);
  });
});

describe('a new ask', () => {
  function asked(focused = false) {
    const s = setup(focused);
    s.h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [s.local], status: 'open' });
    s.h.rerender({ sessions: [ask('local:a', 'Otto')], machines: [s.local], status: 'open' });
    return s;
  }
  it('makes a toast while the window is behind or hidden', async () => {
    const { deps } = asked();
    await vi.waitFor(() => expect(deps.toast).toHaveBeenCalledWith('Otto needs your approval', 'Otto asks'), { timeout: 3000 });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('approval', 1));
  });
  it('makes no toast while Desktop has the focus', () => {
    expect(asked(true).deps.toast).not.toHaveBeenCalled();
  });
  it('Do not disturb cuts toasts and sounds', async () => {
    setDnd(true);
    const { deps } = asked();
    await Promise.resolve(); await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });
  it('« only when the terminal is behind »: no sound for the session whose screen Ledge shows', async () => {
    const s = setup();
    setSounds({ onlyWhenTerminalBehind: true });
    const watching = vi.fn(() => 'local:a');
    const deps = { ...s.deps, watching };
    const h = renderHook((p: Props) => useAlerts(p, deps), { initialProps: { sessions: [fakeSession('local:a', { name: 'Otto' }), fakeSession('local:b', { name: 'Nova' })], machines: [s.local], status: 'open' } as Props });
    h.rerender({ sessions: [ask('local:a', 'Otto'), fakeSession('local:b', { name: 'Nova' })], machines: [s.local], status: 'open' });
    await new Promise(r => setTimeout(r, 20));
    expect(deps.player.play).not.toHaveBeenCalled();
    h.rerender({ sessions: [ask('local:a', 'Otto'), ask('local:b', 'Nova')], machines: [s.local], status: 'open' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledTimes(1));
    expect(watching).toHaveBeenCalled();
  });
  it('the setting off, or another tab, still plays', async () => {
    const off = setup();
    setSounds({ onlyWhenTerminalBehind: false });
    const d1 = { ...off.deps, watching: () => 'local:a' };
    const h1 = renderHook((p: Props) => useAlerts(p, d1), { initialProps: { sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [off.local], status: 'open' } as Props });
    h1.rerender({ sessions: [ask('local:a', 'Otto')], machines: [off.local], status: 'open' });
    await vi.waitFor(() => expect(d1.player.play).toHaveBeenCalledTimes(1));
    setSounds({ onlyWhenTerminalBehind: true });
    const other = setup();
    const d2 = { ...other.deps, watching: () => null };
    const h2 = renderHook((p: Props) => useAlerts(p, d2), { initialProps: { sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [other.local], status: 'open' } as Props });
    h2.rerender({ sessions: [ask('local:a', 'Otto')], machines: [other.local], status: 'open' });
    await vi.waitFor(() => expect(d2.player.play).toHaveBeenCalledTimes(1));
  });
  it('no sound while the terminal is in front, the toast stays', async () => {
    const s = setup();
    s.deps.terminalInFront.mockResolvedValue(true);
    s.h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [s.local], status: 'open' });
    s.h.rerender({ sessions: [ask('local:a', 'Otto')], machines: [s.local], status: 'open' });
    await vi.waitFor(() => expect(s.deps.terminalInFront).toHaveBeenCalled());
    await Promise.resolve();
    expect(s.deps.player.play).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(s.deps.toast).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe('a finish follows the finish mode', () => {
  it('sound only: no toast', async () => {
    setNotifyMode('sound');
    const { deps, local, h } = setup();
    h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto' })], machines: [local], status: 'open' });
    h.rerender({ sessions: [fakeSession('local:a', { name: 'Otto', state: 'idle' })], machines: [local], status: 'open' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('finished', 1));
    expect(deps.toast).not.toHaveBeenCalled();
  });
});

describe('the daemon and the user', () => {
  it('losing the local daemon plays the error cue once', async () => {
    const { deps, local, h } = setup();
    h.rerender({ sessions: [], machines: [local], status: 'open' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'unreachable', ready: false })], status: 'unreachable' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'connecting', ready: false })], status: 'connecting' });
    h.rerender({ sessions: [], machines: [machine('local', { status: 'unreachable', ready: false })], status: 'unreachable' });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledTimes(1));
    expect(deps.player.play).toHaveBeenCalledWith('error', 1);
  });
  it('a daemon update you started restarts the local daemon without the error cue (final review M3)', async () => {
    const { deps, local, h } = setup();
    const down = machine('local', { status: 'unreachable', ready: false });
    h.rerender({ sessions: [], machines: [local], status: 'open', daemonUpdating: true });
    h.rerender({ sessions: [], machines: [down], status: 'unreachable', daemonUpdating: true });
    h.rerender({ sessions: [], machines: [local], status: 'open', daemonUpdating: true });
    h.rerender({ sessions: [], machines: [local], status: 'open', daemonUpdating: false });
    await Promise.resolve(); await Promise.resolve();
    expect(deps.player.play).not.toHaveBeenCalled();
    // once the update is over, a real outage sounds again
    now += 60_000;
    h.rerender({ sessions: [], machines: [down], status: 'unreachable', daemonUpdating: false });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('error', 1));
  });
  it('a decision ticks without asking for the terminal; Test plays the question cue unless Do not disturb', async () => {
    const { deps, h } = setup();
    act(() => h.result.current.user('accept'));
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('accept', 1));
    expect(deps.terminalInFront).not.toHaveBeenCalled();
    act(() => setSounds({ volume: 'loud' }));
    expect(h.result.current.test()).toBe('played');
    expect(deps.player.play).toHaveBeenLastCalledWith('question', 1.8);
    act(() => setDnd(true));
    expect(h.result.current.test()).toBe('dnd');
    expect(deps.player.play).toHaveBeenCalledTimes(2);
  });
});

describe('toasts over a real burst (one fleet update per session)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const fire = (h: ReturnType<typeof setup>['h'], local: MachineState, sessions: Session[]) => act(() => { h.rerender({ sessions, machines: [local], status: 'open' }); });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  function burst(s: ReturnType<typeof setup>, n = 5) {
    fire(s.h, s.local, ids.map(i => fakeSession(`local:${i}`, { name: i })));
    for (let k = 1; k <= n; k++) {
      fire(s.h, s.local, ids.map((i, j) => (j < k ? ask(`local:${i}`, i) : fakeSession(`local:${i}`, { name: i }))));
      act(() => { vi.advanceTimersByTime(100); });
    }
  }
  it('five asks as five separate updates inside the window: one grouped toast', () => {
    const s = setup(); burst(s);
    expect(s.deps.toast).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS); });
    expect(s.deps.toast).toHaveBeenCalledTimes(1);
    expect(s.deps.toast).toHaveBeenCalledWith('Your team', '5 sessions need you or have finished');
  });
  it('two asks further apart than the window: two toasts', () => {
    const s = setup();
    fire(s.h, s.local, [fakeSession('local:a', { name: 'Otto' }), fakeSession('local:b', { name: 'Nova' })]);
    fire(s.h, s.local, [ask('local:a', 'Otto'), fakeSession('local:b', { name: 'Nova' })]);
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS + 500); });
    fire(s.h, s.local, [ask('local:a', 'Otto'), ask('local:b', 'Nova')]);
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS + 500); });
    expect(s.deps.toast).toHaveBeenCalledTimes(2);
    expect(s.deps.toast).toHaveBeenNthCalledWith(1, 'Otto needs your approval', 'Otto asks');
    expect(s.deps.toast).toHaveBeenNthCalledWith(2, 'Nova needs your approval', 'Nova asks');
  });
  it('Do not disturb turned on during the window: no toast', () => {
    const s = setup(); burst(s, 2);
    act(() => setDnd(true));
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS * 2); });
    expect(s.deps.toast).not.toHaveBeenCalled();
  });
  it('the window gaining the focus during the window: no toast', () => {
    const s = setup(); burst(s, 2);
    s.deps.focused.mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS * 2); });
    expect(s.deps.toast).not.toHaveBeenCalled();
  });
  it('unmounting during the window: no toast and no timer left', () => {
    const s = setup(); burst(s, 2);
    s.h.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TOAST_WINDOW_MS * 2);
    expect(s.deps.toast).not.toHaveBeenCalled();
  });
  it('a finish and a failure while the window is focused: no toast', () => {
    setNotifyMode('both');
    const s = setup(true);
    fire(s.h, s.local, [fakeSession('local:a', { name: 'Otto' })]);
    fire(s.h, s.local, [fakeSession('local:a', { name: 'Otto', state: 'idle' })]);
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS * 2); });
    expect(s.deps.toast).not.toHaveBeenCalled();
  });
  it('two machines with the same raw session id do not collide', () => {
    const s = setup(); const dev = machine('devbox');
    const both = (a: Session, b: Session) => act(() => { s.h.rerender({ sessions: [a, b], machines: [s.local, dev], status: 'open' }); });
    both(fakeSession('local:x', { name: 'Otto' }), fakeSession('devbox:x', { name: 'Rio' }));
    both(fakeSession('local:x', { name: 'Otto' }), ask('devbox:x', 'Rio'));
    act(() => { vi.advanceTimersByTime(TOAST_WINDOW_MS + 100); });
    expect(s.deps.toast).toHaveBeenCalledTimes(1);
    expect(s.deps.toast).toHaveBeenCalledWith('Rio needs your approval', 'Rio asks');
  });
});

describe('a decision a session puts to the user (`ledge task give ledge …`)', () => {
  const decision = (id: string, at: number, extra: Partial<Task> = {}): Task => ({ id, title: 'Fusionner feat/roles ?', giver: 'local:otto', giverName: 'Otto', owner: 'ledge', ownerName: 'Ledge', state: 'open', at: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(), log: [], ...extra });
  function connected(focused = false) {
    const s = setup(focused);
    s.h.rerender({ sessions: [], machines: [s.local], status: 'open', tasks: [] });
    return s;
  }
  it('a new one plays the question cue (« A bot needs you ») and toasts while Desktop is behind', async () => {
    const { deps, local, h } = connected();
    h.rerender({ sessions: [], machines: [local], status: 'open', tasks: [decision('t00000d', now + 1)] });
    await vi.waitFor(() => expect(deps.player.play).toHaveBeenCalledWith('question', 1));
    expect(deps.toast).toHaveBeenCalledWith('Otto needs your decision', 'Fusionner feat/roles ?');
    // Once per decision: the same one again, or answered, is no news.
    h.rerender({ sessions: [], machines: [local], status: 'open', tasks: [decision('t00000d', now + 1, { updatedAt: new Date(now + 2).toISOString() })] });
    h.rerender({ sessions: [], machines: [local], status: 'open', tasks: [decision('t00000d', now + 1, { state: 'done' })] });
    await Promise.resolve();
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.player.play).toHaveBeenCalledTimes(1);
  });
  it('those given before the connection, a task given by Ledge, and a closed decision are silent', async () => {
    const { deps, local, h } = connected();
    h.rerender({ sessions: [], machines: [local], status: 'open', tasks: [
      decision('t000old', now - 60_000),
      decision('t000002', now + 1, { giver: 'ledge', giverName: 'Ledge', owner: 'local:otto', ownerName: 'Otto' }),
      decision('t000003', now + 1, { state: 'refused' })
    ] });
    await Promise.resolve(); await Promise.resolve();
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.player.play).not.toHaveBeenCalled();
  });
  it('follows the preferences: no toast while Desktop has the focus; Do not disturb cuts both; the requests category its sound', async () => {
    const focused = connected(true);
    focused.h.rerender({ sessions: [], machines: [focused.local], status: 'open', tasks: [decision('t00000d', now + 1)] });
    await vi.waitFor(() => expect(focused.deps.player.play).toHaveBeenCalledWith('question', 1));
    expect(focused.deps.toast).not.toHaveBeenCalled();

    setSounds({ categories: { requests: false, finished: true, errors: true, decisions: true, team: false } });
    const muted = connected();
    muted.h.rerender({ sessions: [], machines: [muted.local], status: 'open', tasks: [decision('t00000e', now + 1)] });
    await vi.waitFor(() => expect(muted.deps.toast).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 0));   // the cue's decision waits for the terminal check
    expect(muted.deps.player.play).not.toHaveBeenCalled();

    setDnd(true);
    const dnd = connected();
    dnd.h.rerender({ sessions: [], machines: [dnd.local], status: 'open', tasks: [decision('t00000f', now + 1)] });
    await Promise.resolve(); await Promise.resolve();
    expect(dnd.deps.toast).not.toHaveBeenCalled();
    expect(dnd.deps.player.play).not.toHaveBeenCalled();
  });
});
