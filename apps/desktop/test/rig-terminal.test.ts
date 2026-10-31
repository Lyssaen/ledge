import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rig, RigSeat, Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const bridge = vi.hoisted(() => ({ openTerminal: vi.fn(async () => true) }));
const session = vi.hoisted(() => ({ openSessionTerminal: vi.fn(async () => true) }));
vi.mock('../src/tauri/bridge', () => bridge);
vi.mock('../src/session/terminal', () => session);
import { openSeatTerminal } from '../src/rigs/terminal';

const seat: RigSeat = { ref: 'build@factory', address: '@build', name: 'build', runtime: 'claude-code', state: 'working', sessionId: 'local:build' };
const rig: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: false, repos: [], seats: [seat] };
const client = { fleet: { seatTerminal: (m: string, ref: string) => `tmux attach -t ${m}:${ref}` } } as unknown as DaemonClient;
const by = (s: Session) => new Map([[s.id, s]]);

beforeEach(() => { bridge.openTerminal.mockClear(); session.openSessionTerminal.mockClear(); session.openSessionTerminal.mockResolvedValue(true); });

describe('openSeatTerminal', () => {
  it('a paired hook_only session has no terminal: the seat command is used', async () => {
    const paired = fakeSession('local:build', { name: 'build', source: 'hook_only', tmuxSession: null });
    expect(await openSeatTerminal(client, rig, seat, by(paired))).toBe(true);
    expect(session.openSessionTerminal).not.toHaveBeenCalled();
    expect(bridge.openTerminal).toHaveBeenCalledWith('factory · build', 'tmux attach -t local:build@factory');
  });

  it('a paired session with a tmux session opens that session', async () => {
    const paired = fakeSession('local:build', { name: 'build', source: 'hook_only', tmuxSession: 'ledge-build' });
    expect(await openSeatTerminal(client, rig, seat, by(paired))).toBe(true);
    expect(session.openSessionTerminal).toHaveBeenCalledWith(client, paired);
    expect(bridge.openTerminal).not.toHaveBeenCalled();
  });

  it('falls back on the seat command when the paired session terminal does not open', async () => {
    const paired = fakeSession('local:build', { name: 'build', source: 'launcher', tmuxSession: null });
    session.openSessionTerminal.mockResolvedValue(false);
    expect(await openSeatTerminal(client, rig, seat, by(paired))).toBe(true);
    expect(bridge.openTerminal).toHaveBeenCalledOnce();
  });
});
