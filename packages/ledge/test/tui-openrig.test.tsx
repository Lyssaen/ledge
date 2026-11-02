import { describe, it, expect } from 'vitest';
import type { OpenRigAction, OpenRigState, Rig } from '@ledge/protocol';
import { asksFirst, busySeats, confirmOf, daemonToggle, keepRig, kernelToggle, listedRigs, rigLook, rigToggle, step } from '../src/tui/model/openrig.js';
import { startTui } from './tui-fixture.js';
import { until } from './helpers.js';

const seat = (logicalId: string, o: Partial<Rig['nodes'][number]> = {}) => ({ logicalId, session: `${logicalId}@x`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, o: Partial<Rig> = {}): Rig => ({ id: `id-${name}`, name, status: 'stopped', lifecycleState: 'recoverable', seats: 2, running: 0, attention: 0, uptime: null, snapshot: null, nodes: [], ...o });
const STARTER = rig('starter', { status: 'running', running: 2, uptime: '2h 12m', snapshot: '5m ago', attention: 1, nodes: [seat('dev.build', { activity: 'running', work: 2, model: 'opus' }), seat('dev.review', { runtime: 'codex' })] });
const KERNEL = rig('kernel', { status: 'running', running: 2, nodes: [seat('operator.agent', { work: 1 })] });
const STATE: OpenRigState = { installed: true, version: '0.6.14', daemon: { state: 'running', pid: 4242, port: 7433 }, kernel: { state: 'ready' }, rigs: [rig('epic-split', { seats: 3 }), STARTER, KERNEL], at: '2026-11-02T09:00:00.000Z' };

describe('OpenRig screen model', () => {
  it('lists the rigs without the kernel; reads each rig', () => {
    expect(listedRigs(STATE).map(r => r.name)).toEqual(['epic-split', 'starter']);
    expect(listedRigs(null)).toEqual([]);
    expect(rigLook(STARTER)).toBe('attention');
    expect(rigLook(rig('a', { status: 'running' }))).toBe('running');
    expect(rigLook(rig('a', { running: 1 }))).toBe('starting');
    expect(rigLook(rig('a'))).toBe('stopped');
  });
  it('s, D and K start what is stopped and stop what runs; a stop and a restart ask first, a start does not', () => {
    expect(rigToggle(STARTER)).toEqual({ kind: 'rig.stop', rig: 'starter', snapshot: true });
    expect(rigToggle(rig('epic-split'))).toEqual({ kind: 'rig.start', rig: 'epic-split' });
    expect(daemonToggle(STATE)).toEqual({ kind: 'daemon.stop' });
    expect(daemonToggle({ ...STATE, daemon: { state: 'stopped' } })).toEqual({ kind: 'daemon.start', restore: 'last' });
    expect(kernelToggle(STATE)).toEqual({ kind: 'kernel.stop' });
    expect(kernelToggle({ ...STATE, kernel: { state: 'skipped' } })).toEqual({ kind: 'kernel.start' });
    const kinds: OpenRigAction[] = [{ kind: 'rig.stop', rig: 'a' }, { kind: 'rig.restart', rig: 'a' }, { kind: 'daemon.stop' }, { kind: 'kernel.restart' }];
    expect(kinds.every(asksFirst)).toBe(true);
    expect(asksFirst({ kind: 'rig.start', rig: 'a' }) || asksFirst({ kind: 'daemon.start' }) || asksFirst({ kind: 'kernel.start' })).toBe(false);
  });
  it('a confirmation names the seats at work it stops and the commands it runs', () => {
    expect(busySeats(STATE, { kind: 'rig.stop', rig: 'starter' })).toEqual(['dev.build']);
    expect(busySeats(STATE, { kind: 'kernel.stop' })).toEqual(['operator.agent']);
    expect(busySeats(STATE, { kind: 'daemon.stop' })).toEqual(['starter · dev.build', 'kernel · operator.agent']);
    expect(confirmOf(STATE, { kind: 'rig.restart', rig: 'starter' })).toEqual({ action: { kind: 'rig.restart', rig: 'starter' }, busy: ['dev.build'], commands: ['rig down starter --snapshot', 'rig up starter --existing --yes'] });
  });
  it('the selection wraps, and stays on its rig when the list changes', () => {
    expect(step(1, 1, 2)).toBe(0); expect(step(0, -1, 2)).toBe(1); expect(step(3, 1, 0)).toBe(0);
    const rigs = listedRigs(STATE);
    expect(keepRig(rigs, 0, 'id-starter')).toBe(1);
    expect(keepRig(rigs.slice(0, 1), 1, 'id-starter')).toBe(0);
  });
});

describe('ledge tui: OpenRig (6)', () => {
  it('6 shows the daemon, the kernel and the rigs; ↵ unfolds the seats; s on a running rig asks y / n, then runs', async () => {
    const tui = await startTui();
    try {
      const acts: OpenRigAction[] = [];
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.status') tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: STATE });
        if (m.type === 'openrig.act') { acts.push(m.action); tui.daemon.push({ type: 'openrig.done', requestId: m.requestId, ok: true, commands: ['rig down starter --snapshot'] }); }
      });
      await tui.press('6');
      await until(() => tui.frame().includes('STARTER') || tui.frame().includes('starter'));
      const f = tui.frame();
      expect(f).toContain('DAEMON');
      expect(f).toContain('127.0.0.1:7433 · pid 4242');
      expect(f).toContain('KERNEL');
      expect(f).toContain('RIGS · 2');
      expect(f).toContain('epic-split');
      await tui.press('j'); await tui.press('\r');
      await until(() => tui.frame().includes('dev.build'));
      expect(tui.frame()).toContain('dev.review');
      await tui.press('s');
      await until(() => tui.frame().includes('Arrêter le rig « starter » ?'));
      expect(tui.frame()).toContain('dev.build');
      expect(tui.frame()).toContain('rig down starter --snapshot');
      expect(acts).toEqual([]);
      await tui.press('y');
      await until(() => acts.length === 1);
      expect(acts[0]).toEqual({ kind: 'rig.stop', rig: 'starter', snapshot: true });
      await until(() => tui.frame().includes('fait : rig down starter --snapshot'));
    } finally { await tui.cleanup(); }
  });
  it('n cancels a stop; an older daemon says to update it; no rig command says OpenRig is not installed', async () => {
    const tui = await startTui();
    try {
      let answer: 'state' | 'outdated' | 'absent' = 'state';
      const acts: unknown[] = [];
      tui.daemon.onMessage(m => {
        if (m.type === 'openrig.act') acts.push(m);
        if (m.type !== 'openrig.status') return;
        if (answer === 'outdated') tui.daemon.push({ type: 'error', message: 'invalid message', request: 'openrig.status' });
        else tui.daemon.push({ type: 'openrig.state', requestId: m.requestId, state: answer === 'absent' ? { ...STATE, installed: false, rigs: [] } : STATE });
      });
      await tui.press('6');
      await until(() => tui.frame().includes('epic-split'));
      await tui.press('D');
      await until(() => tui.frame().includes('Arrêter le daemon OpenRig ?'));
      expect(tui.frame()).toContain('starter · dev.build');
      await tui.press('n');
      await until(() => !tui.frame().includes('Arrêter le daemon OpenRig ?'));
      expect(acts).toEqual([]);
      answer = 'absent'; await tui.press('1'); await tui.press('6');
      await until(() => tui.frame().includes('OpenRig n’est pas installé'));
      answer = 'outdated'; await tui.press('1'); await tui.press('6');
      await until(() => tui.frame().includes('ne connaît pas OpenRig'));
    } finally { await tui.cleanup(); }
  });
});

describe('the kernel operator in the TUI', () => {
  it('O finds the session Ledge follows for the kernel\'s operator.agent, on that machine', async () => {
    const { operatorSession } = await import('../src/tui/screens/OpenRig.js');
    const node = { logicalId: 'operator.agent', session: 'operator-agent@kernel', runtime: 'codex', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 };
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, at: '2026-11-02T09:00:00.000Z',
      rigs: [{ id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [node] }] };
    const s = (id: string, machineId: string | undefined, state: 'idle' | 'exited' = 'idle') => ({ id, name: id, tool: 'codex' as const, cwd: '/w', project: 'w', title: id, tmuxSession: 'operator-agent@kernel', state, helpers: [], startedAt: '2026-11-02T09:00:00.000Z', lastActivityAt: '2026-11-02T09:00:00.000Z', source: 'rig' as const, rig: { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' }, ...(machineId ? { machineId } : {}) });
    expect(operatorSession(state, [s('old', undefined, 'exited'), s('remote', 'ec2'), s('here', undefined)], 'local')?.id).toBe('here');
    expect(operatorSession(state, [s('remote', 'ec2')], 'local')).toBeUndefined();
    expect(operatorSession(null, [s('here', undefined)], 'local')).toBeUndefined();
  });
});
