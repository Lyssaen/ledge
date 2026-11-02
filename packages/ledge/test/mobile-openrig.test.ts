import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PhoneClientMessageSchema, PhoneServerMessageSchema, type HumanAnswer, type HumanAsk, type HumanChannel } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';
import { rigSubject } from '../src/mobile/gateway.js';

afterEach(stopAll);

type G = ReturnType<typeof setup>;
const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const CHANNEL: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const ASK: HumanAsk = { id: 'qitem-1', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Un modèle ou deux ?', body: 'Texte', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q', question: 'Un ou deux ?', options: [{ id: 'one', label: 'Un', recommended: true }, { id: 'two', label: 'Deux', recommended: false }], answer: null }],
  createdAt: '2026-11-02T20:00:00.000Z', updatedAt: '2026-11-02T20:00:00.000Z' };

/** A gateway with « À toi »: `answers` records what reached the daemon's answer. */
function make() {
  const answers: string[] = [];
  let followed = 0;
  const g = setup({ deps: { openrig: {
    async list() { return { channel: CHANNEL, asks: [ASK] }; },
    async answer(qitemId, a) { answers.push(`${qitemId} ${JSON.stringify(a)}`); return { qitemId, ok: true, outcome: 'answered' as const, replyId: 'qitem-reply' }; },
    follow() { followed++; }
  } } });
  return { g, answers, followed: () => followed };
}

const enroll = async (g: G) => {
  const auth = softAuthenticator();
  g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
  await flush();
  const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
  if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
  g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
  await flush();
  return auth;
};
const challengeFor = async (g: G, qitem: string, answer: HumanAnswer) => {
  const before = g.got('dev1').length;
  g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', qitem, answer });
  await flush();
  const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge' || x.type === 'error');
  if (m?.type !== 'confirm.challenge') throw new Error(`no challenge: ${JSON.stringify(m)}`);
  return m.challenge;
};
const answer = async (g: G, msg: object) => {
  const op = randomUUID();
  g.send('dev1', { type: 'openrig.answer', op, ...msg });
  await flush();
  return { result: g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1), told: g.got('dev1').find(m => m.type === 'openrig.answered' && m.op === op) };
};

describe('phone gateway: « À toi »', () => {
  it('says it can, lists this PC\'s asks on request and follows OpenRig, then pushes each change to the devices that asked', async () => {
    const { g, followed } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.daemon.openrig).toBe(true);
    g.send('dev1', { type: 'openrig.asks' });
    await flush();
    const list = g.got('dev1').find(m => m.type === 'openrig.asks');
    expect(list).toEqual({ type: 'openrig.asks', channel: CHANNEL, asks: [ASK] });
    expect(PhoneServerMessageSchema.parse(list)).toBeTruthy();
    expect(followed()).toBe(1);
    // A push of the desktop's list goes to dev1 (it asked), not to dev2; an answer to one desktop's request is not a push.
    g.gw.forward({ type: 'openrig.asksChanged', channel: CHANNEL, asks: [], partial: true });
    g.gw.forward({ type: 'openrig.asksChanged', requestId: 'r', channel: CHANNEL, asks: [ASK] });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'openrig.asks').at(-1)).toEqual({ type: 'openrig.asks', channel: CHANNEL, asks: [], partial: true });
    expect(g.got('dev1').filter(m => m.type === 'openrig.asks')).toHaveLength(2);
    expect(g.got('dev2').some(m => m.type === 'openrig.asks')).toBe(false);
  });

  it('a choice, words or a resolve need the device\'s check bound to that row and that very answer; « Vu » needs none', async () => {
    const { g, answers } = make();
    const choice: HumanAnswer = { kind: 'choice', questionId: 'q', optionId: 'one' };
    // Without a credential or an assertion: refused, nothing reaches OpenRig.
    let r = await answer(g, { qitemId: 'qitem-1', answer: choice });
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(r.told).toMatchObject({ ok: false, rejected: 'confirm_required' });
    const auth = await enroll(g);
    // An assertion for another answer does not approve this one.
    const other = await challengeFor(g, 'qitem-1', { kind: 'choice', questionId: 'q', optionId: 'two' });
    r = await answer(g, { qitemId: 'qitem-1', answer: choice, assertion: auth.get(rp, other, { counter: 1 }) });
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(answers).toEqual([]);
    // The right one goes, once.
    const ch = await challengeFor(g, 'qitem-1', choice);
    r = await answer(g, { qitemId: 'qitem-1', answer: choice, assertion: auth.get(rp, ch, { counter: 2 }) });
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(r.told).toEqual({ type: 'openrig.answered', op: expect.any(String), qitemId: 'qitem-1', ok: true, outcome: 'answered', replyId: 'qitem-reply' });
    expect(PhoneServerMessageSchema.parse(r.told)).toBeTruthy();
    r = await answer(g, { qitemId: 'qitem-1', answer: choice, assertion: auth.get(rp, ch, { counter: 3 }) });
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' }); // a challenge is spent once
    // « Vu » on a piece of news: no check.
    r = await answer(g, { qitemId: 'qitem-2', answer: { kind: 'seen' } });
    expect(r.result).toMatchObject({ status: 'applied' });
    expect(answers).toEqual(['qitem-1 {"kind":"choice","questionId":"q","optionId":"one"}', 'qitem-2 {"kind":"seen"}']);
  });

  it('a long list fits a phone message: texts cut, at most 50 asks, the least pressing left out first, and says so', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ ...ASK, id: `q${i}`, body: 'é'.repeat(20_000), detail: 'd'.repeat(5000) }));
    const g = setup({ deps: { openrig: { async list() { return { channel: CHANNEL, asks: many }; }, async answer(q) { return { qitemId: q, ok: true }; }, follow() {} } } });
    g.send('dev1', { type: 'openrig.asks' });
    await flush();
    const list = g.got('dev1').find(m => m.type === 'openrig.asks');
    if (list?.type !== 'openrig.asks') throw new Error(`no list: ${JSON.stringify(g.got('dev1').map(m => m.type))}`);
    expect(list.truncated).toBe(true);
    expect(list.asks.length).toBeGreaterThan(0);
    expect(list.asks.length).toBeLessThanOrEqual(50);
    expect(list.asks[0]).toMatchObject({ id: 'q0', bodyTruncated: true });
    expect(list.asks[0]!.body).toHaveLength(4000);
    expect(list.asks[0]!.detail).toHaveLength(2000);
    expect(Buffer.byteLength(JSON.stringify(list), 'utf8')).toBeLessThanOrEqual(900_000);
  });

  it('the same op for another row or another answer is a conflict; a replay gets the detailed end again without a second run', async () => {
    const { g, answers } = make();
    const op = randomUUID();
    const go = async (msg: object) => { g.send('dev1', { type: 'openrig.answer', op, ...msg }); await flush(); };
    await go({ qitemId: 'qitem-2', answer: { kind: 'seen' } });
    expect(g.results('dev1').filter(r => r.op === op).at(-1)).toMatchObject({ status: 'applied' });
    await go({ qitemId: 'qitem-3', answer: { kind: 'seen' } });
    expect(g.results('dev1').filter(r => r.op === op).at(-1)).toMatchObject({ status: 'rejected', reason: 'conflict' });
    const before = g.got('dev1').filter(m => m.type === 'openrig.answered').length;
    await go({ qitemId: 'qitem-2', answer: { kind: 'seen' } }); // the same: a replay
    expect(g.results('dev1').filter(r => r.op === op).at(-1)).toMatchObject({ status: 'applied' });
    const told = g.got('dev1').filter(m => m.type === 'openrig.answered');
    expect(told).toHaveLength(before + 1);
    expect(told.at(-1)).toEqual({ type: 'openrig.answered', op, qitemId: 'qitem-2', ok: true, outcome: 'answered', replyId: 'qitem-reply' });
    expect(answers).toEqual(['qitem-2 {"kind":"seen"}']);
  });

  it('a detail cut for the phone says so', async () => {
    const g = setup({ deps: { openrig: { async list() { return { channel: CHANNEL, asks: [{ ...ASK, detail: 'x'.repeat(2100) }, { ...ASK, id: 'short', detail: 'court' }] }; }, async answer(q) { return { qitemId: q, ok: true }; }, follow() {} } } });
    g.send('dev1', { type: 'openrig.asks' });
    await flush();
    const list = g.got('dev1').find(m => m.type === 'openrig.asks');
    if (list?.type !== 'openrig.asks') throw new Error('no list');
    expect(list.asks[0]).toMatchObject({ detailTruncated: true, bodyTruncated: false });
    expect(list.asks[0]!.detail).toHaveLength(2000);
    expect(list.asks[1]).not.toHaveProperty('detailTruncated');
  });

  it('binds the subject to the row and the exact words', () => {
    expect(rigSubject('q1', { kind: 'words', text: 'Oui' })).not.toBe(rigSubject('q1', { kind: 'words', text: 'Non' }));
    expect(rigSubject('q1', { kind: 'words', text: 'Oui' })).not.toBe(rigSubject('q2', { kind: 'words', text: 'Oui' }));
    expect(rigSubject('q1', { kind: 'words', text: 'Oui' })).not.toBe(rigSubject('q1', { kind: 'resolve', text: 'Oui' }));
    expect(rigSubject('q1', { kind: 'words', text: 'Oui' })).toBe(rigSubject('q1', { kind: 'words', text: 'Oui' }));
  });

  it('refuses a challenge for « Vu » or without its row, and everything on a gateway without « À toi »', async () => {
    const { g } = make();
    await enroll(g);
    for (const prepare of [{ qitem: 'qitem-1', answer: { kind: 'seen' } }, { answer: { kind: 'words', text: 'x' } }, { qitem: 'qitem-1' }]) {
      const before = g.got('dev1').length;
      g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', ...prepare });
      await flush();
      expect(g.got('dev1').slice(before)).toContainEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    }
    const bare = setup();
    bare.send('dev1', { type: 'openrig.asks' });
    const op = randomUUID();
    bare.send('dev1', { type: 'openrig.answer', op, qitemId: 'q', answer: { kind: 'seen' } });
    await flush();
    expect(bare.got('dev1')).toContainEqual({ type: 'error', code: 'invalid', request: 'openrig.asks' });
    expect(bare.results('dev1').filter(r => r.op === op).at(-1)).toMatchObject({ status: 'rejected', reason: 'unavailable' });
  });

  it('the phone protocol takes the new messages and refuses an empty answer', () => {
    expect(PhoneClientMessageSchema.parse({ type: 'openrig.asks' })).toBeTruthy();
    expect(() => PhoneClientMessageSchema.parse({ type: 'openrig.answer', op: randomUUID(), qitemId: 'q', answer: { kind: 'words', text: ' ' } })).toThrow();
  });
});
