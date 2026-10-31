import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTION_IDS, actionById, LEDGE_GIVER, openDecision, PhoneTaskSchema, PushPayloadSchema, transmissions, type ChatAction, type Session, type Team } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { createTasks, type Tasks, type TasksDeps } from '../src/daemon/tasks.js';
import { actionMessage, GENERIC_ACTIONS, resolveAction, RUN_ACTIONS, runGuard, type ResolveCtx } from '../src/daemon/actions.js';
import { forPhone, phoneTasks, toPhoneTask } from '../src/mobile/project.js';
import { decisionPayload } from '../src/mobile/push/triggers.js';

// A decision a session puts to the user (`ledge task give ledge …`): a task giver = the session, owner = `ledge` (t05ecf7).
// Every front lists it in « À toi » (openDecision), the phone is sent it and pushed, and task.answer is the one way to answer it.

const T0 = '2026-10-31T08:00:00.000Z';
const mk = (id: string, name: string): Session => ({ id, name, tool: 'claude', cwd: '/w/ledge', project: 'ledge', title: `${name} · ledge`,
  tmuxSession: `ledge-${id}`, state: 'idle', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' });

let store: Store; let tasks: Tasks; let told: Array<[string, string]>;
const notify: TasksDeps['mailbox']['notify'] = (target, text) => { told.push([target, text]); return true; };
const ask = (title = 'Fusionner feat/roles ?', text = 'oui / non ; je recommande oui') =>
  tasks.run({ type: 'task.cmd', rid: 'r', by: 'otto', op: 'give', to: 'ledge', title, text }).task!;
const ctx = (over: Partial<ResolveCtx> = {}): ResolveCtx => ({ sessions: store.all(), teams: [], tasks: tasks.all(), findRole: () => undefined, ...over });
/** task.answer as a card or `action.run` resolves it, then applies it as the daemon does (actionMessage → tasks.run). */
const answer = (task: string, text: string) => {
  const r = resolveAction('task.answer', actionById('task.answer')!.args.parse({ task, answer: text }), ctx());
  if ('refused' in r) return r;
  const msg = actionMessage(r, 'a1');
  if (msg.type !== 'task.cmd') throw new Error(msg.type);
  return { row: r, result: tasks.run(msg) };
};

beforeEach(() => {
  store = new Store({ journalPath: join(mkdtempSync(join(tmpdir(), 'decisions-')), 'j.json') });
  store.upsert(mk('otto', 'Otto')); store.upsert(mk('pim', 'Pim'));
  told = [];
  tasks = createTasks({ store, mailbox: { notify }, now: () => T0 });
});

describe('a decision put to Ledge', () => {
  it('is an open task owned by Ledge, given by the session, and nobody is typed to', () => {
    const d = ask();
    expect(d).toMatchObject({ giver: 'otto', giverName: 'Otto', owner: LEDGE_GIVER, ownerName: 'Ledge', state: 'open' });
    expect(told).toEqual([]);
    expect(transmissions(d)).toEqual([expect.objectContaining({ op: 'give', from: 'otto', to: LEDGE_GIVER })]);
  });

  it('is open until answered: openDecision, never for a task Ledge gave', () => {
    const d = ask();
    const given = tasks.run({ type: 'task.cmd', rid: 'g', by: LEDGE_GIVER, op: 'give', to: 'Pim', title: 'Relire' }).task!;
    expect(tasks.all().filter(openDecision).map(x => x.id)).toEqual([d.id]);
    expect(openDecision(given)).toBe(false);
    answer(d.id, 'oui');
    expect(tasks.all().filter(openDecision)).toEqual([]);
  });

  it('cancelled, it types nothing to anyone as Ledge, and its asker learns it', () => {
    const d = ask(); const e = ask('Autre ?');
    tasks.run({ type: 'task.cmd', rid: 'c', by: LEDGE_GIVER, op: 'cancel', task: d.id, text: 'plus besoin' });
    tasks.run({ type: 'task.cmd', rid: 'r', by: 'otto', op: 'refuse', task: e.id, text: 'je tranche seul' });
    expect(told.map(([to]) => to)).toEqual(['otto']);
    expect(told[0]![1]).toContain('annulée par Ledge');
  });
});

describe('the phone (t05ecf7)', () => {
  it('is sent the decisions waiting with who asks and its options, besides the tasks Ledge gave', () => {
    const d = ask();
    const given = tasks.run({ type: 'task.cmd', rid: 'g', by: LEDGE_GIVER, op: 'give', to: 'Pim', title: 'Relire' }).task!;
    tasks.run({ type: 'task.cmd', rid: 's', by: 'otto', op: 'give', to: 'Pim', title: 'Entre sièges' });
    expect(phoneTasks(tasks.all(), Date.parse(T0)).map(x => x.id)).toEqual([d.id, given.id]);
    const phone = toPhoneTask(d, undefined, undefined);
    expect(phone).toMatchObject({ id: d.id, giver: 'otto', giverName: 'Otto', owner: LEDGE_GIVER, text: 'oui / non ; je recommande oui', state: 'open' });
    expect(PhoneTaskSchema.safeParse(phone).success).toBe(true);
    // A task Ledge gave keeps its detail on the PC: the phone never needed it.
    expect(toPhoneTask(given, undefined, undefined)).not.toHaveProperty('text');
  });

  it('drops an answered decision from the list, but still hears of it so it leaves the screen', () => {
    const d = ask();
    answer(d.id, 'non');
    const done = tasks.all().find(x => x.id === d.id)!;
    expect(phoneTasks(tasks.all(), Date.parse(T0))).toEqual([]);
    expect(forPhone(done)).toBe(true);
    expect(forPhone(tasks.run({ type: 'task.cmd', rid: 's', by: 'otto', op: 'give', to: 'Pim', title: 'x' }).task!)).toBe(false);
  });

  it('is pushed a new decision: who waits, its title, Ledge\'s chat', () => {
    const p = decisionPayload(ask('Fusionner feat/roles ?'), 3);
    expect(p).toEqual({ v: 1, kind: 'decision', title: 'Otto attend votre décision', body: 'Fusionner feat/roles ?', url: '/#/chat', badge: 3, tag: expect.stringMatching(/^t[0-9a-f]{6}$/) });
    expect(PushPayloadSchema.safeParse(p).success).toBe(true);
    expect(PushPayloadSchema.safeParse(decisionPayload(ask('x'.repeat(500)), 5000)).success).toBe(true);
  });
});

describe('task.answer: the one way to answer a decision', () => {
  it('is in the registry, the chat\'s and `ledge action run`\'s, destructive, checked on the phone as « act »', () => {
    expect(ACTION_IDS).toContain('task.answer');
    expect(GENERIC_ACTIONS).toContain('task.answer');
    expect(RUN_ACTIONS).toContain('task.answer');
    expect(actionById('task.answer')).toMatchObject({ risk: 'destructive', phone: 'act', card: 'generic' });
    // The persona is told the answer is the user's own, never Ledge's pick.
    expect(actionById('task.answer')!.when).toContain('sans rien inventer');
  });

  it('closes the decision with the user\'s words and wakes its asker', () => {
    const d = ask();
    const r = answer(d.id, 'Oui, fusionne');
    expect('row' in r && r.result.task).toMatchObject({ state: 'done', result: 'Oui, fusionne' });
    expect(told).toEqual([['otto', expect.stringContaining('Oui, fusionne')]]);
  });

  it('is the user\'s alone: no session runs it, not even a team\'s @leader', () => {
    const d = ask();
    const row = resolveAction('task.answer', { task: d.id, answer: 'oui' }, ctx()) as ChatAction;
    const led: Team = { id: 'team-1', name: 'api', project: 'ledge', machine: 'local', cwd: '/w/ledge', state: 'active', seats: [{ role: 'leader', sessionId: 'pim' }, { role: 'dev', sessionId: 'otto' }], createdAt: T0, updatedAt: T0 };
    const c = ctx({ teams: [led] });
    expect(runGuard(row, undefined, c)).toBeNull();
    expect(runGuard({ ...row, team: 'team-1' }, 'pim', c)).toMatch(/utilisateur/);
    expect(runGuard(row, 'otto', c)).toMatch(/utilisateur/);
  });
});
