import { describe, expect, it } from 'vitest';
import type { ClientMessage, Escalation, Task } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { parseBrainArgs } from '../src/daemon/brain/commands.js';
import { guardDecide, validAnswers } from '../src/daemon/brain/guard.js';
import { DEFAULT_MANDATE, parseMandate } from '../src/daemon/brain/mandate.js';
import { createAnswers } from '../src/daemon/openrig/answer.js';
import { createTasks } from '../src/daemon/tasks.js';
import { formatBrainEvent } from '../src/daemon/brain/inbox.js';
import { brainInstructions } from '../src/daemon/brain/persona.js';
import { decisionToEscalation } from '../src/daemon/openrig/decisions.js';
import { engineRefusal, ENGINE_LEDGE } from '../src/daemon/engine/guard.js';
import { until } from './helpers.js';
import { answer, ask, brain, engine, lone, bridge, decisions, GRACE, home, installLeadHarness, lastUpdate, launch, msgs, nextId, noticesTo, OPTIONS, pause, QUESTION, reply, send, srv, start, store, taskNow, updates, work } from './fixtures/leadDecision.js';

// Lot E, task 2: a lead's question (`ledge task give ledge …`, a decision task) is an escalation `task-<id>` (source `ask`):
// grace, the brain's `decide --text` within the mandate or the user's answer, and the answer closes the task, which wakes the lead.

installLeadHarness();

describe('a lead\'s question becomes an escalation', () => {
  it('task give ledge gives escalation task-<id>, source ask, on the team', async () => {
    await start({ brain: false });
    const { team, lead } = await launch();
    const t = await ask(lead);
    await until(() => updates(`task-${t.id}`).length > 0);
    expect(lastUpdate(`task-${t.id}`)).toMatchObject({ id: `task-${t.id}`, source: 'ask', machine: 'local', rigId: team.id, from: store.get(lead)!.name, intent: 'decision',
      summary: QUESTION, detail: OPTIONS, questions: [], state: 'pending' });
  });

  it('[probe] the decisions book stays live while the bridge only probes OpenRig (Ledge engine), and across a whole turn', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => bridge!.escalation(id) !== undefined);
    expect(bridge!.rigs()).toEqual([]);
    bridge!.setProbeOnly(false); expect(bridge!.escalations().map(e => e.id)).toContain(id);
    bridge!.setProbeOnly(true); expect(bridge!.escalations().map(e => e.id)).toContain(id);
  });
});

describe('the brain settles it within the mandate', () => {
  it('grace, an escalation event with --text, then decide --text closes the task as Ledge, wakes the lead, records the decision', async () => {
    await start({ brain: true });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    await until(() => noticesTo('brain').some(q => q.text.includes('<ledge-event kind="escalation"') && q.text.includes(`ledge brain decide ${id}`)));
    expect(noticesTo('brain').find(q => q.text.includes(`id="${id}"`))!.text).toContain('--text');
    const r = await brain('decide', [id, '--text', 'oui', '--category', 'git']);
    expect(r).toMatchObject({ ok: true, line: expect.stringMatching(/^Noté/) });
    expect(taskNow(t.id)?.state ?? 'open').toBe('open');
    await until(() => taskNow(t.id)?.state === 'done', 5000);
    expect(taskNow(t.id)).toMatchObject({ state: 'done', result: 'Réponse de Ledge : oui' });
    await until(() => noticesTo(lead).some(q => q.text.includes(t.id) && q.text.includes('terminée par Ledge')));
    await until(() => decisions().length === 1);
    expect(decisions()[0]).toMatchObject({ by: 'ledge', category: 'git', escalationId: id, answers: { text: 'oui' } });
    expect(lastUpdate(id)).toMatchObject({ state: 'answered', answer: { by: 'ledge', answers: { text: 'oui' } } });
  });

  it('the guard: decide --text in a category the user keeps goes up to the user, the task stays open', async () => {
    await start({ brain: true });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    expect(await brain('decide', [id, '--text', 'oui', '--category', 'design'])).toMatchObject({ ok: false, code: 'mandate' });
    await until(() => lastUpdate(id)?.state === 'pending');
    expect(lastUpdate(id)).toMatchObject({ state: 'pending', category: 'design' });
    expect(await brain('ask', [id, '--advice', 'je dirais oui'])).toMatchObject({ ok: true });
    await until(() => lastUpdate(id)?.advice === 'je dirais oui');
    expect(lastUpdate(id)!.state).toBe('pending');
    await pause(GRACE + 200);
    expect(taskNow(t.id)?.state ?? 'open').toBe('open');
    expect(srv!.decisions.list().map(x => x.id)).toContain(t.id);
  });

  it('decide --answer on a task- escalation is invalid; --text with --answer is a usage error', async () => {
    await start({ brain: true });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    expect(await brain('decide', [id, '--answer', 'q1=oui', '--category', 'git'])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await brain('decide', [id, '--text', 'oui', '--answer', 'q1=a', '--category', 'git'])).toMatchObject({ ok: false, code: 'invalid', line: expect.stringMatching(/^ledge brain decide/) });
  });
});

describe('the brain\'s words and the brain\'s comings and goings', () => {
  it('decide --text with a critical word goes up to the user, the task stays open', async () => {
    await start({ brain: true });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    expect(await brain('decide', [id, '--text', 'oui, force-push', '--category', 'git'])).toMatchObject({ ok: false, code: 'mandate', line: expect.stringContaining('force-push') });
    await until(() => lastUpdate(id)?.state === 'pending');
    expect(lastUpdate(id)).toMatchObject({ state: 'pending', category: 'critical' });
    expect(await brain('ask', [id, '--advice', 'à toi de voir'])).toMatchObject({ ok: true });
    await until(() => lastUpdate(id)?.advice === 'à toi de voir');
    await pause(GRACE + 200);
    expect(taskNow(t.id)?.state ?? 'open').toBe('open');
    expect(decisions()).toEqual([]);
  });

  it('brain off, a question waits; the brain comes on: the question is graced and the brain told', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'pending');
    await pause(200);
    expect(noticesTo('brain')).toEqual([]);
    const at = new Date().toISOString();
    store.upsert({ id: 'brain', name: 'Ledge', tool: 'claude', cwd: home, project: 'x', title: 'Ledge', tmuxSession: 'ledge-brain', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher', brain: true } as never);
    await until(() => lastUpdate(id)?.state === 'grace');
    await until(() => noticesTo('brain').some(q => q.text.includes(`id="${id}"`) && q.text.includes(`ledge brain decide ${id} --text`)));
    // Told once: a later change of the brain does not grace it again.
    store.upsert({ ...store.get('brain')!, state: 'working' }); store.upsert({ ...store.get('brain')!, state: 'idle' });
    await pause(100);
    expect(noticesTo('brain').filter(q => q.text.includes(`<ledge-event kind="escalation" id="${id}"`))).toHaveLength(1);
  });

  it('a lead question in grace survives a switch to the Ledge engine', async () => {
    await start({ brain: true });
    await until(() => bridge!.status().state === 'running');
    const t = await lone();
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    await engine('openrig');
    await engine('ledge');
    await pause(100);
    expect(bridge!.escalation(id)!.state).toBe('grace');
    expect(lastUpdate(id)!.state).toBe('grace');
  });

  it('under the OpenRig engine, a task- answer still closes the task', async () => {
    await start({ brain: false });
    await until(() => bridge!.status().state === 'running');
    const t = await lone();
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'pending');
    await engine('openrig');
    expect(await answer(id, 'oui')).toMatchObject({ ok: true });
    await until(() => taskNow(t.id)?.state === 'done');
    expect(taskNow(t.id)!.result).toBe("Réponse de l'utilisateur : oui");
  });
});

describe('Review Focus', () => {
  it('1. brain off: the escalation stays pending; the user\'s answer closes the task and wakes the lead', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => updates(id).length > 0);
    await pause(GRACE + 100);
    expect(lastUpdate(id)!.state).toBe('pending');
    expect(bridge!.escalation(id)!.state).toBe('pending');
    // The Ledge engine lets a task- answer through (its own escalation, as an ask- one).
    const r = await answer(id, 'non');
    expect(r).toMatchObject({ ok: true });
    expect(r.reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    expect(taskNow(t.id)).toMatchObject({ state: 'done', result: "Réponse de l'utilisateur : non" });
    await until(() => noticesTo(lead).some(q => q.text.includes(t.id) && q.text.includes('terminée par Ledge')));
    await until(() => decisions().length === 1);
    expect(decisions()[0]).toMatchObject({ by: 'user', escalationId: id, answers: { text: 'non' } });
  });

  it('2. the user answers during the grace: the deferred decision of the brain closes nothing again', async () => {
    await start({ brain: true });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'grace');
    expect(await brain('decide', [id, '--text', 'oui', '--category', 'git'])).toMatchObject({ ok: true, line: expect.stringMatching(/^Noté/) });
    expect(await answer(id, 'non')).toMatchObject({ ok: true });
    await until(() => taskNow(t.id)?.state === 'done');
    await pause(GRACE + 300);
    const final = taskNow(t.id)!;
    expect(final.result).toBe("Réponse de l'utilisateur : non");
    expect(final.log.filter(e => e.op === 'done')).toHaveLength(1);
    expect(decisions().map(d => d.by)).toEqual(['user']);
    expect(noticesTo(lead).filter(q => q.text.includes(t.id) && q.text.includes('terminée par'))).toHaveLength(1);
  });

  it.each([[false], [true]])('3. the lead ends before the answer (brain %s): task dropped, escalation removed, a late answer refused', async on => {
    await start({ brain: on });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === (on ? 'grace' : 'pending'));
    store.upsert({ ...store.get(lead)!, state: 'exited' });
    await until(() => taskNow(t.id)?.state === 'dropped');
    await until(() => msgs.some(m => m.type === 'escalation.removed' && m.id === id));
    expect(bridge!.escalation(id)).toBeUndefined();
    expect(bridge!.escalations().map(e => e.id)).not.toContain(id);
    const late = await answer(id, 'oui');
    expect(late.ok).toBe(false);
    expect(late.reason).not.toBe(ENGINE_LEDGE);
    expect(taskNow(t.id)!.log.filter(e => e.op === 'done')).toHaveLength(0);
    if (on) {
      const r = await brain('decide', [id, '--text', 'oui', '--category', 'git']);
      expect(r.ok).toBe(false);
    }
  });
});

describe('the pieces', () => {
  const task: Task = { id: 't1a2b3c', title: QUESTION, text: OPTIONS, giver: 's1', giverName: 'Lead', owner: 'ledge', ownerName: 'Ledge', team: 'team-x', state: 'open',
    at: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', log: [] };

  it('decisionToEscalation', () => {
    expect(decisionToEscalation(task, { machine: 'local' })).toEqual({ id: 'task-t1a2b3c', source: 'ask', machine: 'local', rigId: 'team-x', from: 'Lead', intent: 'decision',
      summary: QUESTION, detail: OPTIONS, questions: [], createdAt: task.at, state: 'pending' });
    const { team: _t, text: _x, ...lone } = task;
    expect(decisionToEscalation(lone, { machine: 'local' })).toEqual({ id: 'task-t1a2b3c', source: 'ask', machine: 'local', from: 'Lead', intent: 'decision',
      summary: QUESTION, questions: [], createdAt: task.at, state: 'pending' });
  });

  it('parseBrainArgs: --text, which excludes --answer', () => {
    expect(parseBrainArgs('decide', ['task-t1', '--text', 'oui, fusionne', '--category', 'git', '--why', 'tests verts'])).toEqual({ ok: true,
      value: { op: 'decide', id: 'task-t1', answers: { text: 'oui, fusionne' }, category: 'git', why: 'tests verts' } });
    const both = parseBrainArgs('decide', ['task-t1', '--text', 'oui', '--answer', 'q=a', '--category', 'git']);
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.usage).toContain('--text "<réponse>"');
    expect(parseBrainArgs('decide', ['task-t1', '--text', 'oui']).ok).toBe(false);
  });

  it('validAnswers: free text for a task- escalation, never options', () => {
    const e = decisionToEscalation(task, { machine: 'local' });
    expect(validAnswers(e, { text: 'oui' })).toBeNull();
    expect(validAnswers(e, { text: '  ' })).not.toBeNull();
    expect(validAnswers(e, { q1: 'oui' })).not.toBeNull();
    expect(validAnswers(e, { text: 'oui', q1: 'a' })).not.toBeNull();
    expect(validAnswers(e, { text: 'x'.repeat(20_001) })).not.toBeNull();
    // An ask- one still has nothing to settle.
    expect(validAnswers({ ...e, id: 'ask-a1' }, { text: 'oui' })).not.toBeNull();
    // An OpenRig escalation with questions is not settled in free text.
    const rig: Escalation = { ...e, id: 'qi-1', source: 'rig', questions: [{ id: 'q1', question: 'Fusionner ?', options: [{ id: 'oui', label: 'Oui' }, { id: 'non', label: 'Non' }] }] };
    expect(validAnswers(rig, { text: 'oui' })).not.toBeNull();
    expect(validAnswers(rig, { q1: 'oui' })).toBeNull();
  });

  it('guardDecide: the brain\'s own free text is scanned for critical words', () => {
    const e = decisionToEscalation(task, { machine: 'local' });
    const mandate = parseMandate(DEFAULT_MANDATE);
    expect(guardDecide(e, 'git', { text: 'oui' }, mandate)).toEqual({ ok: true, category: 'git' });
    expect(guardDecide(e, 'git', { text: 'oui, force-push' }, mandate)).toMatchObject({ ok: false, convert: 'ask', category: 'critical', reason: 'contient « force-push »' });
  });

  it('a task- delivery to a task closed meanwhile is refused and rolled back; a missing task is not « already answered »', async () => {
    const store = new Store(); const at = new Date().toISOString();
    store.upsert({ id: 'solo', name: 'Solo', tool: 'claude', cwd: '/w', project: 'x', title: 'Solo', tmuxSession: 'ledge-solo', state: 'idle', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' } as never);
    const tasks = createTasks({ store, mailbox: { notify: () => true } });
    const t = tasks.run({ type: 'task.cmd', rid: 'g', by: 'solo', op: 'give', to: 'ledge', title: QUESTION }).task!;
    tasks.run({ type: 'task.cmd', rid: 'c', by: 'solo', op: 'cancel', task: t.id });
    const held = new Map<string, Escalation>(); const patches: unknown[] = [];
    for (const x of [decisionToEscalation(t, { machine: 'local' }), { ...decisionToEscalation(t, { machine: 'local' }), id: 'task-tnope00' }]) held.set(x.id, { ...x, state: 'grace', graceUntil: at });
    const answers = createAnswers({ tasks, path: { kind: 'reply-and-approve' }, localMachine: 'local', port: {
      escalation: id => held.get(id), patch: (id, p) => { patches.push(p); const next = { ...held.get(id)!, ...p } as Escalation; for (const k of Object.keys(p) as (keyof Escalation)[]) if (p[k] === undefined) delete next[k]; held.set(id, next); return next; },
      status: () => ({ machine: 'local', state: 'stopped' }), cli: () => ({ queueCreate: async () => ({ ok: false }) }) as never, http: () => null, replyRow: () => undefined, setReplyRow: () => {} } });
    expect(await answers.answer(`task-${t.id}`, { text: 'oui' }, 'user')).toMatchObject({ ok: false, code: 'already_answered' });
    expect(held.get(`task-${t.id}`)).toMatchObject({ state: 'grace', graceUntil: at });
    expect(held.get(`task-${t.id}`)!.answer).toBeUndefined();
    expect(patches).toHaveLength(2);
    expect(await answers.answer('task-tnope00', { text: 'oui' }, 'ledge')).toMatchObject({ ok: false, code: 'failed', reason: expect.stringContaining('aucune tâche') });
    expect(held.get('task-tnope00')).toMatchObject({ state: 'grace' });
    expect(tasks.all().find(x => x.id === t.id)!.log.filter(e => e.op === 'done')).toHaveLength(0);
  });

  it('the brain\'s texts: the event of a task- escalation, the commands table', () => {
    const line = formatBrainEvent({ kind: 'escalation', escalation: decisionToEscalation(task, { machine: 'local' }), rules: [] });
    expect(line).toContain(`question du lead de l'équipe team-x : tranche-la avec ledge brain decide task-t1a2b3c --text "<réponse>" --category <cat>, ou remonte-la avec ledge brain ask task-t1a2b3c --advice "…"`);
    expect(brainInstructions({ mandate: '', rules: [], decisions: [], tool: 'claude' })).toContain('--text "<réponse>"');
  });

  it('the engine guard lets a task- answer through in Ledge mode, as an ask- one; an OpenRig one stays refused', () => {
    const msg = (id: string): ClientMessage => ({ type: 'escalation.answer', rid: 'r', id, answers: { text: 'oui' }, by: 'user' });
    expect(engineRefusal('ledge', msg('task-t1a2b3c'))).toBeNull();
    expect(engineRefusal('ledge', msg('ask-a1'))).toBeNull();
    expect(engineRefusal('ledge', msg('qi-1'))).toBe(ENGINE_LEDGE);
  });
});
