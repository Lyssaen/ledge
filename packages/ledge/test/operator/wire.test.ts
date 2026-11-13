import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OperatorNotice, Goal, HumanAsk, OpenRigState, Task } from '@ledge/protocol';
import { Store } from '../../src/daemon/store.js';
import type { ChatDeps } from '../../src/chat/service.js';
import { wireOperator, type OperatorWired } from '../../src/operator/index.js';

vi.mock('../../src/log.js', () => ({ log: () => {} }));

const AT = '2026-11-13T10:00:00.000Z';
const task = (id: string): Task => ({ id, title: `Task ${id}`, giver: 'x', giverName: 'X', owner: 'o', ownerName: 'Pim', state: 'taken', at: AT, updatedAt: new Date().toISOString(), log: [] } as Task);
const ask = (id: string): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'max', rig: 'kernel', role: null }, summary: 'Which team?', body: '', bodyTruncated: false, detail: null,
  evidenceRef: null, createdAt: AT, updatedAt: AT, questions: []
});
const rigState = (status: Record<string, string>): OpenRigState => ({
  installed: true, rigs: Object.entries(status).map(([name, s]) => ({ id: name, name, status: s, lifecycleState: s, seats: 0, running: 0, attention: 0, uptime: null, snapshot: null, nodes: [] }))
} as unknown as OpenRigState);

let wired: OperatorWired | undefined;
afterEach(() => { wired?.stop(); wired = undefined; });

function setup(tasks: Task[], onNotices?: (n: OperatorNotice[]) => void) {
  const home = mkdtempSync(join(tmpdir(), 'ledge-wire-'));
  const store = new Store({ journalPath: join(home, 'j.json') });
  const chatDeps: ChatDeps = { store, tmux: { async capture() { return null; } } as never, home, env: async () => ({ ...process.env }) };
  let list = tasks;
  wired = wireOperator({
    journalPath: join(home, 'ledge.sqlite'), machine: 'm', threads: { all: () => [], emitterOf: () => undefined }, store,
    tasks: () => list, contextNear: () => 0.9, tool: () => 'claude', chatDeps, ...(onNotices ? { onNotices } : {})
  });
  wired.start();
  return { w: wired, setTasks: (t: Task[]) => { list = t; } };
}

describe('wireOperator notices', () => {
  it('tells the notices at start and again when the rig asks change', () => {
    const told: OperatorNotice[][] = [];
    const { w } = setup([], n => told.push(n));
    expect(told).toEqual([[]]);
    w.asksChanged({ asks: [{ ...ask('q1'), priority: 'urgent' }] });
    expect(told.at(-1)!.map(n => n.id)).toEqual(['rig.ask:q1']);
    w.asksChanged({ asks: [] });
    expect(told.at(-1)).toEqual([]);
  });
});

describe('wireOperator', () => {
  it('the first reads of tasks and asks are baselines, not events', () => {
    const stale = { ...task('old'), updatedAt: '2020-01-01T00:00:00.000Z' };
    const { w, setTasks } = setup([task('a'), stale]);
    w.tasksChanged();
    w.asksChanged({ asks: [ask('q1')] });
    expect(w.journal.since(0)).toEqual([]);
    w.asksChanged({ asks: [ask('q1'), ask('q2')] });
    setTasks([task('a'), stale, task('b')]);
    w.tasksChanged();
    expect(w.journal.since(0).map(e => `${e.kind}:${e.subjectId}`)).toEqual(['rig.ask:q2', 'task.opened:b']);
  });

  it('an ask that leaves the channel is settled, unless the list is partial', () => {
    const { w } = setup([]);
    w.asksChanged({ asks: [] });
    w.asksChanged({ asks: [ask('q1'), ask('q2')] });
    w.asksChanged({ asks: [ask('q2')], partial: true });
    expect(w.journal.open().map(e => e.subjectId)).toEqual(['q1', 'q2']);
    w.asksChanged({ asks: [ask('q2')] });
    expect(w.journal.open().map(e => e.subjectId)).toEqual(['q2']);
  });

  it('a list read while the channel is not ready neither settles nor re-records the asks', () => {
    const { w } = setup([]);
    w.asksChanged({ channel: { state: 'ready' }, asks: [] });
    w.asksChanged({ channel: { state: 'ready' }, asks: [ask('q1')] });
    w.asksChanged({ channel: { state: 'openrig_stopped' }, asks: [] });
    w.asksChanged({ channel: { state: 'ready' }, asks: [ask('q1')] });
    expect(w.journal.since(0).map(e => e.subjectId)).toEqual(['q1']);
    expect(w.journal.open().map(e => e.subjectId)).toEqual(['q1']);
  });

  it('an ask answered through Ledge is settled where it was answered', () => {
    const { w } = setup([]);
    w.asksChanged({ asks: [] });
    w.asksChanged({ asks: [ask('q1'), ask('q2')] });
    w.askAnswered('q1', 'phone', { ok: true, outcome: 'answered' });
    w.askAnswered('q2', 'desktop', { ok: true, outcome: 'recorded' });
    expect(w.journal.since(0).find(e => e.subjectId === 'q1')!.payload.where).toBe('phone');
    expect(w.journal.open().map(e => e.subjectId)).toEqual(['q2']);
  });

  it('goals: the first list is the baseline, a new proposal from Max is an event', () => {
    const { w } = setup([]);
    const goal = { goalId: 'g-12345678', qitemId: 'q', text: 'Port', folder: null, sentAt: AT, to: 'max@kernel', state: 'taken', proposal: null, question: null, trail: [], current: null } as Goal;
    w.goalsChanged({ goals: [goal] });
    expect(w.journal.since(0)).toEqual([]);
    w.goalsChanged({ goals: [{ ...goal, state: 'proposed', proposal: { askId: 'a', team: null, text: 'Two devs', answer: null, answeredAt: null } }] });
    expect(w.journal.since(0).map(e => `${e.kind}:${e.subjectId}`)).toEqual(['rig.goal_update:g-12345678']);
  });

  it('a rig Ledge stopped itself is not reported, another rig that falls is', () => {
    const { w } = setup([]);
    w.rigsRead(rigState({ kernel: 'running', other: 'running' }));
    w.ledgeRigAct({ kind: 'rig.stop', rig: 'kernel' });
    w.rigsRead(rigState({ kernel: 'stopped', other: 'stopped' }));
    expect(w.journal.since(0).map(e => `${e.kind}:${e.subjectId}`)).toEqual(['rig.state:other']);
  });

  it('the journal getter gives what follows the cursor and what still waits', () => {
    const { w } = setup([]);
    w.asksChanged({ asks: [] });
    w.asksChanged({ asks: [ask('q1')] });
    w.operator.record({ kind: 'session.finished', subjectKind: 'session', subjectId: 's', subjectName: 'S', urgency: 'grouped', payload: {} });
    const last = w.journal.since(0).at(-1)!.id;
    w.operator.read('desktop', last);
    expect(w.journalFor('desktop').map(e => e.subjectId)).toEqual(['q1']);
    expect(w.journalFor('device:x').map(e => e.subjectId)).toEqual(['q1', 's']);
  });
});
