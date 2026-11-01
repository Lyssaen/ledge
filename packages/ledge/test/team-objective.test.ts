import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task, Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import type { MailState } from '../src/daemon/mailbox.js';
import { formatLedgeTask, formatTeamNotice } from '../src/daemon/crossSession.js';
import { closedLedgeTasks } from '../src/tui/model/overview.js';
import { connect, type Client } from '../src/client.js';
import type { Tmux } from '../src/tmux.js';
import { until } from './helpers.js';

// Lot B, task 3: a team launched with an objective gives it to its `leader` seat as a task, with the whole starting notice;
// the other seats are told to wait for theirs; the results the seats hand back reach the lead, the lead's reaches Ledge.

type NewSession = { name: string; cwd: string; env: Record<string, string>; command: string[] };
/** The tmux of teams-server.test.ts: a launch fails for the sessions `failOn` names. */
function fakeTmux(failOn?: (o: NewSession) => boolean): Tmux {
  const panes = new Set<string>();
  return {
    async newSession(o) { if (failOn?.(o)) throw new Error('tmux: no server'); panes.add(o.name); },
    async sendText() {}, async sendKeys() {}, async capture() { return ''; },
    async hasSession(n) { return panes.has(n); }, async listSessions() { return [...panes]; },
    async setOption() {}, async killSession(n) { panes.delete(n); }, attachArgs: n => ['attach', n]
  };
}

type Notice = MailState['queue'][number];
let srv: Awaited<ReturnType<typeof startServer>>; let store: Store; let work: string; let answer: string | undefined;
/** Every item the mailbox ever queued, by id: a notice typed meanwhile (and so out of the queue) is still here. */
let queued: Map<string, Notice>;
const role = (id: string, front: string) => { mkdirSync(join(process.env.LEDGE_HOME!, 'roles'), { recursive: true }); writeFileSync(join(process.env.LEDGE_HOME!, 'roles', `${id}.md`), `---\n${front}\n---\nTu es ${id}.\n`); };
async function start(failOn?: (o: NewSession) => boolean) {
  store = new Store();
  queued = new Map();
  const mail = { load: () => undefined, save: (s: MailState) => { for (const q of s.queue) queued.set(q.id, q); } };
  srv = await startServer({ store, tmux: fakeTmux(failOn), port: 0, mail, agentEnv: async () => ({ ...process.env, ...(answer ? { FAKE_ANSWER: answer } : {}) }), claudeBin: [process.execPath, fileURLToPath(new URL('./fake-claude.mjs', import.meta.url))] });
}
async function client(): Promise<Client> { const c = await connect({ port: srv.port }); await c.next('snapshot'); return c; }
const noticesTo = (id: string) => [...queued.values()].filter(q => q.target === id);
async function allTasks(c: Client): Promise<Task[]> {
  c.send({ type: 'task.cmd', rid: `list-${Math.random()}`, by: 'ledge', op: 'list', all: true });
  return (await c.next('task.result')).tasks ?? [];
}
const seatOf = (team: Team, r: string) => team.seats.find(s => s.role === r)!.sessionId!;
const OBJECTIVE = { goal: 'Pagination de /invoices', branch: 'feat/pages', done: 'tests verts' };
const SEATS = [{ role: 'leader' }, { role: 'review', tool: 'codex' as const }];
const leadBody = (team: string, id: string, text: string, crew: string) =>
  `Tu es le lead de l'équipe ${team}. Ta tâche ${id} est l'objectif :\n${text}\nPrends-la (ledge task take ${id}), découpe le travail et confie chaque morceau à un siège (ledge task give @<rôle> "<titre>" "<détail>") ; leurs résultats te reviennent. Quand l'objectif est atteint : ledge task done ${id} "<résultat>". Ton équipe : ${crew}.`;

beforeEach(() => {
  process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-objective-'));
  work = mkdtempSync(join(tmpdir(), 'ledge-work-'));
  answer = undefined;
  role('leader', 'label: Lead');
  role('review', 'label: Relecteur\ntool: codex');
});
afterEach(async () => { await srv.close(); });

describe('a team launched with an objective', () => {
  it('the lead gets it as a task with the whole starting notice; the other seats are told to wait', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS, objective: OBJECTIVE });
    const { team } = await c.next('team.launched', 5000);
    const lead = store.get(seatOf(team, 'leader'))!; const review = store.get(seatOf(team, 'review'))!;
    expect(team.objectiveTask).toMatch(/^t[0-9a-f]{6}$/);
    const tasks = await allTasks(c);
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t).toMatchObject({ id: team.objectiveTask, objective: true, giver: 'ledge', giverName: 'Ledge', owner: lead.id, ownerName: lead.name, state: 'open', team: team.id, title: 'Pagination de /invoices' });
    expect(t.text!.split('\n')).toEqual(['Objectif : Pagination de /invoices', `Dépôt : ${team.cwd}`, 'Branche : feat/pages', 'Fini quand : tests verts']);
    // Given as any task is: one `give` entry, from Ledge to the lead.
    expect(t.log).toMatchObject([{ op: 'give', from: 'ledge', fromName: 'Ledge', to: lead.id, toName: lead.name }]);
    // The lead's notice, first in its queue, in its exact words; the review seat's, exact too.
    const leadNotices = noticesTo(lead.id).filter(n => n.text.startsWith('<ledge-task'));
    expect(leadNotices).toHaveLength(1);
    expect(leadNotices[0]).toMatchObject({ rid: `${t.id}:0` });
    expect(leadNotices[0]!.text).toContain("Tu es le lead de l'équipe");
    expect(leadNotices[0]!.text).toContain(`@review (${review.name}, codex)`);
    expect(leadNotices[0]!.text).toBe(formatLedgeTask({ id: t.id, from: 'Ledge', text: leadBody('api', t.id, t.text!, `@review (${review.name}, codex)`) }));
    const wait = noticesTo(review.id).filter(n => n.rid === `${team.id}:wait:${review.id}`);
    expect(wait.map(n => n.text)).toEqual([formatTeamNotice({ team: team.id,
      text: `Tu es @review dans l'équipe api. Le lead (@leader, ${lead.name}) a l'objectif et va te confier une tâche : attends-la, ne commence rien d'autre.` })]);
    // The lead is not told to wait, the review seat is not given the objective.
    expect(noticesTo(lead.id).some(n => n.rid.includes(':wait:'))).toBe(false);
    expect(noticesTo(review.id).some(n => n.text.startsWith('<ledge-task'))).toBe(false);
    await c.close();
  });

  it('without an objective: no task, no notice, no objectiveTask (as on main)', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS });
    const { team } = await c.next('team.launched', 5000);
    expect(team.objectiveTask).toBeUndefined();
    expect(await allTasks(c)).toEqual([]);
    for (const s of team.seats) expect(noticesTo(s.sessionId!).filter(n => n.text.startsWith('<ledge-task') || n.rid.includes(':wait:'))).toEqual([]);
    await c.close();
  });

  it('Review Focus 1: the lead does not start: team.failed says so, no task is given', async () => {
    await start(o => o.env.LEDGE_ROLE === 'leader');
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS, objective: OBJECTIVE });
    const failed = await c.next('team.failed', 5000);
    expect(failed.reason).toContain('@leader');
    expect(failed.reason).toContain("objectif non donné : le lead n'a pas démarré");
    expect(failed.reason).toBe("@leader : tmux: no server ; objectif non donné : le lead n'a pas démarré");
    expect(failed.team!.objectiveTask).toBeUndefined();
    expect(await allTasks(c)).toEqual([]);
    const review = seatOf(failed.team!, 'review');
    expect(noticesTo(review).some(n => n.rid.includes(':wait:'))).toBe(false);
    await c.close();
  });

  it('Review Focus 2: the lead ends: the objective task drops, and « À toi » counts it', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS, objective: OBJECTIVE });
    const { team } = await c.next('team.launched', 5000);
    const lead = store.get(seatOf(team, 'leader'))!;
    const before = queued.size;
    store.upsert({ ...lead, state: 'exited', exitedAt: new Date().toISOString() });
    await until(async () => { const m = await c.next('task.updated'); return m.task.id === team.objectiveTask && m.task.state === 'dropped'; });
    const tasks = await allTasks(c);
    expect(tasks.find(t => t.id === team.objectiveTask)).toMatchObject({ objective: true, state: 'dropped' });
    expect(closedLedgeTasks(tasks).map(t => t.id)).toEqual([team.objectiveTask]);
    // Ledge gave it: nobody is typed to about it.
    expect(queued.size).toBe(before);
    await c.close();
  });

  it('Review Focus 3: a long goal: the title is its first line cut to 200 with …, the whole goal is in the text and the notice', async () => {
    await start();
    const c = await client();
    const first = 'A'.repeat(250);
    const goal = `${first}\nligne deux\nligne trois`;
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS, objective: { goal } });
    const { team } = await c.next('team.launched', 5000);
    const [t] = await allTasks(c);
    expect(t!.title).toHaveLength(200);
    expect(t!.title).toBe(`${'A'.repeat(199)}…`);
    expect(t!.text!.split('\n')).toEqual([`Objectif : ${first}`, 'ligne deux', 'ligne trois', `Dépôt : ${team.cwd}`]);
    const notice = noticesTo(seatOf(team, 'leader')).find(n => n.rid === `${t!.id}:0`)!;
    expect(notice.text).toContain(`Objectif : ${first} ⏎ ligne deux ⏎ ligne trois ⏎ Dépôt : ${team.cwd}`);
    await c.close();
  });

  it('the results go back up: a seat\'s to the lead, the lead\'s to Ledge without anyone typed to', async () => {
    await start();
    const c = await client();
    c.send({ type: 'team.launch', rid: 'r1', cwd: work, name: 'api', seats: SEATS, objective: OBJECTIVE });
    const { team } = await c.next('team.launched', 5000);
    const lead = store.get(seatOf(team, 'leader'))!; const review = store.get(seatOf(team, 'review'))!;
    // The lead splits the work: a task to @review, which finishes it.
    c.send({ type: 'task.cmd', rid: 'g1', by: lead.id, op: 'give', to: '@review', title: 'Relire la pagination' });
    const sub = (await c.next('task.result')).task!;
    expect(sub).toMatchObject({ giver: lead.id, owner: review.id, team: team.id });
    c.send({ type: 'task.cmd', rid: 'd1', by: review.id, op: 'done', task: sub.id, text: 'fait' });
    expect((await c.next('task.result')).task).toMatchObject({ state: 'done', result: 'fait' });
    const back = noticesTo(lead.id).filter(n => n.text.includes(sub.id) && n.text.includes('terminée par'));
    expect(back).toHaveLength(1);
    expect(back[0]!.text).toContain('fait');
    expect(back[0]!.text).toContain(review.name);
    // The lead closes the objective: Ledge's fronts hear of it, no session is typed to.
    const before = queued.size;
    c.send({ type: 'task.cmd', rid: 'd2', by: lead.id, op: 'done', task: team.objectiveTask!, text: 'fini' });
    expect((await c.next('task.result')).task).toMatchObject({ id: team.objectiveTask, objective: true, state: 'done', result: 'fini' });
    await until(async () => { const m = await c.next('task.updated'); return m.task.id === team.objectiveTask && m.task.state === 'done' && m.task.objective === true; });
    await new Promise(r => setTimeout(r, 50));
    expect(queued.size).toBe(before);
    await c.close();
  });
});

describe('a team launched from the chat\'s card', () => {
  it('Review Focus 5: a card whose seats have no leader is refused with the leader rule', async () => {
    answer = `Je propose une équipe.\n\`\`\`ledge-team\n{"cwd": "${work}", "name": "api", "seats": [{"role": "review"}]}\n\`\`\``;
    await start();
    const c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe' });
    expect((await c.next('chat.done', 10_000)).team).toMatchObject({ seats: [{ role: 'review' }] });
    c.send({ type: 'team.launch', rid: 'r1', qid: 'q1' });
    const failed = await c.next('team.failed', 5000);
    expect(failed.reason).toBe('il manque le siège @leader : une équipe a exactement un lead (ajoute un siège de rôle leader)');
    expect(failed.team).toBeUndefined();
    await c.close();
  });

  it('the card\'s objective is kept on the proposal and given to the lead at launch', async () => {
    answer = `Je propose une équipe.\n\`\`\`ledge-team\n${JSON.stringify({ cwd: work, name: 'api', seats: SEATS, objective: OBJECTIVE })}\n\`\`\``;
    await start();
    const c = await client();
    c.send({ type: 'chat.ask', qid: 'q1', text: 'Monte une équipe pour paginer /invoices' });
    const done = await c.next('chat.done', 10_000);
    expect(done.team?.objective).toEqual(OBJECTIVE);
    c.send({ type: 'team.launch', rid: 'r1', qid: 'q1' });
    const { team } = await c.next('team.launched', 5000);
    const lead = store.get(seatOf(team, 'leader'))!;
    expect(team.objectiveTask).toMatch(/^t[0-9a-f]{6}$/);
    const [t] = await allTasks(c);
    expect(t).toMatchObject({ id: team.objectiveTask, objective: true, giver: 'ledge', owner: lead.id, state: 'open', title: 'Pagination de /invoices' });
    expect(t!.text).toContain('Branche : feat/pages');
    expect(noticesTo(lead.id).some(n => n.rid === `${t!.id}:0` && n.text.includes("Tu es le lead de l'équipe api."))).toBe(true);
    await c.close();
  });
});
