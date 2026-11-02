import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerMessage, Task } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';

function peer() {
  const sent: Array<Record<string, unknown>> = []; let onMsg = (_: ServerMessage) => {}; let onSt = (_: DaemonStatus) => {}; let status: DaemonStatus = 'connecting';
  const client: DaemonClient = { connect() {}, close() {}, send(m) { sent.push(m as never); }, status: () => status, onMessage(fn) { onMsg = fn; return () => {}; }, onStatus(fn) { onSt = fn; return () => {}; } };
  return { client, sent, set(s: DaemonStatus) { status = s; onSt(s); }, emit(m: ServerMessage) { onMsg(m); } };
}
const snap: ServerMessage = { type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.18.0', install: 'npm', systemd: true, routing: true } };
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: 'Implémenter', giver: 'ledge', giverName: 'Ledge', owner: 'ab12', ownerName: 'Otto', state: 'open', at: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z', log: [], ...extra });
function setup() {
  const local = peer();
  const api = createFleetClient([LOCAL_MACHINE], () => local.client, {});
  api.connect(); local.set('open'); local.emit(snap);
  return { api, local };
}
beforeEach(() => localStorage.clear());

describe('tasks from the local daemon', () => {
  it('Ledge’s tasks are asked for at each local snapshot, and the answers fill the tasks, qualified', () => {
    const { api, local } = setup();
    const lists = () => local.sent.filter(m => m.type === 'task.cmd');
    expect(lists().map(m => [m.by, m.op, m.all])).toEqual([['ledge', 'list', true]]);
    local.emit({ type: 'task.result', rid: lists()[0]!.rid as string, tasks: [task('t000001'), task('t000002', { giver: 'cd34', giverName: 'Pim' })] });
    expect(api.fleet!.tasks().map(t => [t.id, t.giver, t.owner])).toEqual([['t000001', 'ledge', 'local:ab12'], ['t000002', 'local:cd34', 'local:ab12']]);
    local.emit({ type: 'task.updated', task: task('t000001', { state: 'done' }) });
    expect(api.fleet!.tasks()[0]!.state).toBe('done');
    local.emit(snap);
    expect(lists()).toHaveLength(2);
  });

  it('a daemon before 0.17.0, which does not know tasks, is not asked for them', () => {
    const { local } = setup();
    local.sent.length = 0;
    local.emit({ type: 'snapshot', sessions: [], recents: [], daemon: { version: '0.16.2', install: 'npm', systemd: true } });
    local.emit({ type: 'snapshot', sessions: [], recents: [] });
    expect(local.sent.filter(m => m.type === 'task.cmd')).toEqual([]);
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

  it('task commands go to the local daemon, sessions unqualified, Ledge kept', () => {
    const { api, local } = setup();
    api.send({ type: 'task.cmd', rid: 'r', by: 'ledge', op: 'give', to: 'local:ab12', title: 'x' });
    api.send({ type: 'task.cmd', rid: 'r2', by: 'local:ab12', op: 'cancel', task: 't000001' });
    const sent = local.sent.filter(m => m.type !== 'task.cmd' || m.op !== 'list');
    expect(sent).toEqual([
      { type: 'task.cmd', rid: 'r', by: 'ledge', op: 'give', to: 'ab12', title: 'x' },
      { type: 'task.cmd', rid: 'r2', by: 'ab12', op: 'cancel', task: 't000001' }
    ]);
  });
});
