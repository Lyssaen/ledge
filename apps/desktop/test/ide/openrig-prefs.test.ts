import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRigState, Rig, RigSeat } from '@ledge/protocol';
import { DAEMON_PREFS_DEFAULT, loadDaemonPrefs, needsConfirm, prefAction, saveDaemonPrefs } from '../../src/ide/openrig/prefs';

const KEY = 'ledge.ide.daemonPrefs';
beforeEach(() => localStorage.clear());

describe('daemon preferences storage', () => {
  it('gives the defaults when nothing is stored, when the store is corrupt, or when it throws', () => {
    expect(loadDaemonPrefs('srv')).toEqual(DAEMON_PREFS_DEFAULT);
    expect(DAEMON_PREFS_DEFAULT).toEqual({ relaunch: true, noKernel: false, perm: 'spec', snapshotBeforeStop: true, askAlways: true });
    localStorage.setItem(KEY, '{cassé');
    expect(loadDaemonPrefs('srv')).toEqual(DAEMON_PREFS_DEFAULT);
    localStorage.setItem(KEY, '[1]');
    expect(loadDaemonPrefs('srv')).toEqual(DAEMON_PREFS_DEFAULT);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadDaemonPrefs('srv')).toEqual(DAEMON_PREFS_DEFAULT);
    spy.mockRestore();
  });
  it('keeps what is valid, ignores unknown keys and a machine that is not stored', () => {
    localStorage.setItem(KEY, JSON.stringify({ srv: { perm: 'yolo', bogus: 1 } }));
    expect(loadDaemonPrefs('srv')).toEqual({ ...DAEMON_PREFS_DEFAULT, perm: 'yolo' });
    expect(loadDaemonPrefs('other')).toEqual(DAEMON_PREFS_DEFAULT);
    localStorage.setItem(KEY, JSON.stringify({ srv: { perm: 'nope', relaunch: 'yes' } }));
    expect(loadDaemonPrefs('srv')).toEqual(DAEMON_PREFS_DEFAULT);
  });
  it('saving one machine leaves another alone', () => {
    saveDaemonPrefs('local', { askAlways: false });
    saveDaemonPrefs('srv', { relaunch: false });
    expect(loadDaemonPrefs('srv')).toEqual({ ...DAEMON_PREFS_DEFAULT, relaunch: false });
    expect(loadDaemonPrefs('local')).toEqual({ ...DAEMON_PREFS_DEFAULT, askAlways: false });
  });
});

describe('prefAction', () => {
  const d = DAEMON_PREFS_DEFAULT;
  it('starts and restarts the daemon with the relaunch preference', () => {
    expect(prefAction('daemon', 'start', d)).toEqual({ kind: 'daemon.start', restore: 'last' });
    expect(prefAction('daemon', 'start', { ...d, relaunch: false, noKernel: true })).toEqual({ kind: 'daemon.start', restore: 'none', noKernel: true });
    expect(prefAction('daemon', 'start', { ...d, noKernel: true })).toEqual({ kind: 'daemon.start', restore: 'last' });
    expect(prefAction('daemon', 'restart', { ...d, relaunch: false })).toEqual({ kind: 'daemon.restart', restore: 'none' });
    expect(prefAction('daemon', 'stop', d)).toEqual({ kind: 'daemon.stop' });
  });
  it('snapshots a rig before it stops, unless told not to', () => {
    expect(prefAction('dev', 'stop', d)).toEqual({ kind: 'rig.stop', rig: 'dev', snapshot: true });
    expect(prefAction('dev', 'stop', { ...d, snapshotBeforeStop: false })).toEqual({ kind: 'rig.stop', rig: 'dev' });
    expect(prefAction('dev', 'start', d)).toEqual({ kind: 'rig.start', rig: 'dev' });
    expect(prefAction('kernel', 'stop', d)).toEqual({ kind: 'kernel.stop' });
  });
});

const seat = (logicalId: string, working: boolean): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@dev`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: working ? 'running' : 'idle', stopped: false, work: 0 });
const stateOf = (working: boolean): OpenRigState => ({ installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [{ id: 'dev', name: 'dev', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [seat('dev.build', working)] } as Rig] });

describe('needsConfirm', () => {
  const stop = prefAction('dev', 'stop', DAEMON_PREFS_DEFAULT);
  it('never asks for a start', () => {
    expect(needsConfirm({ kind: 'daemon.start' }, stateOf(true), DAEMON_PREFS_DEFAULT)).toBe(false);
  });
  it('always asks when askAlways', () => {
    expect(needsConfirm(stop, stateOf(false), DAEMON_PREFS_DEFAULT)).toBe(true);
  });
  it('unticked, asks only when a seat is working', () => {
    const p = { ...DAEMON_PREFS_DEFAULT, askAlways: false };
    expect(needsConfirm(stop, stateOf(false), p)).toBe(false);
    expect(needsConfirm(stop, stateOf(true), p)).toBe(true);
  });
});
