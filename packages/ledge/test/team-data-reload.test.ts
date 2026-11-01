import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Task, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startDaemon } from '../src/daemon/index.js';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

// The daemon's log lines (every module), read here: nothing may say team data was ignored or removed.
const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const T0 = '2026-10-31T08:00:00.000Z';
const sess = (id: string, name: string): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, tmuxSession: `ledge-${id}`,
  state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' });

describe('team data written by Ledge 0.32', () => {
  const prior = process.env.LEDGE_HOME;
  afterEach(() => { if (prior === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prior; });

  it('the daemon startup reloads tasks.json and teams-live.json, and logs no "ignored" line', async () => {
    logged.length = 0;
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-reload-'));
    await ensureLedgeDir();
    const task: Task = { id: 't1a2b3c', title: 'Lance les tests', giver: 'otto', giverName: 'Otto', owner: 'pim', ownerName: 'Pim', state: 'taken', at: T0, updatedAt: T0,
      log: [{ at: T0, by: 'Otto', what: 'confiée à Pim' }, { at: T0, by: 'Pim', what: 'prise' }] } as Task;
    const team: Team = { id: 'team-ab12', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', createdAt: T0, updatedAt: T0,
      seats: [{ role: 'lead', sessionId: 'otto' }, { role: 'build', sessionId: 'pim' }] };
    const seed = new Store();
    seed.upsert(sess('otto', 'Otto')); seed.upsert(sess('pim', 'Pim'));
    await seed.save();
    writeFileSync(paths().tasks, JSON.stringify([task]));
    writeFileSync(paths().teams, JSON.stringify([team]));
    const tmux = { async listSessions() { return ['ledge-otto', 'ledge-pim']; } } as unknown as Tmux;
    const d = await startDaemon({ port: 0, tmux });
    try {
      const c = await connect({ port: d.port });
      try {
        const teams = (await c.next('teams')).teams;
        expect(teams.filter(t => t.state === 'active').map(t => t.id)).toEqual(['team-ab12']);
        c.send({ type: 'task.cmd', rid: 'l', by: 'ledge', op: 'list', all: true });
        const tasks = (await c.next('task.result', 3000)).tasks!;
        expect(tasks).toHaveLength(1);
        expect(tasks[0]).toMatchObject({ id: 't1a2b3c', state: 'taken', owner: 'pim' });
      } finally { await c.close(); }
    } finally { await d.stop(); }
    expect(logged.filter(l => /ignored .* were removed/.test(l))).toEqual([]);
  });
});
