import { describe, expect, it } from 'vitest';
import type { PhoneSession, ThreadItem } from '@ledge/protocol';
import { threadItems } from '../../src/model/thread';
import { replyDraft, rigWho, rowView } from '../../src/model/rigThread';
import { session } from './fixtures';
import { at, prompt, rigHandoff, rigNotice, rigReceived, rigSent } from './rig-fixtures';

const lu = session('lu', { name: 'Lu' });
const bix = session('bix', { name: 'Bix' });
const sessions = new Map<string, PhoneSession>([['lu', lu], ['bix', bix]]);
const of = (items: ThreadItem[], cut: string[] = []) => threadItems(items, lu, {}, Date.now(), cut, sessions);
const kinds = (items: ThreadItem[]) => of(items).map(i => i.kind);

describe('OpenRig in the phone thread', () => {
  it('turns a received rig send into the sender\'s bubble, named after its Ledge session, with « Répondre »', () => {
    const [time, msg] = of([rigReceived('r1', at(19, 1), 'Validation maquette encoche.', {}, 'bix')]);
    expect(time).toEqual({ key: 'time-r1', kind: 'time', label: '19:01' });
    expect(msg).toMatchObject({
      kind: 'rig-message', dir: 'in', text: 'Validation maquette encoche.', who: { name: 'Bix', seat: 'pilot-lead', session: { id: 'bix' } },
      reply: { sessionId: 'bix', draft: 'À propos de : « Validation maquette encoche. » ' }, raw: { label: 'Brut' }
    });
    expect(msg).not.toHaveProperty('count');
  });

  it('names an unknown sender after its seat, with its rig, and offers no « Répondre »', () => {
    const [, msg] = of([rigReceived('r1', at(19, 1), 'Salut', { from: 'operator-agent@kernel' })]);
    expect(msg).toMatchObject({ kind: 'rig-message', who: { name: 'operator-agent', seat: 'kernel' } });
    expect(msg).not.toHaveProperty('reply');
    // a peer id the phone does not list is not a session it can open
    const [, other] = of([rigReceived('r2', at(19, 1), 'Salut', {}, 'gone')]);
    expect(other).not.toHaveProperty('reply');
    expect(rigWho('<unknown sender>', undefined, sessions)).toEqual({ name: '<unknown sender>' });
  });

  it('prefixes the reply with the first non-empty line, cut at 80 characters', () => {
    expect(replyDraft('\n  \nPremière ligne\nseconde')).toBe('À propos de : « Première ligne » ');
    const long = 'x'.repeat(100);
    expect(replyDraft(long)).toBe(`À propos de : « ${'x'.repeat(79)}… » `);
  });

  it('says how many times a block came, and dates it by its envelope', () => {
    const [time, msg] = of([rigReceived('r1', at(19, 50), 'Option A', { count: 2, sentAt: at(19, 47) }, 'bix')]);
    expect(time).toMatchObject({ label: '19:47' });
    expect(msg).toMatchObject({ count: 2 });
  });

  it('turns a handoff into a task card, handed or passed', () => {
    const [, card] = of([rigHandoff('h1', at(19, 2), 'Retouche maquette encoche', {}, { peer: 'bix' })]);
    expect(card).toMatchObject({ kind: 'rig-task', outgoing: false, who: { name: 'Bix' }, title: 'Retouche maquette encoche', raw: { label: 'Brut' } });
    const [, out] = of([rigHandoff('h2', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2', command: 'rig queue handoff …' }, { outgoing: true })]);
    expect(out).toMatchObject({ kind: 'rig-task', outgoing: true, who: { name: 'pilot-lead', seat: 'ledge-dev-2' }, raw: { label: 'Commande' } });
  });

  it('says a handoff OpenRig refused, with what it printed or without', () => {
    const passed = (raw: string, status?: 'refused' | 'delivered') => ({ ...rigHandoff('h', at(19, 4), 'Maquette rendue', { to: 'pilot-lead@ledge-dev-2', raw }, { outgoing: true }), ...(status ? { status } : {}) }) as ThreadItem;
    const cmd = 'rig queue handoff qitem-x --to pilot-lead@ledge-dev-2';
    expect(of([passed(`${cmd}\n\n  Error: qitem-x is not yours\nmore`, 'refused')])[1]).toMatchObject({ refused: { log: 'passée 19:04 · OpenRig : Error: qitem-x is not yours' } });
    expect(of([passed(cmd, 'refused')])[1]).toMatchObject({ refused: { log: 'passée 19:04 · non transmise par OpenRig' } });
    const long = (of([passed(`${cmd}\n${'e'.repeat(120)}`, 'refused')])[1] as { refused: { log: string } }).refused.log;
    expect(long).toBe(`passée 19:04 · OpenRig : ${'e'.repeat(79)}…`);
    expect(of([passed(`${cmd}\nqitem-new`, 'delivered')])[1]).not.toHaveProperty('refused');
    // a row handed to this seat is never « refused »
    expect(of([{ ...rigHandoff('h', at(19, 2), 'x'), status: 'refused' } as ThreadItem])[1]).not.toHaveProperty('refused');
  });

  it('asks the row of a handoff, never of one OpenRig refused', () => {
    expect(of([rigHandoff('h', at(19, 2), 'x')])[1]).toMatchObject({ qitem: 'qitem-20261102190205-c0704682203041b9' });
    const refused = { ...rigHandoff('h', at(19, 4), 'x', { to: 'a@b' }, { outgoing: true }), status: 'refused' } as ThreadItem;
    expect(of([refused])[1]).not.toHaveProperty('qitem');
  });

  it('says a row\'s state and short log as the desktop does', () => {
    const r = { id: 'qitem-x', from: 'a@r', to: 'b@r', createdAt: at(19, 2), updatedAt: at(19, 3), at: at(19, 5) };
    expect(rowView(undefined, false)).toEqual({ key: 'unknown', text: 'état non suivi' });
    expect(rowView({ ...r, state: 'pending' }, false)).toEqual({ key: 'pending', text: 'en attente', log: 'confiée 19:02 · pas encore prise' });
    expect(rowView({ ...r, state: 'pending' }, true).log).toBe('passée 19:02 · pas encore prise');
    expect(rowView({ ...r, state: 'in-progress', claimedAt: at(19, 2) }, false)).toMatchObject({ key: 'taken', text: 'prise', log: 'confiée 19:02 · prise 19:02' });
    expect(rowView({ ...r, state: 'handed-off', handedOffTo: 'dev-front@ledge-dev-2' }, false)).toMatchObject({ key: 'passed', text: 'passée à dev-front' });
    expect(rowView({ ...r, state: 'blocked' }, false)).toMatchObject({ key: 'blocked', text: 'bloquée' });
    expect(rowView({ ...r, state: 'done', claimedAt: at(19, 2) }, false)).toMatchObject({ key: 'done', text: 'terminée', log: 'confiée 19:02 · prise 19:02 · terminée 19:03' });
    expect(rowView({ ...r, state: 'parked' }, false)).toMatchObject({ key: 'unknown', text: 'parked' });
  });

  it('turns the seat\'s own rig send into a sent bubble with its delivery', () => {
    const [, msg] = of([rigSent('s1', at(19, 3), 'Maquette validée', 'delivered')]);
    expect(msg).toMatchObject({ kind: 'rig-message', dir: 'out', who: { name: 'dev-front' }, delivery: 'delivered', raw: { label: 'Commande', text: expect.stringContaining('Sent to') } });
  });

  it('says a stalled row in amber, an unblocked one in violet', () => {
    const items = of([
      rigNotice('n1', at(19, 20), 'Blocker … resolved', { kind: 'unblocked', qitem: 'qitem-20261102184941-4389f392504db9e3', blocker: 'qitem-20261102184222-c844fa05df894750' }),
      rigNotice('n2', at(19, 45), 'Stuck sweep: …', { kind: 'openrig', from: 'daemon@kernel', alert: 'stalled', qitem: 'qitem-20261102193758-ffc1de6e4e82e13b', minutes: 7 })
    ]);
    expect(items.filter(i => i.kind === 'rig-notice')).toMatchObject([
      { tone: 'task', title: 'Blocage levé : la ligne …b9e3 est de nouveau à faire' },
      { tone: 'warn', title: 'Ligne …e13b sans suite depuis 7 min' }
    ]);
  });

  it('folds consecutive OpenRig notices, but never a stalled one', () => {
    const quiet = (id: string, m: number) => rigNotice(id, at(19, m), `Custody not checked ${id}`, { kind: 'openrig', from: 'daemon@kernel', alert: 'custody' });
    const stalled = rigNotice('st', at(19, 48), 'Stuck', { kind: 'openrig', alert: 'stalled', qitem: 'qitem-a1b2', minutes: 3 });
    const items = of([quiet('q1', 46), quiet('q2', 46), stalled, quiet('q3', 49)]);
    const fold = items.find(i => i.kind === 'rig-fold');
    expect(fold).toMatchObject({ kind: 'rig-fold', notices: [{ key: 'q1', title: 'Custody not checked q1' }, { key: 'q2' }] });
    expect(items.map(i => i.kind)).toEqual(['time', 'rig-fold', 'time', 'rig-notice', 'time', 'rig-notice']);
  });

  it('shows an unreadable block as is, never as the user\'s words', () => {
    const raw = 'From: pilot-lead@ledge-dev-2\nTo: design-ux@ledge-dev-2\n---\nRelance';
    const items = of([rigNotice('u1', at(19, 50), raw, { kind: 'unreadable' })]);
    expect(items[1]).toEqual({ key: 'u1', kind: 'rig-unreadable', at: at(19, 50), text: raw });
    expect(items.some(i => i.kind === 'me')).toBe(false);
  });

  it('gives pasted blocks one raw, its own row after the packet, the raws in packet order, and one time', () => {
    const packet = (index: number) => ({ packet: { id: 'p1', index, count: 3 } });
    const items = of([
      rigReceived('a', at(19, 49), 'Oui, now', { ...packet(0), from: 'operator-agent@kernel' }),
      rigHandoff('c', at(19, 49), 'Ligne', packet(2)),
      rigReceived('b', at(19, 49), 'Ligne créée', packet(1), 'bix'),
      prompt('p', at(19, 50), 'après')
    ]);
    expect(items.map(i => i.kind)).toEqual(['time', 'rig-message', 'rig-task', 'rig-message', 'rig-raw', 'me']);
    for (const e of items.slice(1, 4)) expect(e).not.toHaveProperty('raw');
    expect(items[4]).toMatchObject({ key: 'packet-p1', raw: { label: '3 messages collés ensemble · brut', text: expect.stringMatching(/Oui, now[\s\S]*Ligne créée[\s\S]*Queue handoff/) } });
  });

  it('keeps its own raw on a block whose packet mates fell off the window', () => {
    const items = of([rigReceived('b', at(19, 49), 'seul', { packet: { id: 'p1', index: 1, count: 2 } }, 'bix')]);
    expect(items.map(i => i.kind)).toEqual(['time', 'rig-message']);
    expect(items[1]).toMatchObject({ raw: { label: 'Brut' } });
  });

  it('keeps the user\'s own prompts « moi », and a time again after them', () => {
    expect(kinds([rigReceived('r1', at(19, 1), 'a', {}, 'bix'), prompt('p1', at(19, 1), 'Regarde aussi le mobile.'), rigReceived('r2', at(19, 1), 'b', {}, 'bix')]))
      .toEqual(['time', 'rig-message', 'me', 'time', 'rig-message']);
    // the same minute twice in a row: one time
    expect(kinds([rigReceived('r1', at(19, 1), 'a'), rigReceived('r2', at(19, 1), 'b')])).toEqual(['time', 'rig-message', 'rig-message']);
  });

  it('leaves messages between agents without rig to the terminal, as before', () => {
    const plain: ThreadItem = { kind: 'received', id: 'x', at: at(19, 0), turn: 1, from: 'Bix', text: 'hors OpenRig' };
    expect(of([plain])).toEqual([]);
  });

  it('marks an OpenRig element the PC shortened', () => {
    expect(of([rigReceived('r1', at(19, 1), 'a')], ['r1'])[1]).toMatchObject({ cut: true });
  });
});
