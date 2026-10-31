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
import { runHook } from '../src/cli/hook.js';

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
function fakeTmux(failOn?: (o: NewSession) => boolean): Tmux & { created: NewSession[]; killed: string[]; typed: Array<[string, string]>; gate: { hold?: Promise<void>; held: number } } {
  const created: NewSession[] = []; const killed: string[] = []; const typed: Array<[string, string]> = []; const gate: { hold?: Promise<void>; held: number } = { held: 0 }; const panes = new Set<string>();
  return {
    created, killed, typed, gate,
    async newSession(o) { if (failOn?.(o)) throw new Error('tmux: no server'); created.push(o); panes.add(o.name); },
    async sendText(n, text) { typed.push([n, text]); if (gate.hold) { gate.held++; await gate.hold; } }, async sendKeys() { if (gate.hold) { gate.held++; await gate.hold; } }, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { killed.push(n); panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let work: string; let answer: string | undefined;
const role = (id: string, front: string, prompt = `Tu es ${id}.`) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\n${prompt}\n`); };
async function start(failOn?: (o: NewSession) => boolean) {
  store = new Store();
  tmux = fakeTmux(failOn);
  srv = await startServer({ store, tmux, port: 0, agentEnv: async () => ({ ...process.env, ...(answer ? { FAKE_ANSWER: answer } : {}) }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))], close: { freeMs: 150, exitMs: 150 } });
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

describe('live composition', () => {
  const launched = async (c: Client, seats: { role: string; tool?: 'claude' | 'codex'; model?: string }[]) => {
    c.send({ type: 'team.launch', rid: 'r0', cwd: work, name: 'live', seats: seats as never });
    return (await c.next('team.launched', 5000)).team;
  };
  const teamNow = async (id: string) => { const l = await connect({ port: srv.port }); const m = await l.next('teams'); await l.close(); return m.teams.find(t => t.id === id)!; };
  const edit = (id: string, extra: Partial<Session>) => store.upsert({ ...store.get(id)!, ...extra });
  const sid = (team: { seats: { role: string; sessionId: string | null }[] }, role: string) => team.seats.find(s => s.role === role)!.sessionId!;

  it('a removed seat on a permission prompt is not closed; at its next free moment it is closed exactly once, and the seat goes', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'waiting_permission', pending: { kind: 'permission', text: 'Bash: ls', source: 'hook' } });
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }] });
    const changed = await c.next('team.changed');
    expect(changed).toMatchObject({ rid: 'c1', team: { seats: [{ role: 'lead' }, { role: 'build', leaving: true }] } });
    expect(changed.reason).toBeUndefined();
    // Store changes while the prompt waits: nothing is closed.
    for (let i = 0; i < 3; i++) edit(build, { title: `t${i}` });
    await new Promise(r => setTimeout(r, 400));
    expect(tmux.killed).toEqual([]);
    expect(store.get(build)!.state).not.toBe('exited');
    // Idle yet with a prompt still pending is not free either.
    edit(build, { state: 'idle' });
    await new Promise(r => setTimeout(r, 400));
    expect(tmux.killed).toEqual([]);
    // The prompt is answered, the turn ends: it is free, a burst of changes closes it once.
    edit(build, { state: 'idle', pending: undefined });
    for (let i = 0; i < 5; i++) edit(build, { title: `u${i}` });
    await until(() => store.get(build)?.state === 'exited');
    await until(async () => !(await teamNow(team.id)).seats.some(s => s.role === 'build'));
    expect(tmux.killed).toEqual([store.get(build)!.tmuxSession]);
    expect(store.get(build)!.team).toBeUndefined();
    await c.close();
  });

  it('a removed seat whose session is mid-reply is not closed until the lock clears', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'idle' });
    // The typing is held by the fake tmux; releasing it makes the injection fail, which ends the lock.
    let release = () => {}; tmux.gate.hold = new Promise<void>((_, reject) => { release = () => reject(new Error('released')); });
    c.send({ type: 'session.reply', id: build, text: 'continue' });
    await until(() => tmux.gate.held > 0);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }] });
    await c.next('team.changed');
    for (let i = 0; i < 3; i++) edit(build, { title: `w${i}` });
    await new Promise(r => setTimeout(r, 400));
    expect(tmux.killed).toEqual([]);
    tmux.gate.hold = undefined; release();
    await new Promise(r => setTimeout(r, 100));
    edit(build, { title: 'after' });
    await until(() => store.get(build)?.state === 'exited');
    expect(tmux.killed).toEqual([store.get(build)!.tmuxSession]);
    await c.close();
  });

  it('a removed seat whose session Ledge cannot close (read only) is let go: the seat goes, the session stays', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'working' });
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }] });
    await c.next('team.changed');
    edit(build, { source: 'hook_only', state: 'idle' });
    await until(async () => !(await teamNow(team.id)).seats.some(s => s.role === 'build'));
    expect(store.get(build)).toMatchObject({ state: 'idle', team: undefined });
    expect(tmux.killed).toEqual([]);
    await c.close();
  });

  it('a removed seat the user closes on the PC meanwhile still goes', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'waiting_permission', pending: { kind: 'permission', text: 'Bash: ls', source: 'hook' } });
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }] });
    await c.next('team.changed');
    store.upsert({ ...store.get(build)!, state: 'exited', pending: undefined } as Session);
    await until(async () => (await teamNow(team.id)).seats.length === 1);
    expect(tmux.killed).toEqual([]);
    await c.close();
  });

  it('adding a role launches one session in it, seated in the team; a role that fails to launch is named and the composition stays', async () => {
    await start(o => o.env.LEDGE_ROLE === 'lead');
    const c = await client();
    const team = await launched(c, [{ role: 'build' }]);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'build' }, { role: 'review' }] });
    const changed = await c.next('team.changed', 5000);
    expect(changed.reason).toBeUndefined();
    const review = changed.team!.seats.find(s => s.role === 'review')!;
    expect(review.sessionId).toBeTruthy();
    expect(store.get(review.sessionId!)).toMatchObject({ role: 'review', team: team.id, tool: 'codex' });
    expect(tmux.created).toHaveLength(2);
    c.send({ type: 'team.compose', rid: 'c2', team: team.id, seats: [{ role: 'build' }, { role: 'review' }, { role: 'lead' }] });
    const failed = await c.next('team.changed', 5000);
    expect(failed.reason).toContain('@lead');
    expect(failed.team!.seats.map(s => [s.role, !!s.sessionId])).toEqual([['build', true], ['review', true], ['lead', false]]);
    c.send({ type: 'team.compose', rid: 'c3', team: 'team-0000', seats: [{ role: 'build' }] });
    expect(await c.next('team.changed')).toMatchObject({ rid: 'c3', reason: expect.stringContaining('team-0000') });
    await c.close();
  });

  it('team.seat restart closes the old session and launches one with the seat’s tool; start fills a free seat', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const old = sid(team, 'lead');
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead', tool: 'codex' }, { role: 'build' }, { role: 'review', model: 'o3' }] });
    await c.next('team.changed', 5000);
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'lead', action: 'restart' });
    const r = await c.next('team.changed', 5000);
    expect(r).toMatchObject({ rid: 's1' }); expect(r.reason).toBeUndefined();
    const fresh = r.team!.seats.find(s => s.role === 'lead')!.sessionId!;
    expect(fresh).not.toBe(old);
    expect(tmux.killed).toContain(store.get(old)!.tmuxSession);
    expect(store.get(old)!.state).toBe('exited');
    expect(store.get(fresh)).toMatchObject({ tool: 'codex', role: 'lead', team: team.id });
    // A live seat cannot be started again.
    c.send({ type: 'team.seat', rid: 's2', team: team.id, role: 'build', action: 'start' });
    expect((await c.next('team.changed')).reason).toContain('@build');
    c.send({ type: 'team.seat', rid: 's3', team: team.id, role: 'nope', action: 'start' });
    expect((await c.next('team.changed')).reason).toContain('@nope');
    await c.close();
  });

  it('team.seat start launches into a free seat', async () => {
    let down = true;
    await start(o => down && o.env.LEDGE_ROLE === 'review');
    const c = await client();
    const team = await launched(c, [{ role: 'build' }]);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'build' }, { role: 'review' }] });
    expect((await c.next('team.changed', 5000)).reason).toContain('@review');
    down = false;
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'review', action: 'start' });
    const r = await c.next('team.changed', 5000);
    expect(r.reason).toBeUndefined();
    expect(store.get(r.team!.seats.find(s => s.role === 'review')!.sessionId!)).toMatchObject({ tool: 'codex', team: team.id });
    await c.close();
  });

  it('two team.seat start sent back to back launch exactly one session; the second is refused', async () => {
    let down = true;
    await start(o => down && o.env.LEDGE_ROLE === 'review');
    const c = await client();
    const team = await launched(c, [{ role: 'build' }]);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'build' }, { role: 'review' }] });
    expect((await c.next('team.changed', 5000)).reason).toContain('@review');
    down = false;
    const before = tmux.created.length;
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'review', action: 'start' });
    c.send({ type: 'team.seat', rid: 's2', team: team.id, role: 'review', action: 'start' });
    const answers = [await c.next('team.changed', 5000), await c.next('team.changed', 5000)];
    expect(answers.filter(a => a.reason === undefined)).toHaveLength(1);
    expect(answers.filter(a => a.reason !== undefined)).toHaveLength(1);
    expect(tmux.created).toHaveLength(before + 1);
    const seated = (await teamNow(team.id)).seats.find(s => s.role === 'review')!.sessionId!;
    expect(store.all().filter(x => x.role === 'review' && x.team === team.id && x.state !== 'exited').map(x => x.id)).toEqual([seated]);
    await c.close();
  });

  it('team.launch with a project and no folder: the project’s local folder, else team.failed; seats given, the template is only recorded', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'p1', project: 'nowhere', seats: [{ role: 'lead' }] });
    expect(await c.next('team.failed')).toEqual({ type: 'team.failed', rid: 'p1', reason: 'aucun dossier local pour ce projet' });
    expect(tmux.created).toEqual([]);
    c.send({ type: 'team.launch', rid: 'p2', cwd: work, template: 'not-a-file', seats: [{ role: 'lead' }] });
    const { team } = await c.next('team.launched', 5000);
    expect(team.template).toBe('not-a-file');
    await c.close();
  });

  it('compose applies a held seat\'s new model to its session', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'idle', agentSessionId: 'u-1' });
    const before = tmux.created.length;
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'build', model: 'sonnet' }] });
    const changed = await c.next('team.changed', 5000);
    expect(changed.reason).toBeUndefined();
    expect(changed.models).toEqual([{ role: 'build', session: build, when: 'now' }]);
    await until(() => tmux.created.length === before + 1);
    expect(tmux.created.at(-1)!.command).toEqual(expect.arrayContaining(['--resume', 'u-1', '--model', 'sonnet']));
    await until(() => store.get(build)?.model === 'sonnet');
    await c.close();
  });

  it('compose on a free seat sends no model change', async () => {
    await start(o => o.env.LEDGE_ROLE === 'review');
    const c = await client();
    const team = await launched(c, [{ role: 'build' }]);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'build' }, { role: 'review' }] });
    expect((await c.next('team.changed', 5000)).reason).toContain('@review');
    c.send({ type: 'team.compose', rid: 'c2', team: team.id, seats: [{ role: 'build' }, { role: 'review', model: 'o3' }] });
    const changed = await c.next('team.changed', 5000);
    expect(changed).toMatchObject({ rid: 'c2', team: { seats: [{ role: 'build' }, { role: 'review', model: 'o3', sessionId: null }] } });
    expect(changed.models).toBeUndefined();
    await c.close();
  });

  it('compose on a seat held by a hook_only session reports not_launched', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'idle', agentSessionId: 'u-1', source: 'hook_only' });
    const before = tmux.created.length;
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'build', model: 'sonnet' }] });
    const changed = await c.next('team.changed', 5000);
    expect(changed.reason).toBeUndefined();
    expect(changed.models).toEqual([{ role: 'build', session: build, code: 'not_launched' }]);
    // The save stands: the seat carries its new model, the session is left as it is.
    expect(changed.team!.seats.find(s => s.role === 'build')).toMatchObject({ model: 'sonnet', sessionId: build });
    expect(tmux.created).toHaveLength(before);
    expect(store.get(build)?.modelNext).toBeUndefined();
    await c.close();
  });

  it('compose changing a held seat\'s tool reports nothing', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead' }, { role: 'build' }]);
    const build = sid(team, 'build');
    edit(build, { state: 'idle', agentSessionId: 'u-1' });
    const before = tmux.created.length;
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'build', tool: 'codex', model: 'o3' }] });
    const changed = await c.next('team.changed', 5000);
    expect(changed.models).toBeUndefined();
    await new Promise(r => setTimeout(r, 200));
    expect(tmux.created).toHaveLength(before);
    expect(store.get(build)?.modelNext).toBeUndefined();
    await c.close();
  });

  it('team.resume resumes a seat with the seat’s model override; a seat whose tool changed is not resumed', async () => {
    await start();
    const c = await client();
    const team = await launched(c, [{ role: 'lead', model: 'sonnet' }, { role: 'build' }]);
    const lead = sid(team, 'lead'); const build = sid(team, 'build');
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead', model: 'opus' }, { role: 'build', tool: 'codex' }] });
    await c.next('team.changed', 5000);
    for (const id of [lead, build]) store.upsert({ ...store.get(id)!, state: 'exited', exitedAt: new Date().toISOString(), agentSessionId: 'abc' } as Session);
    const before = tmux.created.length;
    c.send({ type: 'team.resume', team: team.id });
    expect((await c.next('error')).message).toBe('@build : outil changé, redémarre le siège');
    expect(tmux.created).toHaveLength(before + 1);
    expect(tmux.created.at(-1)!.command).toEqual(expect.arrayContaining(['--resume', '--model', 'opus']));
    expect(store.get(build)!.state).toBe('exited');
    await c.close();
  });
});

/**
 * Who hears of a change to their team (#ta8042d, fixed as C + B). A seat that loses its team is told at once, one
 * `<ledge-notice team>` line (B); the others are not woken, they read what changed at their next turn, through the
 * UserPromptSubmit hook (C).
 */
describe('team changes and the seats told of them', () => {
  const idle = (id: string) => store.upsert({ ...store.get(id)!, state: 'idle' });
  const name = (id: string) => store.get(id)!.name;
  const notices = (id: string) => tmux.typed.filter(([n, t]) => n === store.get(id)!.tmuxSession && t.startsWith('<ledge-notice team=')).map(([, t]) => t);
  const quiet = () => new Promise(r => setTimeout(r, 400));
  /** The hook of `id` as its agent runs it, Ledge's session in its environment. */
  async function hook(id: string, event: 'SessionStart' | 'UserPromptSubmit'): Promise<string | undefined> {
    process.env.LEDGE_SESSION = id;
    try {
      const out = await runHook(event, JSON.stringify({ session_id: `u-${id}`, cwd: work, ...(event === 'SessionStart' ? { source: 'startup' } : { prompt: 'continue' }) }), { port: srv.port });
      return out ? (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : undefined;
    } finally { delete process.env.LEDGE_SESSION; }
  }
  /** Each seat started (its hook records what it was told of its team), then free. */
  async function started(...ids: string[]) {
    for (const id of ids) { await hook(id, 'SessionStart'); await until(() => store.get(id)?.teamSeen !== undefined); idle(id); }
  }
  async function workshop(c: Client) {
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'workshop', seats: [{ role: 'lead' }, { role: 'build' }] });
    const { team } = await c.next('team.launched', 5000);
    const lead = team.seats[0]!.sessionId!; const build = team.seats[1]!.sessionId!;
    await started(lead, build);
    return { team, lead, build };
  }

  it('team.join: the newcomer is told its team; the others are not woken, their next turn reads who came, once', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    c.send({ type: 'session.launch', tool: 'claude', cwd: work });
    const { id: mila } = await c.next('session.launched');
    idle(mila);
    c.send({ type: 'team.join', team: team.id, session: mila, role: 'review' });
    await until(() => notices(mila).length === 1);
    expect(notices(mila)[0]).toContain('Ton rôle : Relecteur (review), dans l\'équipe workshop');
    await quiet();
    expect(notices(lead)).toEqual([]);
    expect(notices(build)).toEqual([]);
    // Its next turn: the change, then the team as it is. The one after has nothing more to say.
    expect(await hook(lead, 'UserPromptSubmit')).toBe(`Ledge : ton équipe workshop a changé (${name(mila)} (review) arrive). Ton équipe : ${name(build)} (build), ${name(mila)} (review). Écris-leur par leur rôle : ledge send @rôle "…".`);
    await until(() => !!store.get(lead)?.teamSeen?.includes('@review'));
    expect(await hook(lead, 'UserPromptSubmit')).toBeUndefined();
    // The newcomer was told by its notice: its turn adds nothing.
    expect(await hook(mila, 'UserPromptSubmit')).toBeUndefined();
    await c.close();
  });

  it('team.leave: the session that leaves is told at once, and its @role messages and tasks say why they are refused', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    c.send({ type: 'team.leave', team: team.id, session: build });
    await until(() => notices(build).length === 1);
    expect(notices(build)[0]).toBe(`<ledge-notice team="${team.id}">Tu n'es plus dans l'équipe workshop : les adresses @rôle ne te servent plus (ledge team list).</ledge-notice>`);
    await quiet();
    expect(notices(lead)).toEqual([]);
    const gone = 'tu n\'es plus dans l\'équipe workshop : @lead ne te sert plus (ledge team list)';
    c.send({ type: 'session.message', rid: 'm1', from: build, to: '@lead', text: 'fini' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'refused', reason: gone });
    c.send({ type: 'task.cmd', rid: 't1', by: build, op: 'give', to: '@lead', title: 'Relire' });
    expect(await c.next('task.result')).toMatchObject({ reason: gone });
    // Told already: its own turn adds nothing; the lead's says who went.
    expect(await hook(build, 'UserPromptSubmit')).toBeUndefined();
    expect(await hook(lead, 'UserPromptSubmit')).toContain(`(${name(build)} (build) part)`);
    await c.close();
  });

  it('team.compose adding a seat: the seats there are not woken, their next turn reads the new role', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'build' }, { role: 'review' }] });
    const changed = await c.next('team.changed', 5000);
    const review = changed.team!.seats.find(s => s.role === 'review')!.sessionId!;
    await quiet();
    expect(notices(lead)).toEqual([]);
    expect(notices(build)).toEqual([]);
    expect(await hook(lead, 'UserPromptSubmit')).toContain(`(${name(review)} (review) arrive)`);
    await c.close();
  });

  it('team.compose removing a seat: the seat is closed, the others read at their next turn that it went', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }] });
    await c.next('team.changed');
    await until(() => store.get(build)?.state === 'exited');
    await quiet();
    // Closed by Ledge, nothing left to tell it; the lead is not woken.
    expect(notices(build)).toEqual([]);
    expect(notices(lead)).toEqual([]);
    expect(await hook(lead, 'UserPromptSubmit')).toContain(`(${name(build)} (build) part)`);
    await c.close();
  });

  it('team.seat restart: no one is woken, and a seat taken back under the same name has nothing to tell', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    const before = name(build);
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'build', action: 'restart' });
    const changed = await c.next('team.changed', 5000);
    const fresh = changed.team!.seats.find(s => s.role === 'build')!.sessionId!;
    await quiet();
    expect(notices(lead)).toEqual([]);
    // The fresh session takes the first free name back, its predecessor's: same name, same role, nothing to say. Under
    // another name it would read « <new> remplace <old> (build) » (teamsLive.test.ts).
    expect(name(fresh)).toBe(before);
    expect(await hook(lead, 'UserPromptSubmit')).toBeUndefined();
    await c.close();
  });

  it('team.dissolve: every live seat is told at once, and @role says why it is refused', async () => {
    await start();
    const c = await client();
    const { team, lead, build } = await workshop(c);
    c.send({ type: 'team.dissolve', team: team.id });
    await until(() => notices(lead).length === 1 && notices(build).length === 1);
    expect(notices(lead)[0]).toBe(`<ledge-notice team="${team.id}">L'équipe workshop est dissoute : les adresses @rôle ne te servent plus (ledge team list).</ledge-notice>`);
    c.send({ type: 'session.message', rid: 'm1', from: lead, to: '@build', text: 'go' });
    expect(await c.next('message.ack')).toMatchObject({ outcome: 'refused', reason: 'tu n\'es plus dans l\'équipe workshop : @build ne te sert plus (ledge team list)' });
    expect(await hook(lead, 'UserPromptSubmit')).toBeUndefined();
    await c.close();
  });
});
