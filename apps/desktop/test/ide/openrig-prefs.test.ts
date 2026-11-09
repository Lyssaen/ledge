import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { HumanAsk, OpenRigState, Rig, RigSeat, Session } from '@ledge/protocol';
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
    expect(prefAction({ kind: 'daemon' }, 'start', d)).toEqual({ kind: 'daemon.start', restore: 'last' });
    expect(prefAction({ kind: 'daemon' }, 'start', { ...d, relaunch: false, noKernel: true })).toEqual({ kind: 'daemon.start', restore: 'none', noKernel: true });
    expect(prefAction({ kind: 'daemon' }, 'start', { ...d, noKernel: true })).toEqual({ kind: 'daemon.start', restore: 'last' });
    expect(prefAction({ kind: 'daemon' }, 'restart', { ...d, relaunch: false })).toEqual({ kind: 'daemon.restart', restore: 'none' });
    expect(prefAction({ kind: 'daemon' }, 'stop', d)).toEqual({ kind: 'daemon.stop' });
  });
  it('snapshots a rig before it stops, unless told not to', () => {
    expect(prefAction({ kind: 'rig', name: 'dev' }, 'stop', d)).toEqual({ kind: 'rig.stop', rig: 'dev', snapshot: true });
    expect(prefAction({ kind: 'rig', name: 'dev' }, 'stop', { ...d, snapshotBeforeStop: false })).toEqual({ kind: 'rig.stop', rig: 'dev' });
    expect(prefAction({ kind: 'rig', name: 'dev' }, 'start', d)).toEqual({ kind: 'rig.start', rig: 'dev' });
    expect(prefAction({ kind: 'kernel' }, 'stop', d)).toEqual({ kind: 'kernel.stop' });
  });
  it('a rig named like the daemon or the kernel is still a rig', () => {
    expect(prefAction({ kind: 'rig', name: 'daemon' }, 'stop', d)).toEqual({ kind: 'rig.stop', rig: 'daemon', snapshot: true });
    expect(prefAction({ kind: 'rig', name: 'kernel' }, 'restart', d)).toEqual({ kind: 'rig.restart', rig: 'kernel' });
  });
});

const seat = (logicalId: string, working: boolean): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@dev`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: working ? 'running' : 'idle', stopped: false, work: 0 });
const stateOf = (working: boolean): OpenRigState => ({ installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [{ id: 'dev', name: 'dev', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [seat('dev.build', working)] } as Rig] });

describe('needsConfirm', () => {
  const stop = prefAction({ kind: 'rig', name: 'dev' }, 'stop', DAEMON_PREFS_DEFAULT);
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

describe('needsConfirm with the live Ledge sessions', () => {
  const p = { ...DAEMON_PREFS_DEFAULT, askAlways: false };
  const live = (state: Session['state']): { sessions: Session[]; asks: HumanAsk[]; machine: string } =>
    ({ sessions: [fakeSession('s1', { state, machineId: 'local', rig: { seat: 'dev-build@dev', name: 'dev' } })], asks: [], machine: 'local' });
  const stop = prefAction({ kind: 'rig', name: 'dev' }, 'stop', p);
  it('asks when a Ledge session of the rig works or waits on a permission, though OpenRig says idle', () => {
    expect(needsConfirm(stop, stateOf(false), p, live('working'))).toBe(true);
    expect(needsConfirm(stop, stateOf(false), p, live('starting'))).toBe(true);
    expect(needsConfirm(stop, stateOf(false), p, live('waiting_permission'))).toBe(true);
    expect(needsConfirm(stop, stateOf(false), p, live('waiting_input'))).toBe(true);
  });
  it('asks when the seat has raised an ask', () => {
    const l = live('idle');
    const ask = { from: { seat: 'dev-build@dev', machineId: 'local' } } as unknown as HumanAsk;
    expect(needsConfirm(stop, stateOf(false), p, { ...l, asks: [ask] })).toBe(true);
  });
  it('does not ask for an idle session, nor for the work of another rig', () => {
    expect(needsConfirm(stop, stateOf(false), p, live('idle'))).toBe(false);
    const other = prefAction({ kind: 'rig', name: 'other' }, 'stop', p);
    expect(needsConfirm(other, stateOf(false), p, live('working'))).toBe(false);
  });
  it('a kernel action looks at the kernel seats, a daemon action at every rig', () => {
    const st = stateOf(false);
    st.rigs.push({ ...st.rigs[0]!, id: 'kernel', name: 'kernel', nodes: [{ ...seat('orch.lead', false), session: 'orch-lead@kernel' }] } as Rig);
    const kernelLive = { sessions: [fakeSession('k1', { state: 'working', machineId: 'local', rig: { seat: 'orch-lead@kernel', name: 'kernel' } })], asks: [], machine: 'local' };
    expect(needsConfirm(prefAction({ kind: 'daemon' }, 'stop', p), st, p, live('working'))).toBe(true);
    expect(needsConfirm(prefAction({ kind: 'kernel' }, 'stop', p), st, p, live('working'))).toBe(false);
    expect(needsConfirm(prefAction({ kind: 'kernel' }, 'stop', p), st, p, kernelLive)).toBe(true);
    expect(needsConfirm(prefAction({ kind: 'rig', name: 'dev' }, 'stop', p), st, p, kernelLive)).toBe(false);
    expect(needsConfirm(prefAction({ kind: 'daemon' }, 'restart', p), st, p, kernelLive)).toBe(true);
  });
  it('askAlways still asks, whatever the sessions', () => {
    expect(needsConfirm(stop, stateOf(false), DAEMON_PREFS_DEFAULT, live('idle'))).toBe(true);
  });
});
