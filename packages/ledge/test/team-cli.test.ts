import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { Tmux } from '../src/tmux.js';
import { teamArgs, runTeam } from '../src/cli/team.js';
import { closeArgs, resultLine, runClose } from '../src/cli/action.js';

// `ledge team` and `ledge close` (#93): argv against the registry's args, then `action.run` to the daemon.
describe('teamArgs', () => {
  it('keeps up and list, and takes ad hoc seats for up', () => {
    expect(teamArgs(['up', 'atelier', '--cwd', '/w'])).toEqual({ op: 'up', template: 'atelier', cwd: '/w' });
    expect(teamArgs(['up', '--seat', 'lead', '--seat', 'review:codex', '--name', 'api'])).toEqual({ op: 'up', seats: [{ role: 'lead' }, { role: 'review', tool: 'codex' }], name: 'api' });
    expect(teamArgs(['up', 'atelier', '--seat', 'lead'])).toBeUndefined();
    expect(teamArgs(['up', '--seat', 'lead', '--seat', 'lead'])).toBeUndefined();
    expect(teamArgs(['up', '--seat', 'lead:vim'])).toBeUndefined();
    expect(teamArgs(['up'])).toBeUndefined();
    expect(teamArgs(['list', '--json'])).toEqual({ op: 'list', json: true });
  });

  it('turns each verb into a registry action, its args checked by the registry', () => {
    expect(teamArgs(['join', 'api', 'Nova', '@dev-back'])).toEqual({ op: 'run', action: 'team.join', args: { team: 'api', session: 'Nova', role: 'dev-back' } });
    expect(teamArgs(['leave', 'api', 'Nova', '--json'])).toEqual({ op: 'run', action: 'team.leave', args: { team: 'api', session: 'Nova' }, json: true });
    expect(teamArgs(['resume', 'team-3fa2'])).toEqual({ op: 'run', action: 'team.resume', args: { team: 'team-3fa2' } });
    expect(teamArgs(['dissolve', 'api', '--close-sessions', '--yes'])).toEqual({ op: 'run', action: 'team.dissolve', args: { team: 'api' }, closeSessions: true, yes: true });
    expect(teamArgs(['save', 'api', 'atelier'])).toEqual({ op: 'run', action: 'team.save', args: { team: 'api', name: 'atelier' } });
    expect(teamArgs(['join', 'api', 'Nova', '@Dev Back'])).toBeUndefined();
    expect(teamArgs(['join', 'api', 'Nova'])).toBeUndefined();
    expect(teamArgs(['leave', 'api', 'Nova', '--close-sessions'])).toBeUndefined();
    expect(teamArgs(['resume', 'api', '--force'])).toBeUndefined();
  });

  it('closeArgs: one session or more', () => {
    expect(closeArgs(['Nova', 'Bix', '--json'])).toEqual({ sessions: ['Nova', 'Bix'], json: true });
    expect(closeArgs([])).toBeUndefined();
    expect(closeArgs(['--yes'])).toBeUndefined();
  });
});

describe('resultLine', () => {
  const row = { action: 'team.dissolve' as const, args: { team: 'team-3fa2' }, summary: 'Dissoudre l\'équipe **api**', risk: 'destructive' as const };
  it('says what was done, what to confirm, why not', () => {
    expect(resultLine({ action: 'team.dissolve', row })).toEqual({ line: 'fait : Dissoudre l\'équipe api', code: 0 });
    expect(resultLine({ action: 'team.save', row: { ...row, action: 'team.save', summary: 'Enregistrer' }, path: '/h/a.yaml' })).toEqual({ line: 'fait : Enregistrer\nmodèle écrit : /h/a.yaml', code: 0 });
    expect(resultLine({ action: 'team.dissolve', row, reason: 'destructive: confirm it', code: 'confirm_required' }).line).toBe('Dissoudre l\'équipe api : irréversible ; relance avec --yes pour confirmer');
    expect(resultLine({ action: 'team.resume', reason: 'unknown team zz', code: 'refused' })).toEqual({ line: 'refusé : unknown team zz', code: 1 });
    expect(resultLine({ action: 'team.resume', row, reason: 'boom', code: 'failed' })).toEqual({ line: 'échec : boom', code: 1 });
    expect(JSON.parse(resultLine({ action: 'team.resume', reason: 'x', code: 'refused' }, true).line)).toEqual({ ok: false, action: 'team.resume', reason: 'x', code: 'refused' });
  });
});

describe('ledge team and ledge close against a daemon', () => {
  let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string;
  const tmux = (): Tmux => {
    const panes = new Set<string>();
    return {
      async newSession(o) { panes.add(o.name); }, async sendText() {}, async sendKeys() {}, async capture() { return ''; },
      async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
      async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
    };
  };
  const user = () => ({ port: srv.port, cwd: work, env: {} });
  beforeEach(async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-cli-'));
    work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
    mkdirSync(join(process.env.LEDGE_HOME, 'roles'));
    for (const r of ['lead', 'build']) writeFileSync(join(process.env.LEDGE_HOME, 'roles', `${r}.md`), `---\nlabel: ${r}\n---\nTu es ${r}.\n`);
    store = new Store();
    srv = await startServer({ store, tmux: tmux(), port: 0, close: { freeMs: 50, exitMs: 50 }, agentEnv: async () => ({ ...process.env }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
  });
  afterEach(async () => { await srv.close(); });

  it('up with ad hoc seats, list --json, a destructive verb asked again, refused to an agent, then dissolved with its sessions closed', async () => {
    const up = await runTeam(['up', '--seat', 'lead', '--seat', 'build', '--name', 'api'], user());
    expect(up).toMatchObject({ code: 0, line: expect.stringContaining('équipe api lancée') });
    const listed = JSON.parse((await runTeam(['list', '--json'], user())).line);
    const team = listed.teams.find((t: { name: string }) => t.name === 'api');
    expect(team.seats.map((s: { role: string; session?: { tool: string } }) => [s.role, s.session?.tool])).toEqual([['lead', 'claude'], ['build', 'claude']]);
    const [lead, build] = team.seats.map((s: { sessionId: string }) => s.sessionId) as [string, string];

    expect(await runTeam(['dissolve', 'api'], user())).toEqual({ line: 'Dissoudre l\'équipe api : irréversible ; relance avec --yes pour confirmer', code: 1 });
    expect(await runTeam(['dissolve', 'api', '--yes'], { ...user(), env: { LEDGE_SESSION: lead } })).toMatchObject({ code: 1, line: expect.stringMatching(/^refusé : une session agent/) });
    const done = await runTeam(['dissolve', 'api', '--yes', '--close-sessions'], user());
    expect(done.code).toBe(0);
    expect(done.line.split('\n')[0]).toBe('fait : Dissoudre l\'équipe api');
    expect(store.get(lead)!.state).toBe('exited');
    expect(store.get(build)!.state).toBe('exited');
  });

  it('ledge close by a session closes another one, never itself, and says so in JSON', async () => {
    await runTeam(['up', '--seat', 'lead', '--seat', 'build', '--name', 'api'], user());
    const [lead, build] = store.all().map(s => s.id) as [string, string];
    const env = { LEDGE_SESSION: lead };
    expect(await runClose([store.get(lead)!.name], { port: srv.port, env })).toMatchObject({ code: 1, line: expect.stringContaining('cannot close itself') });
    const r = await runClose([store.get(build)!.name, '--json'], { port: srv.port, env });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, action: 'session.close', row: { args: { session: build } } });
    expect(store.get(build)!.state).toBe('exited');
  });

  it('a verb with no daemon says how to start one', async () => {
    expect(await runTeam(['resume', 'api'], { port: 1, env: {} })).toMatchObject({ code: 1, line: expect.stringContaining('daemon not running') });
  });
});
