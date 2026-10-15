import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { MachineState } from '@ledge/fleet';
import { daemonOffer, daemonTarget, useDaemonUpdate } from '../src/update/daemon';
import { fakeFleet, machine } from './launch-helpers';

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
  it('the target is the release on offer, else the running app', () => {
    expect(daemonTarget({ phase: { kind: 'available', version: '0.6.0', notes: '' }, auto: true, checkedAt: 1, app: '0.5.0', latest: '0.6.0' })).toBe('0.6.0');
    expect(daemonTarget({ phase: { kind: 'current' }, auto: true, checkedAt: 1, app: '0.5.0', latest: null })).toBe('0.5.0');
    expect(daemonTarget({ phase: { kind: 'idle' }, auto: true, checkedAt: null, app: null, latest: null })).toBeNull();
  });
});

describe('useDaemonUpdate', () => {
  it('sends update.daemon to the local daemon only, follows its journal, and is done once it returns updated', () => {
    const fleet = fakeFleet();
    const h = renderHook(({ ms }: { ms: MachineState[] }) => useDaemonUpdate(fleet, ms, '0.6.0'), { initialProps: { ms: [local('0.5.0'), machine('devbox')] } });
    expect(h.result.current.offer).toBe('offer');
    act(() => { h.result.current.start(); h.result.current.start(); });
    expect(fleet.sent).toEqual([{ machine: 'local', msg: { type: 'update.daemon', version: '0.6.0' } }]);
    act(() => fleet.emit('devbox', { type: 'update.failed', version: '0.6.0', reason: 'busy' }));
    act(() => fleet.emit('local', { type: 'update.progress', version: '0.6.0', step: 'installing' }));
    act(() => fleet.emit('local', { type: 'update.progress', version: '0.6.0', step: 'restarting' }));
    h.rerender({ ms: [local('0.5.0', 'npm', { status: 'unreachable', ready: false })] });
    expect(h.result.current.running).toBe(true);
    h.rerender({ ms: [local('0.6.0')] });
    expect(h.result.current.journal.map(s => s.kind)).toEqual(['sent', 'installing', 'restarting', 'done']);
    expect(h.result.current.running).toBe(false);
  });

  it('a refusal is shown with its command, and the button can be used again', () => {
    const fleet = fakeFleet();
    const h = renderHook(() => useDaemonUpdate(fleet, [local('0.5.0')], '0.6.0'));
    act(() => h.result.current.start());
    act(() => fleet.emit('local', { type: 'update.failed', version: '0.6.0', reason: 'sessions-at-risk', command: 'ledge update' }));
    expect(h.result.current.journal.at(-1)).toEqual({ kind: 'failed', reason: 'sessions-at-risk', command: 'ledge update' });
    expect(h.result.current.running).toBe(false);
  });

  it('the local daemon closed: nothing sent, « offline »; a silent daemon times out', () => {
    vi.useFakeTimers();
    try {
      const down = fakeFleet(['local']);
      const a = renderHook(() => useDaemonUpdate(down, [local('0.5.0')], '0.6.0'));
      act(() => a.result.current.start());
      expect(a.result.current.journal).toEqual([{ kind: 'failed', reason: 'offline' }]);
      const fleet = fakeFleet();
      const b = renderHook(() => useDaemonUpdate(fleet, [local('0.5.0')], '0.6.0', 1000));
      act(() => b.result.current.start());
      act(() => { vi.advanceTimersByTime(1000); });
      expect(b.result.current.journal.at(-1)).toEqual({ kind: 'failed', reason: 'timeout' });
    } finally { vi.useRealTimers(); }
  });
});
