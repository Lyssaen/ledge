import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@ledge/protocol';
import type { startServer } from '../src/daemon/server.js';
import { until } from './helpers.js';
import { ask, bridge, decisions, engine, lone, installLeadHarness, lastUpdate, launch, nextId, noticesTo, pause, reply, send, start, taskNow } from './fixtures/leadDecision.js';

// Lot E, task 3: a lead's question is one item for the fronts. `task.answer` (the TUI's D key, the phone's card) goes through the
// escalation `task-<id>` when there is one (one memory record, the brain told), and the phone hears of it once.

installLeadHarness();

const run = async (action: string, args: Record<string, unknown>) => {
  const rid = `r${nextId()}`;
  send({ type: 'action.run', rid, action, args, confirmed: true } as ClientMessage);
  return reply('action.result', rid);
};

describe('task.answer on a mirrored decision', () => {
  it('goes through the escalation: one memory record, the escalation answered, the task done once, the lead told', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'pending');
    const r = await run('task.answer', { task: t.id, answer: 'oui, vas-y' });
    expect(r.reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    expect(taskNow(t.id)!.log.filter(e => e.op === 'done')).toHaveLength(1);
    expect(lastUpdate(id)).toMatchObject({ state: 'answered', answer: { by: 'user', answers: { text: 'oui, vas-y' } } });
    await until(() => decisions().length === 1);
    expect(decisions()[0]).toMatchObject({ by: 'user', escalationId: id, answers: { text: 'oui, vas-y' } });
    await until(() => noticesTo(lead).some(q => q.text.includes(t.id) && q.text.includes('oui, vas-y')));
    await pause(150);
    expect(decisions()).toHaveLength(1);
  });

  it('a second answer is refused, the first one stays', async () => {
    await start({ brain: false });
    const { lead } = await launch();
    const t = await ask(lead);
    await until(() => lastUpdate(`task-${t.id}`)?.state === 'pending');
    expect((await run('task.answer', { task: t.id, answer: 'un' })).reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    await run('task.answer', { task: t.id, answer: 'deux' });
    await pause(100);
    expect(decisions()).toHaveLength(1);
    expect(taskNow(t.id)!.log.filter(e => e.op === 'done')).toHaveLength(1);
  });
});

describe('under the OpenRig engine a lead\'s question is still Ledge\'s own', () => {
  it('action.run task.answer on a mirrored decision answers through the escalation, as an ask would', async () => {
    await start({ brain: false });
    await until(() => bridge!.status().state === 'running');
    const t = await lone();
    const id = `task-${t.id}`;
    await until(() => lastUpdate(id)?.state === 'pending');
    await engine('openrig');
    const r = await run('task.answer', { task: t.id, answer: 'oui' });
    expect(r.reason).toBeUndefined();
    await until(() => taskNow(t.id)?.state === 'done');
    await until(() => decisions().length === 1);
    expect(decisions()[0]).toMatchObject({ by: 'user', escalationId: id, answers: { text: 'oui' } });
  });
  it('another task action stays refused by the engine', async () => {
    await start({ brain: false });
    const t = await lone();
    await engine('openrig');
    const r = await run('task.cancel', { task: t.id });
    expect(r.reason).toMatch(/OpenRig/);
  });
});

describe('the phone hears of a lead\'s question once', () => {
  it('one push (the escalation\'s), not one for the task and one for the escalation', async () => {
    const { createECDH, randomBytes } = await import('node:crypto');
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), key: 'K1' };
    const sends: { topic?: string }[] = [];
    const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'dev1', approvedAt: new Date().toISOString(), online: true }], pairings: [] };
    const mobile = {
      state: () => state, onChange: () => () => {}, handle: async () => {}, send: async () => true, revoke: async () => {},
      credential: () => null, setCredential: () => {}, pushOf: (id: string) => (id === 'dev1' ? sub : null), setPush: () => {}, relayPushKey: () => 'K1',
      sendPush: async (m: { topic?: string }) => { sends.push(m); return { result: 'sent' as const }; },
      onMessage: () => () => {}, stop: async () => {}
    } as unknown as Parameters<typeof startServer>[0]['mobile'];
    await start({ brain: false, mobile });
    const { lead } = await launch();
    const t = await ask(lead);
    await until(() => sends.length >= 1);
    await pause(300);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.topic).toContain(`task-${t.id}`.replace(/[^a-z0-9_-]/gi, ''));
  });
});
