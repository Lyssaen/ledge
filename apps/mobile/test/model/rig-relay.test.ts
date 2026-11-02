import { describe, expect, it } from 'vitest';
import { THREAD_TEXT_MAX, type PhoneSession, type ThreadItem } from '@ledge/protocol';
import { toPhoneItem } from '../../../../packages/ledge/src/mobile/project';
import { threadItems } from '../../src/model/thread';
import { session } from './fixtures';
import { at, rigHandoff, rigNotice, rigReceived, rigSent } from './rig-fixtures';

/** The thread items through the relay's real projection (packages/ledge/src/mobile/project.ts), as the phone gets them. */
const relayed = (items: ThreadItem[]) => {
  const projected = items.map(i => toPhoneItem(i));
  return { items: projected.map(p => p.item), cut: projected.filter(p => p.cut).map(p => p.item.id) };
};
const sessions = new Map<string, PhoneSession>([['bix', session('bix', { name: 'Bix' })]]);
const of = (items: ThreadItem[]) => { const r = relayed(items); return threadItems(r.items, session('lu', { name: 'Lu' }), {}, Date.now(), r.cut, sessions); };

describe('OpenRig through the relay', () => {
  it('keeps every rig field the phone reads', () => {
    const items = of([
      rigReceived('r1', at(19, 1), 'Validation', { count: 2, sentAt: at(19, 0) }, 'bix'),
      rigHandoff('h1', at(19, 2), 'Retouche maquette', {}, { peer: 'bix' }),
      rigSent('s1', at(19, 3), 'Maquette validée'),
      rigNotice('n1', at(19, 45), 'Stuck', { kind: 'openrig', alert: 'stalled', qitem: 'qitem-abcd-ffc1', minutes: 7 }),
      rigReceived('pa', at(19, 49), 'a', { packet: { id: 'p', index: 0, count: 2 } }),
      rigReceived('pb', at(19, 49), 'b', { packet: { id: 'p', index: 1, count: 2 } })
    ]);
    expect(items.filter(i => i.kind !== 'time')).toMatchObject([
      { kind: 'rig-message', dir: 'in', count: 2, who: { name: 'Bix', seat: 'pilot-lead' }, reply: { sessionId: 'bix' }, raw: { text: expect.stringContaining('↩ Reply') } },
      { kind: 'rig-task', title: 'Retouche maquette', who: { name: 'Bix' } },
      { kind: 'rig-message', dir: 'out', delivery: 'delivered', raw: { label: 'Commande' } },
      { kind: 'rig-notice', tone: 'warn', title: 'Ligne …ffc1 sans suite depuis 7 min' },
      { kind: 'rig-message' },
      { kind: 'rig-message' },
      { kind: 'rig-raw', raw: { label: '2 messages collés ensemble · brut' } }
    ]);
    expect(items[0]).toMatchObject({ kind: 'time', label: '19:00' });
  });

  it('shortens a long raw as the other texts, and the phone says so', () => {
    const items = of([rigReceived('r1', at(19, 1), 'x', { raw: 'y'.repeat(THREAD_TEXT_MAX + 50) }, 'bix')]);
    const msg = items.find(i => i.kind === 'rig-message');
    expect(msg).toMatchObject({ cut: true });
    expect(msg && 'raw' in msg && msg.raw?.text.length).toBe(THREAD_TEXT_MAX);
  });

  it('carries a refused handoff\'s status', () => {
    const refused: ThreadItem = { ...rigHandoff('h2', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2', raw: 'rig queue handoff qitem-x --to pilot-lead@ledge-dev-2\nError: destination unknown' }, { outgoing: true }), status: 'refused' } as ThreadItem;
    expect(of([refused])[1]).toMatchObject({ kind: 'rig-task', refused: { log: 'passée 19:04 · OpenRig : Error: destination unknown' } });
  });
});
