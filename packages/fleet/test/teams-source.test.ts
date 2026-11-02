import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerMessage, Task, Team } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.18.0', install: 'npm', systemd: true, routing: true, teams: true } };
const team: Team = { id: 'team-a1b2', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'build', sessionId: 'ab12' }, { role: 'qa', sessionId: null }], createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z' };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: 'Implémenter', giver: 'ledge', giverName: 'Ledge', owner: 'ab12', ownerName: 'Otto', state: 'open', at: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z', log: [], ...extra });
function setup() {
  const local = peer();
  const api = createFleetClient([LOCAL_MACHINE], () => local.client, {});
  api.connect(); local.set('open'); local.emit(snap);
  return { api, local };
}
beforeEach(() => localStorage.clear());

describe('teams and tasks from the local daemon', () => {
  it('teams arrive qualified; their tasks and Ledge’s are asked for, and the answers fill the tasks', () => {
    const { api, local } = setup();
    expect(api.fleet!.teams()).toBeNull();
    local.emit({ type: 'teams', teams: [team] });
    expect(api.fleet!.teams()![0]!.seats).toEqual([{ role: 'build', sessionId: 'local:ab12' }, { role: 'qa', sessionId: null }]);
    const lists = local.sent.filter(m => m.type === 'task.cmd');
    expect(lists.map(m => [m.by, m.op, m.all, m.team])).toEqual([['ledge', 'list', true, undefined], ['ledge', 'list', true, 'team-a1b2']]);
    local.emit({ type: 'task.result', rid: lists[0]!.rid as string, tasks: [task('t000001')] });
    local.emit({ type: 'task.result', rid: lists[1]!.rid as string, tasks: [task('t000002', { giver: 'cd34', giverName: 'Pim' })] });
    expect(api.fleet!.tasks().map(t => [t.id, t.giver, t.owner])).toEqual([['t000001', 'ledge', 'local:ab12'], ['t000002', 'local:cd34', 'local:ab12']]);
    local.emit({ type: 'task.updated', task: task('t000001', { state: 'done' }) });
    expect(api.fleet!.tasks()[0]!.state).toBe('done');
    local.emit({ type: 'team.updated', team: { ...team, state: 'resting' } });
    expect(api.fleet!.teams()![0]!.state).toBe('resting');
  });

  it('qualifies the ids of a task’s transmissions (#92)', () => {
    const { api, local } = setup();
    const at = '2026-10-26T08:00:00.000Z';
    local.emit({ type: 'task.updated', task: task('t000003', { giver: 'max', owner: 'nova', log: [
      { at, by: 'Max', what: 'confiée à Nova', op: 'give', from: 'max', to: 'nova', fromName: 'Max', toName: 'Nova' },
      { at, by: 'Nova', what: 'prise', op: 'take' },
      { at, by: 'Nova', what: 'terminée', op: 'done', from: 'nova', to: 'ledge', fromName: 'Nova', toName: 'Ledge' }
    ] }) });
    const [give, take, done] = api.fleet!.tasks()[0]!.log;
    expect(give).toMatchObject({ from: 'local:max', to: 'local:nova', fromName: 'Max', toName: 'Nova' });
    expect(take).toEqual({ at, by: 'Nova', what: 'prise', op: 'take' });
    expect(done).toMatchObject({ from: 'local:nova', to: 'ledge' });
  });

  it('team and task commands go to the local daemon, sessions unqualified, Ledge kept', () => {
    const { api, local } = setup();
    api.send({ type: 'team.join', team: 'team-a1b2', session: 'local:ab12', role: 'qa' });
    api.send({ type: 'task.cmd', rid: 'r', by: 'ledge', op: 'give', to: 'local:ab12', title: 'x' });
    api.send({ type: 'task.cmd', rid: 'r2', by: 'ledge', op: 'give', to: '@qa', team: 'team-a1b2', title: 'y' });
    api.send({ type: 'team.launch', rid: 'r3', cwd: '/w', template: 'workshop' });
    const sent = local.sent.filter(m => m.type !== 'task.cmd' || m.op !== 'list');
    expect(sent).toEqual([
      { type: 'team.join', team: 'team-a1b2', session: 'ab12', role: 'qa' },
      { type: 'task.cmd', rid: 'r', by: 'ledge', op: 'give', to: 'ab12', title: 'x' },
      { type: 'task.cmd', rid: 'r2', by: 'ledge', op: 'give', to: '@qa', team: 'team-a1b2', title: 'y' },
      { type: 'team.launch', rid: 'r3', cwd: '/w', template: 'workshop' }
    ]);
  });

  it('the user’s team.broadcast goes to the local daemon, its machine dropped, whatever machine is selected', () => {
    const local = peer(); const remote = peer();
    const api = createFleetClient([LOCAL_MACHINE, { id: 'srv', label: 'Serveur', ssh: 'srv' }], o => (o.url === LOCAL_MACHINE.url ? local : remote).client, {});
    api.connect(); local.set('open'); local.emit(snap); remote.set('open'); remote.emit(snap);
    api.fleet!.select('srv');
    api.send({ type: 'team.broadcast', rid: 'b1', team: 'team-a1b2', text: 'Pause', machineId: 'srv' });
    expect(local.sent.filter(m => m.type === 'team.broadcast')).toEqual([{ type: 'team.broadcast', rid: 'b1', team: 'team-a1b2', text: 'Pause' }]);
    expect(remote.sent.some(m => m.type === 'team.broadcast')).toBe(false);
  });

  it('broadcastTeam sends team.broadcast to the local daemon and resolves on its result of the same rid; offline when down, timeout past 4 s', async () => {
    const { api, local } = setup();
    const first = api.fleet!.broadcastTeam('team-a1b2', 'Pause');
    const second = api.fleet!.broadcastTeam('team-a1b2', 'Reprenez');
    const [a, b] = local.sent.filter(m => m.type === 'team.broadcast') as Array<{ rid: string; team: string; text: string }>;
    expect(a).toEqual({ type: 'team.broadcast', rid: expect.any(String), team: 'team-a1b2', text: 'Pause' });
    expect(a!.rid).not.toBe(b!.rid);
    local.emit({ type: 'team.broadcast.result', rid: b!.rid, team: 'team-a1b2', reason: 'no live seat' });
    local.emit({ type: 'team.broadcast.result', rid: a!.rid, team: 'team-a1b2', sent: 3 });
    expect(await second).toEqual({ reason: 'no live seat' });
    expect(await first).toEqual({ sent: 3 });
    vi.useFakeTimers();
    try {
      const silent = api.fleet!.broadcastTeam('team-a1b2', 'Allô');
      vi.advanceTimersByTime(4000);
      expect(await silent).toEqual({ reason: 'timeout' });
    } finally { vi.useRealTimers(); }
    const pending = api.fleet!.broadcastTeam('team-a1b2', 'Encore');
    local.set('unreachable');
    expect(await pending).toEqual({ reason: 'offline' });
    expect(await api.fleet!.broadcastTeam('team-a1b2', 'Rien')).toEqual({ reason: 'offline' });
  });
});
