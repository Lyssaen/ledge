import { describe, expect, it } from 'vitest';
import type { PhoneSession, ThreadItem } from '@ledge/protocol';
import { composerState, threadItems } from '../../src/model/thread';
import type { Op } from '../../src/state/operations';
import { pending, session } from './fixtures';

const T = (m: number) => new Date(Date.UTC(2026, 9, 14, 10, m)).toISOString();
const s = (extra: Partial<PhoneSession> = {}) => session('a', { name: 'Bix', ...extra });
const base = (id: string, m: number) => ({ id, at: T(m), turn: 1 });
const prompt = (id: string, m: number, text: string): ThreadItem => ({ kind: 'prompt', ...base(id, m), text });
const reply = (id: string, m: number, text: string): ThreadItem => ({ kind: 'reply', ...base(id, m), text });
const permission = (id: string, m: number, text: string, decision?: 'accept' | 'deny' | 'always' | 'unknown'): ThreadItem =>
  ({ kind: 'permission', ...base(id, m), tool: 'Bash', text, ...(decision ? { decision } : {}) });
const OP = '11111111-1111-4111-8111-111111111111';
const instruction = (extra: Partial<Op> = {}): Op => ({ op: OP, message: { type: 'session.reply', op: OP, id: 'a', text: 'Lance les tests', expect: null }, phase: 'sending', at: T(5), ...extra });
const ops = (...list: Op[]) => Object.fromEntries(list.map(o => [o.op, o]));

describe('threadItems', () => {
  it('keeps the PC order, turns decided permissions into events and a pending request into an awaiting card', () => {
    const items = threadItems([
      prompt('t1', 0, 'Ajoute une recherche'),
      permission('t2', 1, 'pnpm build', 'accept'),
      reply('t3', 3, '**Prête.**'),
      permission('t4', 2, 'rm -rf dist', 'deny'),
      permission('t5', 4, 'ls', 'unknown'),
      { kind: 'tool', ...base('t6', 4), tool: 'Bash', label: 'ls', status: 'success', files: [] },
      permission('t7', 5, 'pnpm test')
    ], s({ state: 'waiting_permission', pending: pending({ key: 'p1' }) }), {});
    expect(items.map(i => i.kind)).toEqual(['me', 'event', 'agent', 'event', 'event', 'awaiting']);
    expect(items.filter(i => i.kind === 'event').map(i => i.kind === 'event' && i.label)).toEqual([
      'Accord pris en compte · depuis le PC', 'Refus pris en compte · depuis le PC', 'Traitée dans le terminal'
    ]);
    expect(items[2]).toMatchObject({ kind: 'agent', text: '**Prête.**' });
    expect(items[5]).toMatchObject({ kind: 'awaiting', key: 'awaiting-p1', item: { sessionId: 'a', key: 'p1' } });
  });

  it('says a decision came from this phone when one of its applied decisions answered that request', () => {
    const D = '22222222-2222-4222-8222-222222222222';
    const decided: Op = { op: D, message: { type: 'session.decide', op: D, id: 'a', decision: 'accept', expect: { key: 'k', kind: 'permission', text: 'pnpm build' } }, phase: 'applied', at: T(1) };
    const [item] = threadItems([permission('t2', 1, 'pnpm build', 'accept')], s(), ops(decided));
    expect(item).toMatchObject({ kind: 'event', label: 'Accord pris en compte · depuis le téléphone' });
  });

  it('marks the items the PC shortened', () => {
    const items = threadItems([prompt('t1', 0, 'x'), reply('t2', 1, 'y')], s(), {}, Date.now(), ['t2']);
    expect(items[0]).not.toHaveProperty('cut');
    expect(items[1]).toMatchObject({ cut: true });
  });

  it('shows an instruction on its way, then taken, and never twice once the PC lists it', () => {
    expect(threadItems([], s(), ops(instruction()))).toMatchObject([{ kind: 'me', key: OP, text: 'Lance les tests', delivery: 'sending' }]);
    expect(threadItems([], s(), ops(instruction({ phase: 'uncertain' })))).toMatchObject([{ delivery: 'uncertain' }]);
    const at = Date.parse(T(5));
    expect(threadItems([], s(), ops(instruction({ phase: 'applied' })), at + 5_000)).toMatchObject([{ delivery: 'taken', fresh: true }]);
    expect(threadItems([], s(), ops(instruction({ phase: 'applied' })), at + 60_000)[0]).not.toHaveProperty('fresh');
    expect(threadItems([], s(), ops(instruction({ phase: 'rejected', reason: 'busy' })))).toEqual([]);
    expect(threadItems([prompt('p', 6, 'Lance les tests')], s(), ops(instruction({ phase: 'applied' })))).toMatchObject([{ key: 'p', delivery: 'taken' }]);
  });

  it('an answer to a request is not an instruction of the thread', () => {
    const answer = instruction({ message: { type: 'session.reply', op: OP, id: 'a', text: '1', expect: { key: 'k', kind: 'question', text: '?' } } });
    expect(threadItems([], s(), ops(answer))).toEqual([]);
  });
});

describe('composerState', () => {
  const c = (session: PhoneSession, link: Parameters<typeof composerState>[1] = 'ready', sending = false) => composerState(session, link, sending);
  it('is open only for an idle agent on a ready link', () => {
    expect(c(s())).toEqual({ enabled: true, placeholder: 'Écrire à Bix…', status: { tone: 'ok', label: 'Disponible pour votre consigne' } });
  });
  it('is disabled while working, awaiting a decision, connecting or offline', () => {
    expect(c(s({ state: 'working' }))).toMatchObject({ enabled: false, placeholder: 'L’agent travaille…', status: { label: 'Au travail · consultez le terminal' } });
    expect(c(s({ state: 'waiting_input' }))).toMatchObject({ enabled: false, placeholder: 'Traitez la demande ci-dessus', status: { tone: 'attention', label: 'En attente d’une décision' } });
    expect(c(s(), 'pc_offline')).toMatchObject({ enabled: false, placeholder: 'Reconnectez-vous pour écrire', status: { tone: 'muted', label: 'Connexion perdue · dernier état connu' } });
    expect(c(s(), 'key_changed').enabled).toBe(false);
    expect(c(s(), 'handshaking')).toMatchObject({ enabled: false, placeholder: 'Connexion en cours…' });
    expect(c(s(), 'ready', true)).toMatchObject({ enabled: false, status: { label: 'Envoi au PC…' } });
    expect(c(s({ state: 'exited' })).enabled).toBe(false);
  });
  it('says a decision waits in the colour of what waits, as on the desktop: an accord red, a question amber', () => {
    expect(c(s({ state: 'waiting_permission' })).status.tone).toBe('approval');
    expect(c(s({ state: 'waiting_input' })).status.tone).toBe('attention');
    expect(c(s({ state: 'waiting_permission', pending: { key: 'q', kind: 'question', text: 'Lequel ?', source: 'hook', risk: 'low', riskReason: 'question' } })).status.tone).toBe('attention');
  });
});

describe('threadItems with images', () => {
  const IMG = { id: 'f'.repeat(64), mime: 'image/webp' as const, width: 800, height: 600, bytes: 1000, preview: true };
  const withImages = (attachments?: string[]): Op => instruction({ message: { type: 'session.reply', op: OP, id: 'a', text: '', expect: null, ...(attachments ? { attachments } : {}) }, phase: 'applied' });

  it('an applied op with an image claims the prompt carrying that image, not a prompt without one', () => {
    const plain: ThreadItem = { kind: 'prompt', ...base('t1', 6), text: '' };
    const pic: ThreadItem = { kind: 'prompt', ...base('t2', 7), text: '', images: [IMG] };
    const items = threadItems([plain, pic], s(), ops(withImages([IMG.id])), Date.parse(T(30)));
    expect(items.map(i => [i.key, i.kind === 'me' ? i.delivery : null])).toEqual([['t1', undefined], ['t2', 'taken']]);
    expect(items[1]).toMatchObject({ images: [IMG] });
  });

  it('an op without an image does not claim a prompt that has one', () => {
    const pic: ThreadItem = { kind: 'prompt', ...base('t2', 7), text: '', images: [IMG] };
    const items = threadItems([pic], s(), ops(withImages()), Date.parse(T(30)));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: 't2' });
    expect(items[0]).not.toHaveProperty('delivery');
  });

  it('an unmatched own op carries its attachment ids', () => {
    const items = threadItems([], s(), ops({ ...withImages([IMG.id]), phase: 'sending' }));
    expect(items[0]).toMatchObject({ kind: 'me', delivery: 'sending', attachments: [IMG.id] });
  });
});
