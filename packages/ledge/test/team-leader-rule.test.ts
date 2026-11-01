import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Team } from '@ledge/protocol';
import { startDaemon } from '../src/daemon/index.js';
import { ensureLeaderRole, leaderIssue } from '../src/daemon/leader.js';
import { listRoles } from '../src/daemon/roles.js';
import { listTemplates, parseTemplate } from '../src/daemon/teams.js';
import { ensureLedgeDir, paths } from '../src/paths.js';
import { connect } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';

const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/log.js', () => ({ log: (line: string) => { logged.push(line); } }));

const ISSUE = 'il manque le siège @leader : une équipe a exactement un lead (ajoute un siège de rôle leader)';
const T0 = '2026-11-01T08:00:00.000Z';
const team: Team = { id: 'team-ab12', name: 'api', project: 'api', machine: 'local', cwd: '/w/api', state: 'active', createdAt: T0, updatedAt: T0,
  seats: [{ role: 'leader', sessionId: 'otto' }, { role: 'dev', sessionId: 'pim' }] };

describe('a team has exactly one lead', () => {
  const prior = process.env.LEDGE_HOME;
  afterEach(() => { if (prior === undefined) delete process.env.LEDGE_HOME; else process.env.LEDGE_HOME = prior; });

  it('leaderIssue: null with a leader seat, the exact reason without', () => {
    expect(leaderIssue([{ role: 'dev' }, { role: 'leader' }])).toBeNull();
    expect(leaderIssue([{ role: 'dev' }])).toBe(ISSUE);
  });

  it('parseTemplate refuses a template with no leader; listTemplates reports it in problems, a leader template loads', () => {
    expect(parseTemplate('api', 'name: api\nseats:\n  - role: dev\n', 'home', '/p')).toBe(ISSUE);
    expect(parseTemplate('api', 'name: api\nseats:\n  - role: leader\n  - role: dev\n', 'home', '/p')).toMatchObject({ id: 'api' });
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-lead-'));
    mkdirSync(join(process.env.LEDGE_HOME, 'teams'));
    writeFileSync(join(process.env.LEDGE_HOME, 'teams', 'bad.yaml'), 'name: bad\nseats:\n  - role: dev\n');
    writeFileSync(join(process.env.LEDGE_HOME, 'teams', 'good.yaml'), 'name: good\nseats:\n  - role: leader\n  - role: dev\n');
    const r = listTemplates();
    expect(r.templates.map(t => t.id)).toEqual(['good']);
    expect(r.problems).toEqual([expect.objectContaining({ reason: ISSUE })]);
  });

  it('the daemon refuses team.launch, template.write, team.save and team.compose without a leader', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-lead-'));
    await ensureLedgeDir();
    writeFileSync(paths().teams, JSON.stringify([team]));
    const tmux = { async listSessions() { return []; } } as unknown as Tmux;
    const d = await startDaemon({ port: 0, tmux });
    const c = await connect({ port: d.port });
    try {
      const work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
      c.send({ type: 'team.launch', rid: 'l1', cwd: work, name: 'api', seats: [{ role: 'dev' }] });
      expect(await c.next('team.failed', 3000)).toMatchObject({ rid: 'l1', reason: ISSUE });

      c.send({ type: 'template.write', rid: 'w1', scope: 'home', name: 'Eq', seats: [{ role: 'dev' }], base: null } as never);
      expect(await c.next('definition.result', 3000)).toMatchObject({ rid: 'w1', code: 'invalid', reason: ISSUE });
      expect(existsSync(join(process.env.LEDGE_HOME!, 'teams', 'eq.yaml'))).toBe(false);

      c.send({ type: 'team.save', rid: 's1', name: 'duo', seats: [{ role: 'dev' }] } as never);
      expect(await c.next('team.saved', 3000)).toMatchObject({ rid: 's1', reason: ISSUE });
      expect(existsSync(join(process.env.LEDGE_HOME!, 'teams', 'duo.yaml'))).toBe(false);

      c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'dev' }] });
      const changed = await c.next('team.changed', 3000);
      expect(changed).toMatchObject({ rid: 'c1', reason: ISSUE });
      expect(changed.team).toBeUndefined();
      expect(JSON.parse(readFileSync(paths().teams, 'utf8')).find((t: Team) => t.id === team.id).seats.map((s: { role: string }) => s.role)).toEqual(['leader', 'dev']);
      // A template ignored for its missing lead is said ignored, and why, never « aucun modèle » (I3).
      mkdirSync(join(process.env.LEDGE_HOME!, 'teams'), { recursive: true });
      writeFileSync(join(process.env.LEDGE_HOME!, 'teams', 'old.yaml'), 'name: old\nseats:\n  - role: dev\n');
      c.send({ type: 'team.launch', rid: 'l2', cwd: work, template: 'old' });
      expect(await c.next('team.failed', 3000)).toMatchObject({ rid: 'l2', reason: `le modèle old est ignoré : ${ISSUE}` });
      c.send({ type: 'team.launch', rid: 'l3', cwd: work, template: 'nope' });
      expect(await c.next('team.failed', 3000)).toMatchObject({ rid: 'l3', reason: "aucun modèle d'équipe nope (.ledge/teams/nope.yaml)" });
      // The launch created no team.
      expect(JSON.parse(readFileSync(paths().teams, 'utf8'))).toHaveLength(1);
      // The daemon seeded the default leader role on startup.
      expect(existsSync(join(process.env.LEDGE_HOME!, 'roles', 'leader.md'))).toBe(true);
    } finally { await c.close(); await d.stop(); }
  });

  it('an unwritable roles folder costs the default lead, never the daemon: it starts, says so in one line', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-lead-'));
    await ensureLedgeDir();
    // A file where the roles folder should be: the seed cannot write there.
    writeFileSync(join(process.env.LEDGE_HOME, 'roles'), '');
    logged.length = 0;
    const tmux = { async listSessions() { return []; } } as unknown as Tmux;
    const d = await startDaemon({ port: 0, tmux });
    try {
      expect(d.port).toBeGreaterThan(0);
      expect(logged.filter(l => l.startsWith('default leader role not written: '))).toHaveLength(1);
    } finally { await d.stop(); }
  });

  it('ensureLeaderRole seeds the role once, and a deleted file does not come back', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'ledge-seed-')), 'roles');
    expect(ensureLeaderRole(dir)).toBe(true);
    expect(readFileSync(join(dir, 'leader.md'), 'utf8')).toContain('Tu mènes l\'équipe.');
    process.env.LEDGE_HOME = join(dir, '..');
    expect(listRoles().roles.find(r => r.id === 'leader')).toMatchObject({ label: 'Lead', tool: 'claude' });
    expect(ensureLeaderRole(dir)).toBe(false);
    rmSync(join(dir, 'leader.md'));
    expect(ensureLeaderRole(dir)).toBe(false);
    expect(existsSync(join(dir, 'leader.md'))).toBe(false);
  });
});
