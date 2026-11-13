import { describe, it, expect } from 'vitest';
import type { ChatTurn, ClientMessage, PointItem } from '@ledge/protocol';
import { sendPointReads, sendPointSeen, type PointReadFleet } from '../src/chat/pointReads';

const AT = '2026-11-13T10:00:00.000Z';
const item = (event: number): PointItem => ({ id: `session:s${event}`, event, group: 'done', tone: 'idle', who: 'Otto', text: 'a terminé', at: AT });
const point = (qid: string, ...events: number[]): ChatTurn => ({ qid, question: '', askedAt: AT, steps: [], by: 'ledge', point: { since: AT, lead: 'x', leadBy: 'daemon', items: events.map(item) } } as unknown as ChatTurn);
const plain = (qid: string): ChatTurn => ({ qid, question: 'hi', askedAt: AT, steps: [] } as unknown as ChatTurn);

function fleet(owner: Record<string, string>, down: string[] = []) {
  const sent: Array<{ machine: string; msg: ClientMessage }> = [];
  const f: PointReadFleet = {
    turnMachine: qid => (owner[qid] ? { id: owner[qid]!, ready: !down.includes(owner[qid]!) } : undefined),
    sendTo: (machine, msg) => { sent.push({ machine, msg }); return true; }
  };
  return { f, sent };
}

describe('operator.read goes to the machine owning the point', () => {
  it('opening « À toi » sends each ready machine its own newest point, not the local one\'s to all', () => {
    const { f, sent } = fleet({ a: 'local', b: 'dev', c: 'local', d: 'dev', e: 'off', q: 'local' }, ['off']);
    sendPointReads([point('a', 3), point('b', 40, 41), point('c', 7), plain('q'), point('d', 12), point('e', 99)], f);
    expect(sent).toEqual([
      { machine: 'local', msg: { type: 'operator.read', eventId: 7 } },
      { machine: 'dev', msg: { type: 'operator.read', eventId: 12 } }
    ]);
  });

  it('a point seen in the chat moves its own machine\'s cursor, once per event id there', () => {
    const { f, sent } = fleet({ a: 'local', b: 'dev' });
    const last = new Map<string, number>();
    expect(sendPointSeen('b', 41, f, last)).toBe(true);
    expect(sendPointSeen('b', 41, f, last)).toBe(false);
    expect(sendPointSeen('a', 41, f, last)).toBe(true);
    expect(sendPointSeen('b', 5, f, last)).toBe(true);
    expect(sendPointSeen('nope', 5, f, last)).toBe(false);
    expect(sent.map(s => `${s.machine}:${(s.msg as { eventId: number }).eventId}`)).toEqual(['dev:41', 'local:41', 'dev:5']);
  });
});
