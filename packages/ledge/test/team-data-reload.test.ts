import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ask, Session, Task, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startDaemon } from '../src/daemon/index.js';
import { resolveRoleAddress, seatView } from '../src/daemon/seat.js';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

// The daemon's log lines (every module), read here: nothing may say team data was ignored or removed.
const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const T0 = '2026-10-31T08:00:00.000Z';
const sess = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`, tmuxSession: `ledge-${id}`,
  state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

const task: Task = { id: 't1a2b3c', title: 'Lance les tests', giver: 'otto', giverName: 'Otto', owner: 'pim', ownerName: 'Pim', state: 'taken', at: T0, updatedAt: T0,
  log: [{ at: T0, by: 'Otto', what: 'confiée à Pim' }, { at: T0, by: 'Pim', what: 'prise' }] } as Task;
const team: Team = { id: 'team-ab12', name: 'ledge-roles', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', createdAt: T0, updatedAt: T0,
  seats: [{ role: 'lead', sessionId: 'otto' }, { role: 'build', sessionId: 'pim' }] };
const ask: Ask = { id: 'a1b2c3d', from: 'nova', fromName: 'Nova', question: 'Quelle base ?', options: 'Postgres\nSQLite', at: T0, state: 'open' };
const seated = (id: string, name: string, role: string) => sess(id, name, { team: 'team-ab12', role, roleLabel: role });

/** A home holding these sessions and the 0.32 team files (and asks, when given), started for real; what a front sees of it. */
async function boot(sessions: Session[], asks: Ask[] = []) {
  logged.length = 0;
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-reload-'));
  await ensureLedgeDir();
  const seed = new Store();
  for (const x of sessions) seed.upsert(x);
  await seed.save();
  writeFileSync(paths().tasks, JSON.stringify([task]));
  writeFileSync(paths().teams, JSON.stringify([team]));
  if (asks.length) writeFileSync(paths().asks, JSON.stringify(asks));
  const tmux = { async listSessions() { return sessions.map(x => x.tmuxSession!); } } as unknown as Tmux;
  const d = await startDaemon({ port: 0, tmux });
  const c = await connect({ port: d.port });
  try {
    const snap = (await c.next('snapshot')).sessions;
    const listed = (await c.next('asks', 3000)).asks;
    const teams = (await c.next('teams')).teams;
    c.send({ type: 'task.cmd', rid: 'l', by: 'ledge', op: 'list', all: true });
    const tasks = (await c.next('task.result', 3000)).tasks!;
    return { snap, teams, tasks, listed };
  } finally { await c.close(); await d.stop(); }
}

describe('team data written by Ledge 0.32', () => {
  const prior = process.env.LEDGE_HOME;
  afterEach(() => { if (prior === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prior; });

  it('the daemon startup reloads a 0.32 home (seats carry their team), and logs no "ignored" line', async () => {
    const r = await boot([seated('otto', 'Otto', 'lead'), seated('pim', 'Pim', 'build')]);
    expect(r.teams.filter(t => t.state === 'active').map(t => t.id)).toEqual(['team-ab12']);
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0]).toMatchObject({ id: 't1a2b3c', state: 'taken', owner: 'pim' });
    expect(r.snap.find(x => x.id === 'pim')).toMatchObject({ team: 'team-ab12', role: 'build' });
    expect(logged.filter(l => /ignored .* were removed/.test(l))).toEqual([]);
    expect(logged.filter(l => /seat @.* rebuilt/.test(l))).toEqual([]);
  });

  it('a home that went through the snapshot daemon (sessions stripped of team and role) puts its seats back at their table; asks stay listed', async () => {
    const r = await boot([sess('otto', 'Otto'), sess('pim', 'Pim'), sess('nova', 'Nova')], [ask]);
    expect(r.snap.find(x => x.id === 'otto')).toMatchObject({ team: 'team-ab12', role: 'lead', roleLabel: 'lead' });
    expect(r.snap.find(x => x.id === 'pim')).toMatchObject({ team: 'team-ab12', role: 'build' });
    expect(seatView('otto', r.snap, r.teams)).toMatchObject({ id: 'team-ab12', members: [{ name: 'Pim', role: 'build' }] });
    expect(resolveRoleAddress('@build', 'otto', r.snap, r.teams)).toEqual({ to: 'Pim' });
    expect(logged.filter(l => /team-ab12 .*seat @(lead|build) rebuilt/.test(l))).toHaveLength(2);
    expect(r.tasks).toHaveLength(1);
    expect(r.listed).toEqual([ask]);
    expect(logged.filter(l => /ignored .* were removed/.test(l))).toEqual([]);
  });
});
