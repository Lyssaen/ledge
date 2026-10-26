import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transmissions, type Session, type Task, type TaskLogEntry } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTasks, tasksJournal, type Tasks, type TasksDeps } from '../src/daemon/tasks.js';
import { ledgeTask } from '../src/daemon/crossSession.js';
import { taskArgs, formatTask } from '../src/cli/task.js';

const T0 = '2026-10-25T08:00:00.000Z';
const mk = (id: string, name: string, extra: Partial<Session> = {}): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra });

let store: Store; let told: Array<[string, string]>; let tasks: Tasks;
const notify: TasksDeps['mailbox']['notify'] = (target, text) => { told.push([target, text]); return true; };
const cmd = (by: string, op: Parameters<Tasks['run']>[0]['op'], extra: Partial<Parameters<Tasks['run']>[0]> = {}) => tasks.run({ type: 'task.cmd', rid: 'r', by, op, ...extra });
const give = (title = 'Lance les tests', text?: string) => cmd('otto', 'give', { to: 'Pim', title, ...(text ? { text } : {}) }).task!;

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'tasks-')), 'j.json') });
  store.upsert(mk('otto', 'Otto')); store.upsert(mk('pim', 'Pim', { tool: 'codex' })); store.upsert(mk('nova', 'Nova'));
  told = [];
  tasks = createTasks({ store, mailbox: { notify }, now: () => T0 });
});

describe('createTasks', () => {
  it('give: an open task for the named session, which is told how to read, take and close it', () => {
    const t = give('Lance les tests', 'pnpm test dans packages/ledge');
    expect(t).toMatchObject({ id: expect.stringMatching(/^t[0-9a-f]{6}$/), title: 'Lance les tests', text: 'pnpm test dans packages/ledge', giver: 'otto', giverName: 'Otto', owner: 'pim', ownerName: 'Pim', state: 'open' });
    expect(told).toHaveLength(1);
    const [to, line] = told[0]!;
    expect(to).toBe('pim');
    expect(ledgeTask(line)).toMatchObject({ id: t.id, from: 'Otto' });
    expect(line).toContain('Tâche de Otto : « Lance les tests »');
    expect(line).toContain(`ledge task take ${t.id}`);
    expect(line).toContain(`ledge task done ${t.id}`);
  });

  it('give refuses an unknown, an ended, a hook-only session, and oneself', () => {
    expect(cmd('otto', 'give', { to: 'Zed', title: 'x' }).reason).toBe('aucune session Ledge nommée Zed');
    store.upsert(mk('arlo', 'Arlo', { state: 'exited' }));
    expect(cmd('otto', 'give', { to: 'Arlo', title: 'x' }).reason).toBe('aucune session Ledge nommée Arlo');
    store.upsert(mk('bram', 'Bram', { source: 'hook_only' }));
    expect(cmd('otto', 'give', { to: 'Bram', title: 'x' }).reason).toContain("n'a pas été lancée par Ledge");
    expect(cmd('otto', 'give', { to: 'Otto', title: 'x' }).reason).toBe('tu ne peux pas te confier une tâche');
    expect(cmd('ghost', 'list').reason).toBe('session inconnue');
    expect(told).toEqual([]);
  });

  it('take then done: the giver is told the result, and a closed task takes no more change', () => {
    const t = give(); told = [];
    expect(cmd('otto', 'take', { task: t.id }).reason).toBe(`la tâche ${t.id} est à Pim, pas à toi`);
    expect(cmd('pim', 'take', { task: t.id }).task).toMatchObject({ state: 'taken' });
    expect(cmd('otto', 'done', { task: t.id }).reason).toContain('seule la session qui la tient (Pim)');
    const done = cmd('pim', 'done', { task: t.id, text: '1875 tests verts' }).task!;
    expect(done).toMatchObject({ state: 'done', result: '1875 tests verts' });
    expect(done.log.map(l => l.what)).toEqual(['confiée à Pim', 'prise', 'terminée : 1875 tests verts']);
    expect(told).toEqual([['otto', expect.stringContaining('Tâche « Lance les tests » terminée par Pim : 1875 tests verts')]]);
    expect(cmd('pim', 'refuse', { task: t.id, text: 'non' }).reason).toBe(`la tâche ${t.id} est déjà close (done)`);
  });

  it('refuse by the owner tells the giver; by the giver it cancels and tells the owner; a reason is needed', () => {
    const a = give('A'); const b = give('B'); told = [];
    expect(cmd('pim', 'refuse', { task: a.id }).reason).toBe('il faut une raison');
    expect(cmd('pim', 'refuse', { task: a.id, text: 'pas mon dépôt' }).task).toMatchObject({ state: 'refused', result: 'pas mon dépôt' });
    expect(told.at(-1)).toEqual(['otto', expect.stringContaining('refusée par Pim : pas mon dépôt')]);
    expect(cmd('nova', 'refuse', { task: b.id, text: 'x' }).reason).toBe(`la tâche ${b.id} n'est ni à toi ni de toi`);
    expect(cmd('otto', 'refuse', { task: b.id, text: 'plus utile' }).task!.log.at(-1)!.what).toBe('annulée : plus utile');
    expect(told.at(-1)).toEqual(['pim', expect.stringContaining("annulée par Otto : plus utile. Arrête d'y travailler.")]);
  });

  it('pass: the task changes owner, open again, the giver stays, the new owner is told', () => {
    const t = give(); told = [];
    cmd('pim', 'take', { task: t.id });
    expect(cmd('pim', 'pass', { task: t.id, to: 'Pim' }).reason).toBe('elle est déjà à toi');
    const passed = cmd('pim', 'pass', { task: t.id, to: 'Nova', text: 'tu connais ce module' }).task!;
    expect(passed).toMatchObject({ owner: 'nova', ownerName: 'Nova', giver: 'otto', state: 'open' });
    expect(told).toEqual([['nova', expect.stringContaining('Tâche passée par Pim (tu connais ce module), confiée par Otto : « Lance les tests »')]]);
    expect(cmd('pim', 'done', { task: t.id }).reason).toContain('(Nova)');
  });

  it('list: what I hold and what I gave, open; --all adds the closed; show is for those two only', () => {
    const a = give('A'); const b = give('B');
    cmd('pim', 'done', { task: b.id });
    expect(cmd('pim', 'list').tasks!.map(t => t.id)).toEqual([a.id]);
    expect(cmd('otto', 'list', { all: true }).tasks!.map(t => t.id)).toEqual([a.id, b.id]);
    expect(cmd('nova', 'list').tasks).toEqual([]);
    expect(cmd('nova', 'show', { task: a.id }).reason).toContain("n'est ni à toi ni de toi");
    expect(cmd('otto', 'show', { task: a.id }).task!.id).toBe(a.id);
    expect(cmd('otto', 'show', { task: 't000000' }).reason).toBe('aucune tâche t000000');
  });

  it('an owner that ends drops its open tasks, and the giver is told', () => {
    const a = give('A'); const b = give('B'); cmd('pim', 'done', { task: b.id }); told = [];
    store.upsert({ ...store.get('pim')!, state: 'exited' });
    expect(cmd('otto', 'show', { task: a.id }).task).toMatchObject({ state: 'dropped' });
    expect(cmd('otto', 'show', { task: b.id }).task).toMatchObject({ state: 'done' });
    expect(told).toEqual([['otto', expect.stringContaining("abandonnée : Pim s'est terminée sans la finir")]]);
  });

  it('with a journal, tasks outlive the daemon; an owner gone meanwhile drops them', () => {
    const journal = tasksJournal(join(mkdtempSync(join(tmpdir(), 'tasks-j-')), 'tasks.json'));
    let saved: Task[] | undefined;
    const mem = { load: () => saved, save: (s: Task[]) => { saved = s; journal.save(s); } };
    tasks.close(); tasks = createTasks({ store, mailbox: { notify }, now: () => T0, journal: mem });
    const a = cmd('otto', 'give', { to: 'Pim', title: 'A' }).task!;
    const b = cmd('otto', 'give', { to: 'Nova', title: 'B' }).task!;
    tasks.close(); store.remove('nova'); told = [];
    tasks = createTasks({ store, mailbox: { notify }, now: () => T0, journal: mem });
    expect(cmd('otto', 'show', { task: a.id }).task).toMatchObject({ state: 'open' });
    expect(cmd('otto', 'show', { task: b.id }).task).toMatchObject({ state: 'dropped' });
    expect(told).toEqual([['otto', expect.stringContaining('abandonnée : Nova')]]);
  });
});

describe('ledge task (CLI)', () => {
  it('reads each op, or nothing when the arguments do not fit', () => {
    expect(taskArgs(['give', 'Pim', 'Lance les tests'])).toEqual({ op: 'give', to: 'Pim', title: 'Lance les tests' });
    expect(taskArgs(['give', 'Pim', 'T', 'détail'])).toEqual({ op: 'give', to: 'Pim', title: 'T', text: 'détail' });
    expect(taskArgs(['give', 'Pim'])).toBeUndefined();
    expect(taskArgs(['list'])).toEqual({ op: 'list' });
    expect(taskArgs(['list', '--all'])).toEqual({ op: 'list', all: true });
    expect(taskArgs(['take', 't1a2b3c'])).toEqual({ op: 'take', task: 't1a2b3c' });
    expect(taskArgs(['take', 'nope'])).toBeUndefined();
    expect(taskArgs(['done', 't1a2b3c', 'ok'])).toEqual({ op: 'done', task: 't1a2b3c', text: 'ok' });
    expect(taskArgs(['refuse', 't1a2b3c'])).toBeUndefined();
    expect(taskArgs(['pass', 't1a2b3c', 'Nova', 'note'])).toEqual({ op: 'pass', task: 't1a2b3c', to: 'Nova', text: 'note' });
    expect(taskArgs([])).toBeUndefined();
  });

  it('shows a task whole: head, detail, result, history', () => {
    const t = give('Lance les tests', 'pnpm test'); cmd('pim', 'done', { task: t.id, text: 'verts' });
    expect(formatTask(cmd('otto', 'show', { task: t.id }).task!)).toBe([
      `${t.id} · terminée · de Otto à Pim · 2026-10-25 08:00`, 'Lance les tests', '', 'pnpm test', '', 'Résultat : verts', '', 'Historique :',
      '  2026-10-25 08:00 Otto : confiée à Pim', '  2026-10-25 08:00 Pim : terminée : verts'
    ].join('\n'));
  });
});

describe('tasks Ledge gives (roles spec §3.7)', () => {
  let updates: Task[];
  let teams: import('../src/daemon/teamsLive.js').TeamsLive;
  beforeEach(async () => {
    const { createTeamsLive } = await import('../src/daemon/teamsLive.js');
    updates = [];
    teams = createTeamsLive({ store, now: () => T0 });
    tasks = createTasks({ store, mailbox: { notify }, teams, onTask: t => updates.push(t), now: () => T0 });
  });

  it('give by ledge: the owner gets the usual pointer from Ledge; every change reaches the fronts, never a terminal', () => {
    const t = cmd('ledge', 'give', { to: 'Pim', title: 'Implémenter les rôles' }).task!;
    expect(t).toMatchObject({ giver: 'ledge', giverName: 'Ledge', owner: 'pim', state: 'open' });
    expect(told).toEqual([['pim', expect.stringContaining('from="Ledge"')]]);
    expect(updates.map(u => u.state)).toEqual(['open']);
    told = [];
    cmd('pim', 'take', { task: t.id });
    cmd('pim', 'done', { task: t.id, text: 'rôles lus au démarrage' });
    expect(updates.map(u => u.state)).toEqual(['open', 'taken', 'done']);
    // Nothing is typed anywhere for Ledge: the outcome is an item of « À toi ».
    expect(told).toEqual([]);
    expect(cmd('ledge', 'seen', { task: t.id }).task).toMatchObject({ seen: true });
    expect(updates.at(-1)!.seen).toBe(true);
    expect(cmd('pim', 'seen', { task: t.id }).reason).toBe('seul Ledge range ses propres tâches');
  });

  it('a pass between seats keeps Ledge as the giver; an owner that ends drops it to Ledge', () => {
    const t = cmd('ledge', 'give', { to: 'pim', title: 'Relire' }).task!;
    const passed = cmd('pim', 'pass', { task: t.id, to: 'Nova' }).task!;
    expect(passed).toMatchObject({ giver: 'ledge', owner: 'nova' });
    told = [];
    store.upsert({ ...store.get('nova')!, state: 'exited' });
    expect(updates.at(-1)).toMatchObject({ id: t.id, state: 'dropped' });
    expect(told).toEqual([]);
  });

  it('@role names a seat of a team: the giver’s own for a session, the named one for Ledge; list by team', () => {
    const team = teams.create({ name: 'ledge-roles', project: 'ledge', cwd: '/w/ledge', roles: ['lead', 'qa'] });
    teams.seat(team.id, 'lead', store.get('otto')!, 'Chef'); teams.seat(team.id, 'qa', store.get('pim')!, 'QA');
    const t = cmd('otto', 'give', { to: '@qa', title: 'Teste' }).task!;
    expect(t).toMatchObject({ owner: 'pim', team: team.id, giver: 'otto' });
    expect(cmd('nova', 'give', { to: '@qa', title: 'x' }).reason).toBe("@qa n'existe que dans une équipe");
    expect(cmd('ledge', 'give', { to: '@qa', title: 'x' }).reason).toBe("@qa n'existe que dans une équipe");
    const l = cmd('ledge', 'give', { to: '@lead', team: team.id, title: 'Mène' }).task!;
    expect(l).toMatchObject({ owner: 'otto', giver: 'ledge', team: team.id });
    expect(cmd('ledge', 'give', { to: '@ops', team: team.id, title: 'x' }).reason).toContain("personne ne tient @ops dans l'équipe ledge-roles");
    expect(cmd('ledge', 'list', { team: team.id }).tasks!.map(x => x.id)).toEqual([t.id, l.id]);
    // Ledge lists every task, the ones the seats gave each other too (issue #92).
    expect(cmd('ledge', 'list').tasks!.map(x => x.id)).toEqual([t.id, l.id]);
    expect(cmd('ledge', 'list', { team: 'team-0000' }).reason).toBe('aucune équipe team-0000');
    // Ledge reads any task, the ones the seats gave each other too.
    expect(cmd('ledge', 'show', { task: t.id }).task!.id).toBe(t.id);
  });
});

describe('task transmissions (issue #92)', () => {
  let updates: Array<[Task, TaskLogEntry | undefined]>;
  beforeEach(() => {
    updates = [];
    tasks = createTasks({ store, mailbox: { notify }, onTask: (t, e) => updates.push([t, e]), now: () => T0 });
  });
  const strip = (t: Task) => transmissions(t).map(({ at: _at, ...rest }) => rest);

  it('writes give, pass, done as transmissions', () => {
    const t = give();
    cmd('pim', 'take', { task: t.id });
    cmd('pim', 'pass', { task: t.id, to: 'Nova', text: 'relis' });
    const done = cmd('nova', 'done', { task: t.id, text: 'ok' }).task!;
    expect(done.log.map(e => e.op)).toEqual(['give', 'take', 'pass', 'done']);
    expect(strip(done)).toEqual([
      { index: 0, op: 'give', from: 'otto', to: 'pim', fromName: 'Otto', toName: 'Pim' },
      { index: 2, op: 'pass', from: 'pim', to: 'nova', fromName: 'Pim', toName: 'Nova', note: 'relis' },
      { index: 3, op: 'done', from: 'nova', to: 'otto', fromName: 'Nova', toName: 'Otto' }
    ]);
  });

  it('writes a refusal by the owner as refuse and by the giver as cancel', () => {
    const a = give('a');
    expect(strip(cmd('pim', 'refuse', { task: a.id, text: 'non' }).task!).at(-1)).toEqual({ index: 1, op: 'refuse', from: 'pim', to: 'otto', fromName: 'Pim', toName: 'Otto' });
    const b = give('b');
    expect(strip(cmd('otto', 'refuse', { task: b.id, text: 'plus besoin' }).task!).at(-1)).toEqual({ index: 1, op: 'cancel', from: 'otto', to: 'pim', fromName: 'Otto', toName: 'Pim' });
  });

  it('writes a drop without sides', () => {
    const t = give();
    store.upsert({ ...store.get('pim')!, state: 'exited' });
    expect(updates.at(-1)![0]).toMatchObject({ id: t.id, state: 'dropped' });
    expect(updates.at(-1)![1]).toMatchObject({ op: 'drop' });
    expect(updates.at(-1)![1]!.from).toBeUndefined();
  });

  it('tells onTask of a task between two seats, with the entry', () => {
    const t = give();
    expect(updates).toHaveLength(1);
    expect(updates[0]![0].id).toBe(t.id);
    expect(updates[0]![1]).toMatchObject({ op: 'give', from: 'otto', to: 'pim' });
  });

  it('tells onTask of seen without an entry', () => {
    const t = cmd('ledge', 'give', { to: 'Pim', title: 'x' }).task!;
    cmd('pim', 'done', { task: t.id });
    cmd('ledge', 'seen', { task: t.id });
    expect(updates.at(-1)![0].seen).toBe(true);
    expect(updates.at(-1)![1]).toBeUndefined();
  });

  it('lists every task to Ledge', () => {
    const t = give();
    expect(cmd('ledge', 'list').tasks!.map(x => x.id)).toEqual([t.id]);
  });
});

describe('ledge task from a session never gives as Ledge', () => {
  it('taskOnClient refuses `by: ledge` before sending anything', async () => {
    const { taskOnClient } = await import('../src/cli/task.js');
    const sent: unknown[] = [];
    const client = { send: (m: unknown) => sent.push(m), next: async () => { throw new Error('no'); }, close: async () => {} };
    expect(await taskOnClient(client as never, ['give', 'Pim', 'x'], 'ledge', 100)).toEqual({ line: 'refusé : seul Ledge confie une tâche en son nom', code: 1 });
    expect(sent).toEqual([]);
  });
});
