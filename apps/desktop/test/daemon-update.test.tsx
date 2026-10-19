import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineState } from '@ledge/fleet';
import { daemonOffer, daemonTarget, useDaemonUpdates, type DaemonUpdates } from '../src/update/daemon';
import { fakeFleet, machine } from './fleet-helpers';

const local = (version: string, install: 'npm' | 'git' | 'unknown' = 'npm', extra: Partial<MachineState> = {}) =>
  machine('local', { daemon: { version, install, systemd: true, ...(install === 'npm' ? {} : { manual: 'cd ~/ledge && git pull && pnpm build' }) }, ...extra });

describe('daemonOffer', () => {
  it('an npm daemon behind the target is offered, a git one gets its command, an up-to-date one nothing', () => {
    expect(daemonOffer(local('0.5.0'), '0.6.0')).toBe('offer');
    expect(daemonOffer(local('0.5.0', 'git'), '0.6.0')).toBe('manual');
    expect(daemonOffer(machine('local', { daemon: { version: '0.5.0', install: 'npm', systemd: false } }), '0.6.0')).toBe('manual');
    expect(daemonOffer(local('0.6.0'), '0.6.0')).toBe('none');
    expect(daemonOffer(machine('local'), '0.6.0')).toBe('none');
    expect(daemonOffer(local('0.5.0'), null)).toBe('none');
  });
  it('a daemon version that is not a valid semver gets no offer (never a possible downgrade)', () => {
    for (const v of ['', 'dev', '1.x']) expect(daemonOffer(local(v), '0.6.0')).toBe('none');
    expect(daemonOffer(local('0.5.0'), '0.6.0')).toBe('offer');
  });
  it('the target is the release on offer, else the running app', () => {
    expect(daemonTarget({ phase: { kind: 'available', version: '0.6.0', notes: '' }, auto: true, checkedAt: 1, app: '0.5.0', latest: '0.6.0' })).toBe('0.6.0');
    expect(daemonTarget({ phase: { kind: 'current' }, auto: true, checkedAt: 1, app: '0.5.0', latest: null })).toBe('0.5.0');
    expect(daemonTarget({ phase: { kind: 'idle' }, auto: true, checkedAt: null, app: null, latest: null })).toBeNull();
  });
});

const npm = (id: string, version: string, extra: Partial<MachineState> = {}) => machine(id, { daemon: { version, install: 'npm', systemd: true }, ...extra });
const kinds = (h: { result: { current: DaemonUpdates } }, id: string) => h.result.current.of(id).journal.map(s => s.kind);
type Props = { ms: MachineState[]; target?: string | null; auto?: string | null };

describe('useDaemonUpdates (#48: every machine of the fleet)', () => {
  it('« Update » sends update.daemon to that machine only, follows its own journal, and is done once it comes back updated', () => {
    const fleet = fakeFleet();
    const h = renderHook(({ ms }: Props) => useDaemonUpdates(fleet, ms, '0.6.0', null), { initialProps: { ms: [npm('local', '0.6.0'), npm('devbox', '0.5.0')] } });
    expect(h.result.current.of('devbox').offer).toBe('offer');
    expect(h.result.current.of('local').offer).toBe('none');
    act(() => { h.result.current.start('devbox'); h.result.current.start('devbox'); });
    expect(fleet.sent).toEqual([{ machine: 'devbox', msg: { type: 'update.daemon', version: '0.6.0' } }]);
    // Another machine's messages are not this one's.
    act(() => fleet.emit('local', { type: 'update.failed', version: '0.6.0', reason: 'busy' }));
    act(() => fleet.emit('devbox', { type: 'update.progress', version: '0.6.0', step: 'installing' }));
    act(() => fleet.emit('devbox', { type: 'update.progress', version: '0.6.0', step: 'restarting' }));
    expect(h.result.current.of('local').journal).toEqual([]);
    // It restarts: its connection drops, the update still runs and the machine counts as updating.
    h.rerender({ ms: [npm('local', '0.6.0'), npm('devbox', '0.5.0', { status: 'unreachable', ready: false })] });
    expect(h.result.current.of('devbox').running).toBe(true);
    expect([...h.result.current.updating]).toEqual(['devbox']);
    h.rerender({ ms: [npm('local', '0.6.0'), npm('devbox', '0.6.0')] });
    expect(kinds(h, 'devbox')).toEqual(['sent', 'installing', 'restarting', 'done']);
    expect(h.result.current.of('devbox').running).toBe(false);
    expect(h.result.current.updating.size).toBe(0);
  });

  it('on its own: each connected npm + systemd daemon behind Desktop gets update.daemon once, the WSL as the remote ones', () => {
    const fleet = fakeFleet();
    const git = machine('nas', { daemon: { version: '0.5.0', install: 'git', systemd: true, manual: 'cd ~/ledge && git pull' } });
    const initial = [npm('local', '0.5.0'), npm('devbox', '0.5.0'), git, npm('newer', '0.7.0'), npm('later', '0.5.0', { status: 'connecting', ready: false })];
    const h = renderHook(({ ms, target = '0.6.0', auto = '0.6.0' }: Props) => useDaemonUpdates(fleet, ms, target, auto), { initialProps: { ms: initial } });
    expect(fleet.sent).toEqual([
      { machine: 'local', msg: { type: 'update.daemon', version: '0.6.0' } },
      { machine: 'devbox', msg: { type: 'update.daemon', version: '0.6.0' } }
    ]);
    expect(h.result.current.of('devbox').journal).toEqual([{ kind: 'sent', version: '0.6.0', auto: true }]);
    // A git clone keeps its command, a newer daemon is never taken back, nothing is sent twice.
    expect(h.result.current.of('nas').offer).toBe('manual');
    expect(h.result.current.of('newer').offer).toBe('none');
    h.rerender({ ms: initial.map(m => ({ ...m })) });
    expect(fleet.sent).toHaveLength(2);
    // A machine that connects later is updated once it is ready.
    h.rerender({ ms: [...initial.slice(0, 4), npm('later', '0.5.0')] });
    expect(fleet.sent.map(s => s.machine)).toEqual(['local', 'devbox', 'later']);
  });

  it('on its own, once per version: a refusal is not retried by itself, « Update » still is', () => {
    const fleet = fakeFleet();
    const h = renderHook(({ ms }: Props) => useDaemonUpdates(fleet, ms, '0.6.0', '0.6.0'), { initialProps: { ms: [npm('devbox', '0.5.0')] } });
    act(() => fleet.emit('devbox', { type: 'update.failed', version: '0.6.0', reason: 'sessions-at-risk' }));
    h.rerender({ ms: [npm('devbox', '0.5.0', { status: 'unreachable', ready: false })] });
    h.rerender({ ms: [npm('devbox', '0.5.0')] });
    expect(fleet.sent).toHaveLength(1);
    expect(h.result.current.of('devbox').journal.at(-1)).toEqual({ kind: 'failed', reason: 'sessions-at-risk' });
    act(() => h.result.current.start('devbox'));
    expect(fleet.sent).toHaveLength(2);
    expect(h.result.current.of('devbox').journal.at(-1)).toEqual({ kind: 'sent', version: '0.6.0' });
  });

  it('on its own toward the version Desktop runs, not a release still on offer; nothing outside the app (no version)', () => {
    const fleet = fakeFleet();
    const h = renderHook(({ ms, target, auto }: Props) => useDaemonUpdates(fleet, ms, target!, auto!), { initialProps: { ms: [npm('devbox', '0.5.0')], target: '0.7.0', auto: '0.6.0' } });
    expect(fleet.sent).toEqual([{ machine: 'devbox', msg: { type: 'update.daemon', version: '0.6.0' } }]);
    const idle = fakeFleet();
    renderHook(() => useDaemonUpdates(idle, [npm('devbox', '0.5.0')], '0.6.0', null));
    expect(idle.sent).toEqual([]);
    // Up to Desktop's version, a release on offer stays a click away.
    const ahead = fakeFleet();
    const a = renderHook(() => useDaemonUpdates(ahead, [npm('devbox', '0.6.0')], '0.7.0', '0.6.0'));
    expect(ahead.sent).toEqual([]);
    expect(a.result.current.of('devbox').offer).toBe('offer');
  });

  it('a machine closed: nothing sent, « offline »; a silent daemon times out after DAEMON_STALL_MS', () => {
    vi.useFakeTimers();
    try {
      const down = fakeFleet(['devbox']);
      const a = renderHook(() => useDaemonUpdates(down, [npm('devbox', '0.5.0')], '0.6.0', null));
      act(() => a.result.current.start('devbox'));
      expect(a.result.current.of('devbox').journal).toEqual([{ kind: 'failed', reason: 'offline' }]);
      const fleet = fakeFleet();
      const b = renderHook(() => useDaemonUpdates(fleet, [npm('devbox', '0.5.0'), npm('local', '0.5.0')], '0.6.0', '0.6.0', 1000));
      act(() => { vi.advanceTimersByTime(999); });
      act(() => fleet.emit('local', { type: 'update.progress', version: '0.6.0', step: 'installing' }));
      act(() => { vi.advanceTimersByTime(1); });
      expect(b.result.current.of('devbox').journal.at(-1)).toEqual({ kind: 'failed', reason: 'timeout' });
      expect(b.result.current.of('local').journal.at(-1)).toEqual({ kind: 'failed', reason: 'timeout' });
      expect(b.result.current.updating.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
