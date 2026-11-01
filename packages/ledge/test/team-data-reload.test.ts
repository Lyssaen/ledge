import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Task, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTasks, tasksJournal } from '../src/daemon/tasks.js';
import { createTeamsLive, teamsJournal } from '../src/daemon/teamsLive.js';

// The daemon's log lines, read here: nothing may say team data was ignored or removed.
const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const T0 = '2026-10-31T08:00:00.000Z';
const sess = (id: string, name: string): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, tmuxSession: `ledge-${id}`,
  state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' });

describe('team data written by Ledge 0.32', () => {
  it('reloads tasks.json and teams-live.json, and logs no "ignored" line', () => {
    logged.length = 0;
    const dir = mkdtempSync(join(tmpdir(), 'ledge-reload-'));
    const task: Task = { id: 't1a2b3c', title: 'Lance les tests', giver: 'otto', giverName: 'Otto', owner: 'pim', ownerName: 'Pim', state: 'taken', at: T0, updatedAt: T0,
      log: [{ at: T0, by: 'Otto', what: 'confiée à Pim' }, { at: T0, by: 'Pim', what: 'prise' }] } as Task;
    const team: Team = { id: 'team-ab12', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', createdAt: T0, updatedAt: T0,
      seats: [{ role: 'lead', sessionId: 'otto' }, { role: 'build', sessionId: 'pim' }] };
    writeFileSync(join(dir, 'tasks.json'), JSON.stringify([task]));
    writeFileSync(join(dir, 'teams-live.json'), JSON.stringify([team]));
    const store = new Store({ journalPath: join(dir, 'j.json') });
    store.upsert(sess('otto', 'Otto')); store.upsert(sess('pim', 'Pim'));

    const tasks = createTasks({ store, mailbox: { notify: () => true }, now: () => T0, journal: tasksJournal(join(dir, 'tasks.json')) });
    const teams = createTeamsLive({ store, journal: teamsJournal(join(dir, 'teams-live.json')), now: () => T0 });
    expect(tasks.all()).toHaveLength(1);
    expect(tasks.all()[0]).toMatchObject({ id: 't1a2b3c', state: 'taken', owner: 'pim' });
    expect(teams.all().filter(t => t.state === 'active')).toHaveLength(1);
    expect(logged.filter(l => /ignored .* were removed/.test(l))).toEqual([]);
    tasks.close(); teams.close();
  });
});
