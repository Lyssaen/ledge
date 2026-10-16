import { describe, it, expect } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { sessionActions } from '../src/conversation/actions';

const cmd = ['ssh', '-t', 'devbox', 'tmux', 'attach', '-t', 'ledge-nova'];

describe('sessionActions', () => {
  it('a working launcher session: terminal, interrupt, stop and rename; no dismiss', () => {
    const a = sessionActions(fakeSession('local:otto'), cmd);
    expect(a.terminal).toEqual({ shown: true, enabled: true });
    expect(a.interrupt).toEqual({ shown: true, enabled: true });
    expect(a.kill).toEqual({ shown: true, enabled: true });
    expect(a.dismiss.shown).toBe(false);
    expect(a.rename).toEqual({ shown: true, enabled: true });
  });
  it('an idle session cannot be interrupted', () => {
    expect(sessionActions(fakeSession('local:otto', { state: 'idle' }), cmd).interrupt).toEqual({ shown: true, enabled: false, reason: 'idle' });
  });
  it('a finished session or a hook-only one can be dismissed, not stopped', () => {
    const done = sessionActions(fakeSession('local:otto', { state: 'exited' }), cmd);
    expect([done.dismiss.shown, done.kill.shown, done.interrupt.shown]).toEqual([true, false, false]);
    const hook = sessionActions(fakeSession('local:otto', { source: 'hook_only', tmuxSession: null }), null);
    expect([hook.dismiss.shown, hook.kill.shown, hook.interrupt.shown]).toEqual([true, false, false]);
    expect(hook.terminal.enabled).toBe(true); // a local session is focused by its title, as in the island
  });
  it('a remote session needs a terminal command and a tmux session', () => {
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox' }), null).terminal).toEqual({ shown: true, enabled: false, reason: 'noTerminal' });
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox', tmuxSession: null }), cmd).terminal.enabled).toBe(false);
    expect(sessionActions(fakeSession('devbox:nova', { machineId: 'devbox' }), cmd).terminal.enabled).toBe(true);
  });
  it('offline disables every action, with its reason (spec §14)', () => {
    const a = sessionActions(fakeSession('devbox:nova', { machineId: 'devbox', offline: true }), cmd);
    for (const k of ['terminal', 'interrupt', 'kill', 'rename'] as const) expect(a[k]).toEqual({ shown: true, enabled: false, reason: 'offline' });
  });
});
