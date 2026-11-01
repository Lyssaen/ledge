import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatTurn, Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { tasksJournal } from '../src/daemon/tasks.js';
import { teamsJournal } from '../src/daemon/teamsLive.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

// The two promises of the roles spec, end to end through the daemon: a team the chat proposes is launched, kept across a
// restart, saved as a template and launched again; the tasks given to a role reach its seat one at a time, oldest first,
// the next one only once the seat is free again.

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
/** A tmux whose panes take what is typed; `typed` is every text, by pane. */
function fakeTmux(): Tmux & { created: NewSession[]; typed: Array<{ pane: string; text: string }> } {
  const created: NewSession[] = []; const panes = new Set<string>(); const typed: Array<{ pane: string; text: string }> = [];
  const t: Tmux & { created: NewSession[]; typed: typeof typed } = {
    created, typed,
    async newSession(o) { created.push(o); panes.add(o.name); },
    async sendText(pane, text) { typed.push({ pane, text }); }, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
  return t;
}

let srv: Awaited<ReturnType<typeof startServer>> | undefined; let store: Store; let tmux: ReturnType<typeof fakeTmux>; let work: string; let answer: string | undefined;
const role = (id: string, front: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };
const journals = () => ({ teams: teamsJournal(join(process.env.LEDGE_HOME!, 'teams-live.json')), tasks: tasksJournal(join(process.env.LEDGE_HOME!, 'tasks.json')) });
/** A daemon on `store` (the sessions it keeps), with its teams and tasks journals in LEDGE_HOME. */
async function start() {
  tmux = fakeTmux();
  srv = await startServer({ store, tmux, port: 0, verify: { attempts: 2, intervalMs: 10 }, ...journals(), agentEnv: async () => ({ ...process.env, ...(answer ? { FAKE_ANSWER: answer } : {}) }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
}
async function client(): Promise<Client> { const c = await connect({ port: srv!.port }); await c.next('snapshot'); return c; }
const set = (id: string, state: Session['state']) => store.upsert({ ...store.get(id)!, state });

beforeEach(() => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-flow-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  store = new Store();
  answer = undefined;
  role('lead', 'label: Chef');
  role('build', 'label: Build\nmodel: opus\nautonomy: edits');
});
afterEach(async () => { await srv?.close(); srv = undefined; });

describe('a team made with Ledge’s chat', () => {
  it('is launched from the card, kept across a restart, resumed, saved as a template and launched again from it', async () => {
    answer = `Je propose une équipe.\n\`\`\`ledge-team\n{"cwd": "${work}", "name": "ledge-roles", "seats": [{"role": "lead"}, {"role": "build"}]}\n\`\`\``;
    await start();
    let c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe sur ledge' });
    const done = await c.next('chat.done', 10_000);
    expect(done.team).toMatchObject({ name: 'ledge-roles', seats: [{ role: 'lead' }, { role: 'build' }] });
    c.send({ type: 'team.launch', rid: 'r1', qid: 'q1' });
    const { team } = await c.next('team.launched', 5000);
    expect(team).toMatchObject({ name: 'ledge-roles', state: 'active', cwd: work });
    // Written to its journal at once.
    await until(() => existsSync(join(process.env.LEDGE_HOME!, 'teams-live.json')) && readFileSync(join(process.env.LEDGE_HOME!, 'teams-live.json'), 'utf8').includes(team.id));
    // « Enregistrer »: the team becomes a template of the home's teams.
    c.send({ type: 'team.save', rid: 's1', qid: 'q1', name: 'ledge-roles', seats: [{ role: 'lead' }, { role: 'build' }] });
    const saved = await c.next('team.saved');
    expect(readFileSync(saved.path!, 'utf8')).toContain('role: build');
    await c.close();

    // The PC restarts: the agents are gone, the team is not.
    await srv!.close(); srv = undefined;
    for (const s of store.all()) store.upsert({ ...s, state: 'exited', exitedAt: new Date().toISOString() });
    await start();
    c = await client();
    const teams = await c.next('teams');
    const kept = teams.teams.find(t => t.id === team.id);
    expect(kept).toMatchObject({ name: 'ledge-roles', state: 'resting', seats: [{ role: 'lead' }, { role: 'build' }] });
    // « Reprendre »: every seat comes back with its role, in its team.
    c.send({ type: 'team.resume', team: team.id });
    await until(() => team.seats.every(s => store.get(s.sessionId!)?.state === 'starting'));
    expect(tmux.created.map(o => o.env.LEDGE_ROLE).sort()).toEqual(['build', 'lead']);
    expect(new Set(tmux.created.map(o => o.env.LEDGE_TEAM))).toEqual(new Set([team.id]));
    // The saved template is offered for the folder, and launches a second team.
    c.send({ type: 'roles.list', requestId: 'l1', cwd: work });
    const listing = await c.next('roles.listing');
    const template = listing.templates.find(x => x.name === 'ledge-roles')!;
    expect(template.seats.map(s => s.role)).toEqual(['lead', 'build']);
    c.send({ type: 'team.launch', rid: 'r2', cwd: work, template: template.id });
    const again = await c.next('team.launched', 5000);
    expect(again.team.id).not.toBe(team.id);
    expect(again.team.seats.map(s => s.role)).toEqual(['lead', 'build']);
    await c.close();
  }, 30_000);
});

describe('a live team recomposed from the phone', () => {
  it('a seat start racing the compose that adds the seat is refused: one session, not two', async () => {
    role('rev', 'label: Rev');
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'duo', seats: [{ role: 'lead' }] });
    const { team } = await c.next('team.launched', 5000);
    // @rev takes a while to spawn: the window in which the seat exists and holds no session yet.
    const spawn = tmux.newSession.bind(tmux);
    tmux.newSession = async o => { if (o.env.LEDGE_ROLE === 'rev') await new Promise(r => setTimeout(r, 150)); return spawn(o); };
    // Both arrive together: the compose adds @rev and starts it, the start finds the seat already there.
    c.send({ type: 'team.compose', rid: 'c1', team: team.id, seats: [{ role: 'lead' }, { role: 'rev' }] });
    c.send({ type: 'team.seat', rid: 's1', team: team.id, role: 'rev', action: 'start' });
    const first = await c.next('team.changed', 5000);
    const second = await c.next('team.changed', 5000);
    const [composed, started] = first.rid === 'c1' ? [first, second] : [second, first];
    expect(composed.reason).toBeUndefined();
    expect(started.reason).toContain('déjà en cours');
    expect(tmux.created.filter(o => o.env.LEDGE_ROLE === 'rev')).toHaveLength(1);
    await c.close();
  }, 15_000);
});

describe('the tasks of a role', () => {
  it('Ledge gives @build three tasks: its seat gets them one at a time, oldest first, each once it is free again', async () => {
    const tasks = ['Écrire roles.ts', 'Tester roles.ts', 'Documenter les rôles'];
    answer = `Je confie trois tâches.\n\`\`\`ledge-team\n{"cwd": "${work}", "name": "ledge-roles", "seats": [{"role": "lead"}, {"role": "build"}]}\n\`\`\`\n${tasks.map(t => `\`\`\`ledge-task\n{"to": "@build", "title": "${t}"}\n\`\`\``).join('\n')}`;
    await start();
    const c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe et confie le travail à @build' });
    const done = await c.next('chat.done', 10_000);
    expect(done.tasks?.map(t => t.title)).toEqual(tasks);
    c.send({ type: 'team.launch', rid: 'r1', qid: 'q1' });
    const { team } = await c.next('team.launched', 5000);
    const build = team.seats.find(s => s.role === 'build')!.sessionId!;
    const pane = store.get(build)!.tmuxSession!;
    // The seat is busy starting: the three cards are given, nothing is typed yet.
    set(build, 'working');
    const ids: string[] = [];
    for (const row of [0, 1, 2]) {
      c.send({ type: 'task.cmd', rid: `g${row}`, by: 'ledge', op: 'give', qid: 'q1', row });
      const r = await c.next('task.result');
      expect(r.task).toMatchObject({ owner: build, team: team.id, title: tasks[row], state: 'open' });
      ids.push(r.task!.id);
    }
    const pointers = () => tmux.typed.filter(t => t.pane === pane && t.text.includes('<ledge-task'));
    expect(pointers()).toEqual([]);
    // The role's list, as Ledge reads it for the team: the three, in the order given.
    c.send({ type: 'task.cmd', rid: 'l1', by: 'ledge', op: 'list', team: team.id });
    expect((await c.next('task.result')).tasks?.map(t => t.title)).toEqual(tasks);
    // Ledge marks a seat working once the pointer is typed (« Decided »): the next one waits for its next free moment.
    let decided = 0;
    store.onChange(ch => { if (ch.type === 'updated' && ch.session.id === build && ch.session.state === 'working') decided++; });
    for (const [i, id] of ids.entries()) {
      // Free: the oldest pointer not typed yet goes, and only that one.
      const before = decided;
      set(build, 'idle');
      await until(() => pointers().length === i + 1 && decided > before);
      await new Promise(r => setTimeout(r, 100));
      expect(pointers()).toHaveLength(i + 1);
      expect(pointers()[i]!.text).toContain(id);
      expect(pointers()[i]!.text).toContain(tasks[i]);
      expect(store.get(build)!.state).toBe('working');
      // The seat takes it and finishes it.
      c.send({ type: 'task.cmd', rid: `t${i}`, by: build, op: 'take', task: id });
      expect((await c.next('task.result')).task?.state).toBe('taken');
      c.send({ type: 'task.cmd', rid: `d${i}`, by: build, op: 'done', task: id, text: `fait ${i}` });
      expect((await c.next('task.result')).task?.state).toBe('done');
    }
    // Each card followed its task.
    const turnOf = (h: ChatTurn[]) => h.find(t => t.qid === 'q1')!;
    await until(async () => turnOf((await c.next('chat.history')).turns)?.tasks?.every(t => t.state === 'done') === true);
    await c.close();
  }, 30_000);
});

describe('the tasks of a purged team (issue #146)', () => {
  it('lose their team when the daemon starts without it, and stay their owner\'s and Ledge\'s', async () => {
    const at = new Date().toISOString();
    store.upsert({ id: 'pim', name: 'Pim', tool: 'claude', cwd: work, project: 'p', title: 'Pim', tmuxSession: 'ledge-pim', state: 'working', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' });
    writeFileSync(join(process.env.LEDGE_HOME!, 'tasks.json'), JSON.stringify([{ id: 't0000aa', title: 'Finir', giver: 'ledge', giverName: 'Ledge', owner: 'pim', ownerName: 'Pim', team: 'team-dead', state: 'open', at, updatedAt: at, log: [] }]));
    await start();
    const c = await client();
    c.send({ type: 'task.cmd', rid: 'l1', by: 'pim', op: 'list' });
    const r = await c.next('task.result');
    expect(r.tasks).toMatchObject([{ id: 't0000aa', owner: 'pim' }]);
    expect(r.tasks![0]!.team).toBeUndefined();
    await until(() => !readFileSync(join(process.env.LEDGE_HOME!, 'tasks.json'), 'utf8').includes('team-dead'));
    await c.close();
  });
});
