import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatTurn, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
function fakeTmux(failOn?: (o: NewSession) => boolean): Tmux & { created: NewSession[] } {
  const created: NewSession[] = []; const panes = new Set<string>();
  return {
    created,
    async newSession(o) { if (failOn?.(o)) throw new Error('tmux: no server'); created.push(o); panes.add(o.name); },
    async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let work: string; let answer: string | undefined;
const role = (id: string, front: string, prompt = `Tu es ${id}.`) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\n${prompt}\n`); };
async function start(failOn?: (o: NewSession) => boolean) {
  store = new Store();
  tmux = fakeTmux(failOn);
  srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env, ...(answer ? { FAKE_ANSWER: answer } : {}) }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
}
async function client(): Promise<Client> { const c = await connect({ port: srv.port }); await c.next('snapshot'); return c; }

beforeEach(async () => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-teams-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  answer = undefined;
  role('lead', 'label: Chef');
  role('build', 'label: Build\nmodel: opus\nautonomy: edits');
  role('review', 'label: Relecteur\ntool: codex\neffort: high\nautonomy: auto');
});
afterEach(async () => { await srv.close(); });

describe('roles and teams over the protocol', () => {
  it('roles.list answers the roles and templates of a folder, with the files skipped', async () => {
    await start();
    mkdirSync(join(process.env.LEDGE_HOME!, 'teams'));
    writeFileSync(join(process.env.LEDGE_HOME!, 'teams', 'workshop.yaml'), 'name: workshop\nseats:\n  - { role: lead }\n  - { role: build }\n');
    role('bad', 'tool: vim');
    const c = await client();
    c.send({ type: 'roles.list', cwd: work, requestId: 'q1' });
    const r = await c.next('roles.listing');
    expect(r.requestId).toBe('q1');
    expect(r.roles.map(x => x.id)).toEqual(['build', 'lead', 'review']);
    expect(r.templates.map(t => t.id)).toEqual(['workshop']);
    expect(r.problems).toEqual([{ path: expect.stringContaining('bad.md'), reason: expect.stringMatching(/^tool/) }]);
    await c.close();
  });

  it('session.launch with a role: its env, its model and autonomy, its record; an unknown role is refused', async () => {
    await start();
    const c = await client();
    c.send({ type: 'session.launch', tool: 'claude', cwd: work, role: 'build' });
    const { id } = await c.next('session.launched');
    expect(store.get(id)).toMatchObject({ role: 'build', roleLabel: 'Build', model: 'opus', autonomy: 'edits' });
    expect(tmux.created[0]!.env).toMatchObject({ LEDGE_ROLE: 'build' });
    expect(tmux.created[0]!.command).toEqual(expect.arrayContaining(['--model', 'opus', '--permission-mode', 'acceptEdits']));
    c.send({ type: 'session.launch', tool: 'claude', cwd: work, role: 'ops' });
    expect((await c.next('error')).message).toContain('rôle inconnu : ops');
    await c.close();
  });

  it('team.launch: a live team, every seat spawned with its role and team, broadcast to the fronts', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'ledge-roles', seats: [{ role: 'lead' }, { role: 'build' }, { role: 'review' }] });
    const { team } = await c.next('team.launched', 5000);
    expect(team).toMatchObject({ name: 'ledge-roles', state: 'active', cwd: work });
    expect(team.seats.map(s => s.role)).toEqual(['lead', 'build', 'review']);
    expect(team.seats.every(s => s.sessionId)).toBe(true);
    const seats = team.seats.map(s => store.get(s.sessionId!)!);
    expect(seats.map(s => [s.role, s.team, s.tool])).toEqual([['lead', team.id, 'claude'], ['build', team.id, 'claude'], ['review', team.id, 'codex']]);
    expect(tmux.created.map(o => o.env.LEDGE_TEAM)).toEqual([team.id, team.id, team.id]);
    expect(tmux.created[2]!.command).toEqual(expect.arrayContaining(['--ask-for-approval', 'never', '--sandbox', 'workspace-write']));
    // A late client gets the teams right after the projects.
    const late = await connect({ port: srv.port });
    expect((await late.next('teams')).teams.map(t => t.id)).toEqual([team.id]);
    await late.close(); await c.close();
  });

  it('team.launch refuses an unknown role before spawning anything; a seat that fails leaves the others', async () => {
    await start(o => o.env.LEDGE_ROLE === 'review');
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, seats: [{ role: 'lead' }, { role: 'qa' }] });
    expect(await c.next('team.failed')).toEqual({ type: 'team.failed', rid: 'r1', reason: 'rôle inconnu : qa (écris .ledge/roles/<id>.md)' });
    expect(tmux.created).toEqual([]);
    c.send({ type: 'team.launch', rid: 'r2', cwd: work, seats: [{ role: 'lead' }, { role: 'review' }, { role: 'build' }] });
    const failed = await c.next('team.failed', 5000);
    expect(failed.reason).toBe('@review : tmux: no server');
    expect(failed.team!.seats.map(s => [s.role, !!s.sessionId])).toEqual([['lead', true], ['review', false], ['build', false]]);
    expect(tmux.created).toHaveLength(1);
    await c.close();
  });

  it('team.join tells the session its team at its next free moment; @role messages resolve in the sender’s team', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, seats: [{ role: 'lead' }, { role: 'build' }] });
    const { team } = await c.next('team.launched', 5000);
    const lead = team.seats[0]!.sessionId!; const build = team.seats[1]!.sessionId!;
    c.send({ type: 'session.launch', tool: 'claude', cwd: work });
    const { id: mila } = await c.next('session.launched');
    c.send({ type: 'team.join', team: team.id, session: mila, role: 'review' });
    await until(() => store.get(mila)?.team === team.id);
    expect(store.get(mila)).toMatchObject({ role: 'review', roleLabel: 'Relecteur' });
    c.send({ type: 'team.join', team: team.id, session: mila, role: 'nope' });
    expect((await c.next('error')).message).toContain('rôle inconnu : nope');
    c.send({ type: 'session.message', rid: 'm1', from: lead, to: '@qa', text: 'hello' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('personne ne tient @qa') });
    c.send({ type: 'session.message', rid: 'm2', from: lead, to: '@build', text: 'hello' });
    expect((await c.next('message.ack')).outcome).not.toBe('refused');
    void build;
    c.send({ type: 'team.leave', team: team.id, session: mila });
    await until(() => store.get(mila)?.team === undefined);
    c.send({ type: 'team.dissolve', team: team.id });
    await until(() => store.get(lead)?.team === undefined);
    await c.close();
  });

  it('the chat’s team card launches its team, then its task cards give to @role and follow their task', async () => {
    answer = `Je propose une équipe.\n\`\`\`ledge-team\n{"cwd": "${work}", "name": "ledge-roles", "seats": [{"role": "lead"}, {"role": "build"}]}\n\`\`\`\n\`\`\`ledge-task\n{"to": "@build", "title": "Implémenter les rôles", "text": "roles.ts"}\n\`\`\``;
    await start();
    const c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe' });
    const done = await c.next('chat.done', 10_000);
    expect(done.team).toMatchObject({ name: 'ledge-roles', cwd: work, seats: [{ role: 'lead', label: 'Chef', tool: 'claude' }, { role: 'build', label: 'Build', model: 'opus', autonomy: 'edits' }] });
    expect(done.tasks).toEqual([{ to: '@build', title: 'Implémenter les rôles', text: 'roles.ts' }]);
    // Before the team: the task card waits.
    c.send({ type: 'task.cmd', rid: 't0', by: 'ledge', op: 'give', qid: 'q1', row: 0 });
    expect((await c.next('task.result')).reason).toBe("active une fois l'équipe lancée");
    c.send({ type: 'team.launch', rid: 'r1', qid: 'q1' });
    const { team } = await c.next('team.launched', 5000);
    const turnOf = (h: ChatTurn[]) => h.find(t => t.qid === 'q1')!;
    // The history queued meanwhile is read until the card says it is launched.
    await until(async () => turnOf((await c.next('chat.history')).turns)?.team?.teamId === team.id);
    c.send({ type: 'team.launch', rid: 'r2', qid: 'q1' });
    expect((await c.next('team.failed')).reason).toBe('équipe déjà lancée');
    c.send({ type: 'task.cmd', rid: 't1', by: 'ledge', op: 'give', qid: 'q1', row: 0 });
    const given = await c.next('task.result');
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    expect(given.task).toMatchObject({ giver: 'ledge', owner: build, team: team.id, title: 'Implémenter les rôles' });
    expect((await c.next('task.updated')).task.id).toBe(given.task!.id);
    // The owner takes it: the card follows.
    c.send({ type: 'task.cmd', rid: 't2', by: build, op: 'take', task: given.task!.id });
    await c.next('task.result');
    await until(async () => turnOf((await c.next('chat.history')).turns)?.tasks?.[0]?.state === 'taken');
    // « Enregistrer » writes the ad hoc team as a template, and the card says so.
    c.send({ type: 'team.save', rid: 's1', qid: 'q1', name: 'ledge-roles', seats: [{ role: 'lead' }, { role: 'build' }] });
    const saved = await c.next('team.saved');
    expect(existsSync(saved.path!)).toBe(true);
    expect(readFileSync(saved.path!, 'utf8')).toContain('role: build');
    await c.close();
  });

  it('a card with an unknown role, or a task to an unknown session, gives no card', async () => {
    answer = `\`\`\`ledge-team\n{"cwd": "${work}", "seats": [{"role": "ops"}]}\n\`\`\`\n\`\`\`ledge-task\n{"to": "zzzz", "title": "x"}\n\`\`\``;
    await start();
    const c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe' });
    const done = await c.next('chat.done', 10_000);
    expect(done.team).toBeUndefined();
    expect(done.tasks).toBeUndefined();
    await c.close();
  });

  it('a seat resumed keeps its role and team; team.resume brings a resting team back', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, seats: [{ role: 'build' }] });
    const { team } = await c.next('team.launched', 5000);
    const id = team.seats[0]!.sessionId!;
    store.upsert({ ...store.get(id)!, state: 'exited', exitedAt: new Date().toISOString() } as Session);
    await until(() => true);
    c.send({ type: 'team.resume', team: team.id });
    await until(() => store.get(id)?.state === 'starting');
    expect(store.get(id)).toMatchObject({ role: 'build', team: team.id, autonomy: 'edits' });
    expect(tmux.created.at(-1)!.env).toMatchObject({ LEDGE_ROLE: 'build', LEDGE_TEAM: team.id });
    expect(tmux.created.at(-1)!.command).toEqual(expect.arrayContaining(['--resume', '--permission-mode', 'acceptEdits']));
    await c.close();
  });
});
