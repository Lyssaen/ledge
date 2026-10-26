import { describe, expect, it } from 'vitest';
import type { ReceivedItem, SentItem, ThreadItem } from '@ledge/protocol';
import { T0 } from '@ledge/fleet/test/mockDaemon';
import { conversation, conversationName, conversationPeer } from '../src/session/conversation';

// Otto (A, the page's agent, raw daemon id 'otto') and Nova (B, 'nova'): A's thread names Nova by peerKey 'nova', Nova's
// thread names Otto by its `peer` 'otto'.
const T = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const aSent = (id: string, s: number, extra: Partial<SentItem> = {}): SentItem =>
  ({ kind: 'sent', id, at: T(s), turn: 1, to: 'nova', peer: 'nova', text: `Texte ${id}`, status: 'delivered', ...extra });
const aRecv = (id: string, s: number, extra: Partial<ReceivedItem> = {}): ReceivedItem =>
  ({ kind: 'received', id, at: T(s), turn: 1, from: 'nova', peer: 'nova', text: `Texte ${id}`, ...extra });
const bSent = (id: string, s: number, extra: Partial<SentItem> = {}): SentItem =>
  ({ kind: 'sent', id, at: T(s), turn: 1, to: 'otto', peer: 'otto', text: `Texte ${id}`, status: 'delivered', ...extra });
const bRecv = (id: string, s: number, extra: Partial<ReceivedItem> = {}): ReceivedItem =>
  ({ kind: 'received', id, at: T(s), turn: 1, from: 'otto', peer: 'otto', text: `Texte ${id}`, ...extra });
/** The same item without `peer`: a session Ledge does not know (another machine, a process it did not launch). */
const unknown = <I extends SentItem | ReceivedItem>(i: I): I => { const { peer: _peer, ...rest } = i; return rest as I; };
const keys = (a: readonly ThreadItem[], b: readonly ThreadItem[] | undefined, key = 'nova') => conversation(a, b, key, 'otto').map(x => x.key);

describe('conversation (the merge of two threads)', () => {
  it('pairs Otto\u2019s message with Nova\u2019s copy, by r.sent or by s.received', () => {
    const one = { key: 'a:s1', from: 'a', at: T(10), summary: 'Le schéma est prêt', text: 'Tout est dans docs/schema.md.', status: 'read', inA: 's1', inB: 'recv-1-0' };
    const s = (extra: Partial<SentItem> = {}) => aSent('s1', 10, { status: 'read', summary: 'Le schéma est prêt', text: 'Tout est dans docs/schema.md.', ...extra });
    // Both links.
    expect(conversation([s({ received: 'recv-1-0' })], [bRecv('recv-1-0', 12, { sent: 's1', text: 'Tout est dans docs/schema.md.' })], 'nova', 'otto')).toEqual([one]);
    // Only Nova's copy names Otto's item.
    expect(conversation([s()], [bRecv('recv-1-0', 12, { sent: 's1', text: 'Tout est dans docs/schema.md.' })], 'nova', 'otto')).toEqual([one]);
    // Only Otto's item names Nova's copy.
    expect(conversation([s({ received: 'recv-1-0' })], [bRecv('recv-1-0', 12, { text: 'Tout est dans docs/schema.md.' })], 'nova', 'otto')).toEqual([one]);
  });

  it('pairs Nova\u2019s message with Otto\u2019s copy; time and summary from Nova\u2019s item', () => {
    expect(conversation(
      [aRecv('r1', 30, { sent: 'b1', text: 'Merci, je regarde.' })],
      [bSent('b1', 20, { summary: 'Reçu', text: 'Merci, je regarde.', status: 'read', received: 'r1' })],
      'nova', 'otto'
    )).toEqual([{ key: 'a:r1', from: 'b', at: T(20), summary: 'Reçu', text: 'Merci, je regarde.', status: 'read', inA: 'r1', inB: 'b1' }]);
  });

  it('a message Nova wrote that Otto has not received yet stands alone', () => {
    const [b] = conversation([], [bSent('b2', 40, { status: 'delivered', summary: 'Une question', text: 'Tu as la migration ?' })], 'nova', 'otto');
    expect(b).toMatchObject({ key: 'b:b2', from: 'b', at: T(40), summary: 'Une question', text: 'Tu as la migration ?', status: 'delivered', inB: 'b2' });
    expect(b!.inA).toBeUndefined();
  });

  it('Otto\u2019s message after a /clear: only Nova\u2019s copy, on Otto\u2019s side, read', () => {
    const out = conversation([], [bRecv('rX', 15, { sent: 'gone', text: 'Avant le /clear.' })], 'nova', 'otto');
    expect(out).toEqual([{ key: 'b:rX', from: 'a', at: T(15), text: 'Avant le /clear.', status: 'read', inB: 'rX' }]);
    expect(out[0]!.summary).toBeUndefined();
    expect(out[0]!.inA).toBeUndefined();
  });

  it('two queued messages: two bubbles in Nova\u2019s order, each paired', () => {
    const out = conversation(
      [aRecv('recv-3-0', 25, { sent: 'b1' }), aRecv('recv-3-1', 25, { sent: 'b2' })],
      [bSent('b1', 20), bSent('b2', 21)],
      'nova', 'otto'
    );
    expect(out.map(x => x.key)).toEqual(['a:recv-3-0', 'a:recv-3-1']);
    expect(out.map(x => x.at)).toEqual([T(20), T(21)]);
    expect(out.map(x => x.inB)).toEqual(['b1', 'b2']);
  });

  it('ids are unique per thread only', () => {
    const out = keys([aRecv('recv-1-0', 12, { sent: 'b1' })], [bSent('b1', 10), bRecv('recv-1-0', 14, { sent: 'gone' })]);
    expect(out).toContain('a:recv-1-0');
    expect(out).toContain('b:recv-1-0');
    expect(out).toHaveLength(2);
    expect(new Set(out).size).toBe(2);
  });

  it('orders by the sender\u2019s time, stable on ties', () => {
    expect(keys([aSent('sA', 5), aRecv('rA', 4, { sent: 'unknown' })], [bSent('bOnly', 3)])).toEqual(['b:bOnly', 'a:rA', 'a:sA']);
    // Same `at`: A's then B's, as they came in.
    expect(keys([aSent('x', 7)], [bSent('y', 7)])).toEqual(['a:x', 'b:y']);
  });

  it('one side only: Otto\u2019s messages keep their status, those Otto received read', () => {
    const out = conversation(
      [unknown(aSent('s1', 1, { to: 'harness-assistant-bf', status: 'delivered' })), unknown(aRecv('r1', 2, { from: 'harness-assistant-bf' }))],
      undefined, 'harness-assistant-bf', 'otto'
    );
    expect(out.map(x => x.key)).toEqual(['a:s1', 'a:r1']);
    expect(out.map(x => x.status)).toEqual(['delivered', 'read']);
    expect(out.every(x => x.inB === undefined)).toBe(true);
  });

  it('a third agent\u2019s messages and a subagent\u2019s are left out', () => {
    const out = keys(
      [aSent('toKit', 1, { to: 'kit', peer: 'kit' }), aSent('fromHelper', 2, { helperId: 'h1' }), aSent('keepA', 3)],
      [bSent('novaToKit', 4, { to: 'kit', peer: 'kit' }), bRecv('helperCopy', 5, { helperId: 'h9' }), bSent('keepB', 6)]
    );
    expect(out).toEqual(['a:keepA', 'b:keepB']);
  });

  it('nothing between them', () => {
    expect(conversation([], [], 'nova', 'otto')).toEqual([]);
  });

  it('conversationPeer: Nova\u2019s raw id when A\u2019s items carry it; null when they only name the peer; the key when none is left', () => {
    expect(conversationPeer([aSent('s1', 1), aRecv('r1', 2)], 'nova')).toBe('nova');
    expect(conversationPeer([unknown(aRecv('r1', 1, { from: 'harness-assistant-bf' })), unknown(aSent('s1', 2, { to: 'harness-assistant-bf' }))], 'harness-assistant-bf')).toBeNull();
    expect(conversationPeer([], 'nova')).toBe('nova');
  });

  it('conversationName: the raw name A\u2019s latest item gives, else the key', () => {
    expect(conversationName([unknown(aRecv('r1', 1, { from: 'harness-assistant-bf' }))], 'harness-assistant-bf')).toBe('harness-assistant-bf');
    expect(conversationName([aSent('s1', 1, { to: 'nova-old' }), aRecv('r1', 2, { from: 'Nova' })], 'nova')).toBe('Nova');
    expect(conversationName([], 'nova')).toBe('nova');
  });
});
