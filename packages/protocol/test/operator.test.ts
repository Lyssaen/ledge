import { describe, it, expect } from 'vitest';
import { ChatTurnSchema, PhoneChatTurnSchema, PhoneClientMessageSchema, PointItemSchema, OperatorNoticeSchema, PushPayloadSchema, parseClientMessage, parseServerMessage } from '../src/index.js';

const AT = '2026-11-13T10:00:00.000Z';
const OP = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const item = { id: 'session.request:7f3a', event: 12, group: 'atoi', tone: 'perm', who: 'Otto', text: 'npm test', at: AT };
const point = { since: AT, lead: 'Deux choses pour toi.', leadBy: 'agent', items: [item] };

describe('operator protocol', () => {
  it('a point turn parses with by ledge, an empty question and a point', () => {
    const turn = { qid: 'q1', question: '', askedAt: AT, steps: [], by: 'ledge', point };
    expect(ChatTurnSchema.parse(turn)).toMatchObject({ by: 'ledge', question: '', point: { items: [{ id: item.id }] } });
    expect(PhoneChatTurnSchema.parse({ ...turn, qid: OP })).toMatchObject({ by: 'ledge' });
  });
  it('a turn without point still parses', () => {
    expect(ChatTurnSchema.parse({ qid: 'q1', question: 'Salut', askedAt: AT, steps: [] }).point).toBeUndefined();
  });
  it('PointItem rejects more than 4 answers', () => {
    const answers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, label: 'Ok', style: 'plain' }));
    expect(PointItemSchema.safeParse({ ...item, answers: answers(4) }).success).toBe(true);
    expect(PointItemSchema.safeParse({ ...item, answers: answers(5) }).success).toBe(false);
  });
  it('OperatorNotice requires a priority', () => {
    const notice = { id: 'n1', kind: 'point', text: 'Un point', at: AT };
    expect(OperatorNoticeSchema.safeParse(notice).success).toBe(false);
    expect(OperatorNoticeSchema.safeParse({ ...notice, priority: 'routine' }).success).toBe(true);
    expect(parseServerMessage({ type: 'operator.state', notices: [{ ...notice, priority: 'urgent' }] }).type).toBe('operator.state');
  });
  it('PushPayload accepts kind point', () => {
    const ok = { v: 1, kind: 'point', title: 'Ledge', body: 'Un point', url: '/#/chat', badge: 1, tag: 'point_1' };
    expect(PushPayloadSchema.safeParse(ok).success).toBe(true);
  });
  it('client message point.act parses with an option id or with text', () => {
    expect(parseClientMessage({ type: 'point.act', qid: 'q1', item: item.id, answer: { id: 'allow' } }).type).toBe('point.act');
    expect(parseClientMessage({ type: 'point.act', qid: 'q1', item: item.id, answer: { text: 'oui' } }).type).toBe('point.act');
    expect(() => parseClientMessage({ type: 'point.act', qid: 'q1', item: item.id, answer: {} })).toThrow();
    expect(parseClientMessage({ type: 'point.later', qid: 'q1' }).type).toBe('point.later');
    expect(parseClientMessage({ type: 'operator.read', eventId: 7 }).type).toBe('operator.read');
    expect(PhoneClientMessageSchema.parse({ type: 'point.act', op: OP, qid: OP, item: item.id, answer: { id: 'allow' } }).type).toBe('point.act');
    expect(PhoneClientMessageSchema.parse({ type: 'point.later', op: OP, qid: OP }).type).toBe('point.later');
    expect(PhoneClientMessageSchema.parse({ type: 'operator.read', op: OP, eventId: 3 }).type).toBe('operator.read');
  });
});
