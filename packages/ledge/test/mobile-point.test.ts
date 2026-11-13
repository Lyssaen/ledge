import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ChatPoint, HumanAnswer, HumanAsk, HumanChannel, PointAnswer } from '@ledge/protocol';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { flush, setup, stopAll } from './helpers/gateway.js';

afterEach(stopAll);

const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
const CHANNEL: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const QP = randomUUID();
const AT = '2026-11-13T10:00:00.000Z';
const ASK: HumanAsk = { id: 'qitem-1', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Un modèle ou deux ?', body: 'Texte', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q', question: 'Un ou deux ?', options: [{ id: 'one', label: 'Un', recommended: true }, { id: 'two', label: 'Deux', recommended: false }], answer: null }],
  createdAt: AT, updatedAt: AT };
const POINT: ChatPoint = { since: AT, lead: 'lead', leadBy: 'daemon', items: [
  { id: 'rig.ask:qitem-1', event: 1, group: 'atoi', tone: 'ask', who: 'pilot-lead', text: 'Un modèle ou deux ?', at: AT, ref: { kind: 'rig.ask', qitem: 'qitem-1' }, freeText: true },
  { id: 'rig.ask:old', event: 2, group: 'atoi', tone: 'ask', who: 'x', text: 'done', at: AT, ref: { kind: 'rig.ask', qitem: 'old' }, settled: { at: AT, where: 'terminal' } }] };

function make() {
  const acted: string[] = []; const later: string[] = []; const read: string[] = [];
  const turn = { qid: QP, question: '', askedAt: AT, steps: [], by: 'ledge', point: POINT };
  const chats = {
    device: () => ({ history: () => [turn] }) as never, async deviceTool() { return 'codex' as const; },
    owner: (qid: string) => (qid === QP ? ('device:dev1' as const) : undefined), peek: () => undefined, async drop() {}, setEmitter() {}
  };
  const g = setup({ chats: chats as never, deps: {
    openrig: { async list() { return { channel: CHANNEL, asks: [ASK] }; }, async answer(q) { return { qitemId: q, ok: true }; }, follow() {} },
    point: {
      async act(device, m) { acted.push(`${device} ${m.item} ${JSON.stringify(m.answer)}`); return { ok: true as const }; },
      later: (device, qid) => { later.push(`${device} ${qid}`); }, read: (device, id) => { read.push(`${device} ${id}`); }
    }
  } });
  return { g, acted, later, read };
}
type G = ReturnType<typeof make>['g'];

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
const pointAct = async (g: G, msg: object) => {
  const op = randomUUID();
  g.send('dev1', { type: 'point.act', op, qid: QP, item: 'rig.ask:qitem-1', ...msg });
  await flush();
  return g.results('dev1').filter(r => r.op === op && r.status !== 'received').at(-1);
};
const choice: PointAnswer = { id: 'one' };

describe('phone gateway: the operator point', () => {
  it('point.act on a rig ask needs the device passkey like openrig.answer', async () => {
    const { g, acted } = make();
    const auth = await enroll(g);
    expect(await pointAct(g, { answer: choice })).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    expect(acted).toEqual([]);
    // The challenge is the one `openrig.answer` takes, over the answer the option stands for.
    const mapped: HumanAnswer = { kind: 'choice', questionId: 'q', optionId: 'one' };
    const other: HumanAnswer = { kind: 'choice', questionId: 'q', optionId: 'two' };
    const prepare = async (answer: HumanAnswer) => {
      const before = g.got('dev1').length;
      g.send('dev1', { type: 'confirm.prepare', purpose: 'rig', qitem: 'qitem-1', answer });
      await flush();
      const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
      if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
      return m.challenge;
    };
    expect(await pointAct(g, { answer: choice, assertion: auth.get(rp, await prepare(other), { counter: 1 }) })).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(acted).toEqual([]);
    expect(await pointAct(g, { answer: choice, assertion: auth.get(rp, await prepare(mapped), { counter: 2 }) })).toMatchObject({ status: 'applied' });
    expect(acted).toEqual(['dev1 rig.ask:qitem-1 {"id":"one"}']);
  });

  it('a settled row needs no check: the daemon says so on it', async () => {
    const { g, acted } = make();
    expect(await pointAct(g, { item: 'rig.ask:old', answer: choice })).toMatchObject({ status: 'applied' });
    expect(acted).toEqual(['dev1 rig.ask:old {"id":"one"}']);
  });

  it('point.later and operator.read reach the daemon for this device only; a point of another thread is unknown', async () => {
    const { g, later, read } = make();
    const op = randomUUID();
    g.send('dev1', { type: 'point.later', op, qid: QP });
    g.send('dev1', { type: 'operator.read', op: randomUUID(), eventId: 9 });
    g.send('dev1', { type: 'point.later', op: randomUUID(), qid: randomUUID() });
    await flush();
    expect(later).toEqual([`dev1 ${QP}`]); expect(read).toEqual(['dev1 9']);
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['unknown_session']);
  });

  it('is not offered by a gateway without the operator', async () => {
    const g = setup({});
    const op = randomUUID();
    g.send('dev1', { type: 'operator.read', op, eventId: 1 });
    await flush();
    expect(g.results('dev1').find(r => r.op === op && r.status !== 'received')).toMatchObject({ status: 'rejected', reason: 'not_offered' });
  });
});
