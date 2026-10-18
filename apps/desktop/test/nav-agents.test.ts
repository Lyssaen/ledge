import { describe, it, expect } from 'vitest';
import type { Projects, Session } from '@ledge/protocol';
import { projectOf } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { activeCount, dotOf, mainOrder, searchSessions } from '../src/nav/agents';

const projects: Projects = { projects: [
  { id: 'b', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/pay' }] },
  { id: 'a', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }
], rules: [] };
const s = (id: string, cwd: string, startedAt: string, extra: Partial<Session> = {}) => fakeSession(id, { id: `local:${id}`, machineId: 'local', cwd, startedAt, ...extra });
const list = [s('kit', '/tmp', '2026-10-16T08:00:00.000Z'), s('otto', '/w/ledge', '2026-10-16T09:00:00.000Z'), s('nova', '/w/pay/api', '2026-10-16T10:00:00.000Z'), s('rio', '/w/ledge', '2026-10-16T07:00:00.000Z')];

describe('nav agents', () => {
  it('orders by project order, then Sans projet, then start time', () => {
    expect(mainOrder(list, projects).map(x => x.id)).toEqual(['local:nova', 'local:rio', 'local:otto', 'local:kit']);
    expect(mainOrder(list, null).map(x => x.id)).toEqual(['local:rio', 'local:kit', 'local:otto', 'local:nova']);
  });
  it('breaks start-time ties by id and survives an invalid start time', () => {
    const same = '2026-10-16T09:00:00.000Z';
    const tied = [s('zed', '/w/ledge', same), s('amy', '/w/ledge', same)];
    expect(mainOrder(tied, projects).map(x => x.id)).toEqual(['local:amy', 'local:zed']);
    const bad = [s('zed', '/w/ledge', 'nope'), s('amy', '/w/ledge', same), s('bob', '/w/ledge', 'nope')];
    const a = mainOrder(bad, projects).map(x => x.id);
    expect(a).toEqual(mainOrder([...bad].reverse(), projects).map(x => x.id));
    expect(a).toEqual(['local:bob', 'local:zed', 'local:amy']);
  });
  it('searches name, task, harness, machine and project without accents or case', () => {
    const named = (x: Session) => (projectOf(x, projects) === 'a' ? 'Ledge' : projectOf(x, projects) === 'b' ? 'Payment Service' : 'Sans projet');
    const one = [s('otto', '/w/ledge', '2026-10-16T09:00:00.000Z', { name: 'Otto', topic: 'Préparer la migration', tool: 'codex', machineName: 'Dev SSH' })];
    for (const q of ['otto', 'MIGRATION', 'preparer', 'codex', 'dev ssh', 'ledge']) expect(searchSessions(one, q, named)).toHaveLength(1);
    expect(searchSessions(one, 'claude', named)).toHaveLength(0);
    expect(searchSessions(list, '', named)).toEqual(list);
  });
  it('gives each session its sidebar dot', () => {
    expect(['working', 'waiting_permission', 'waiting_input', 'exited', 'idle', 'error', 'starting'].map(state => dotOf(fakeSession('x', { state: state as Session['state'] }))))
      .toEqual(['working', 'approval', 'question', 'done', 'done', 'error', 'working']);
    expect(dotOf(fakeSession('x', { state: 'waiting_permission', offline: true }))).toBe('offline');
  });
  it('counts the active main agents', () => {
    expect(activeCount([fakeSession('a'), fakeSession('b', { state: 'exited' }), fakeSession('c', { offline: true }), fakeSession('d', { state: 'idle' })])).toBe(2);
  });
});
