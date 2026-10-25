import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Task } from '@ledge/protocol';
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
