import { describe, expect, it } from 'vitest';
import type { AttachmentRef, PhoneSession, ThreadItem } from '@ledge/protocol';
import { composerState, threadItems, toolNames } from '../../src/model/thread';
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
    expect(items.map(i => i.kind)).toEqual(['me', 'event', 'agent', 'event', 'event', 'tools', 'awaiting']);
    expect(items.filter(i => i.kind === 'event').map(i => i.kind === 'event' && i.label)).toEqual([
      'Accord pris en compte · depuis le PC', 'Refus pris en compte · depuis le PC', 'Traitée dans le terminal'
    ]);
    expect(items[2]).toMatchObject({ kind: 'agent', text: '**Prête.**' });
    expect(items[6]).toMatchObject({ kind: 'awaiting', key: 'awaiting-p1', item: { sessionId: 'a', key: 'p1' } });
  });

  it('says a decision came from this phone when one of its applied decisions answered that request', () => {
    const D = '22222222-2222-4222-8222-222222222222';
    const decided: Op = { op: D, message: { type: 'session.decide', op: D, id: 'a', decision: 'accept', expect: { key: 'k', kind: 'permission', text: 'pnpm build' } }, phase: 'applied', at: T(1) };
    const [item] = threadItems([permission('t2', 1, 'pnpm build', 'accept')], s(), ops(decided));
    expect(item).toMatchObject({ kind: 'event', label: 'Accord pris en compte · depuis cet appareil' });
  });

  it('names who decided when the PC says it: this device, another one by its name then, or the PC; never guesses over it', () => {
    const D = '22222222-2222-4222-8222-222222222222';
    // An applied decision of this device on the same text: the PC's `by` wins over it.
    const decided: Op = { op: D, message: { type: 'session.decide', op: D, id: 'a', decision: 'accept', expect: { key: 'k', kind: 'permission', text: 'pnpm build' } }, phase: 'applied', at: T(1) };
    const by = (b: Extract<ThreadItem, { kind: 'permission' }>['by']): ThreadItem => ({ ...permission('t2', 1, 'pnpm build', 'accept'), by: b } as ThreadItem);
    const label = (item: ThreadItem, self: string | null) => threadItems([item], s(), ops(decided), Date.now(), [], new Map(), self)[0];
    expect(label(by({ kind: 'device', id: 'fp-ipad', name: 'iPad · Safari' }), 'fp-self')).toMatchObject({ label: 'Accord pris en compte · depuis iPad · Safari' });
    expect(label(by({ kind: 'device', id: 'fp-self', name: 'Android · Chrome' }), 'fp-self')).toMatchObject({ label: 'Accord pris en compte · depuis cet appareil' });
    expect(label(by({ kind: 'pc' }), 'fp-self')).toMatchObject({ label: 'Accord pris en compte · depuis le PC' });
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

  it('drops what the terminal took once the PC has moved past it without listing it, never pinning it at the end', () => {
    // The capture's case: three taken instructions, one of them a command (`/new`) no transcript ever shows, and a later reply.
    const sent = (op: string, m: number, text: string): Op => ({ op, message: { type: 'session.reply', op, id: 'a', text, expect: null }, phase: 'applied', at: T(m) });
    const items = threadItems([reply('r1', 1, 'Le code n’est toujours pas commité.'), reply('r2', 9, 'ouais compacte aussi l’en-tête du fil en paysage')], s(),
      ops(sent('o1', 2, 'Oui go'), sent('o2', 3, 'Est-ce que tu sais me montrer les photos de tes changements ?'), sent('o3', 4, '/new')), Date.parse(T(10)));
    expect(items.map(i => i.key)).toEqual(['r1', 'r2']);
  });

  it('places a taken instruction the PC does not list yet in time order, not after what came later', () => {
    const at = Date.parse(T(5));
    const later: ThreadItem = { kind: 'reply', id: 'r', at: new Date(at + 5_000).toISOString(), turn: 1, text: 'Je regarde.' };
    const items = threadItems([reply('r0', 1, 'Prête.'), later], s(), ops(instruction({ phase: 'applied' })), at + 6_000);
    expect(items.map(i => i.key)).toEqual(['r0', OP, 'r']);
  });

  it('recognizes its instruction in the PC\'s prompt despite surrounding spaces, or shortened by the PC', () => {
    expect(threadItems([prompt('p', 6, '  Lance les tests\n')], s(), ops(instruction({ phase: 'applied' })))).toMatchObject([{ key: 'p', delivery: 'taken' }]);
    expect(threadItems([prompt('p', 6, 'Lance les')], s(), ops(instruction({ phase: 'applied' })), Date.now(), ['p'])).toMatchObject([{ key: 'p', delivery: 'taken' }]);
  });

  it('an answer to a request is not an instruction of the thread', () => {
    const answer = instruction({ message: { type: 'session.reply', op: OP, id: 'a', text: '1', expect: { key: 'k', kind: 'question', text: '?' } } });
    expect(threadItems([], s(), ops(answer))).toEqual([]);
  });
});

describe('composerState', () => {
  const c = (session: PhoneSession, link: Parameters<typeof composerState>[1] = 'ready', sending = false) => composerState(session, link, sending);
  it('is open only for an idle agent on a ready link', () => {
    expect(c(s())).toEqual({ enabled: true, placeholder: 'Écrire à Bix…', status: { tone: 'ok', label: 'Disponible pour ta consigne' } });
  });
  it('is disabled while working, awaiting a decision, connecting or offline', () => {
    expect(c(s({ state: 'working' }))).toMatchObject({ enabled: false, placeholder: 'L’agent travaille…', status: { label: 'Au travail · consulte le terminal' } });
    expect(c(s({ state: 'waiting_input' }))).toMatchObject({ enabled: false, placeholder: 'Traite la demande ci-dessus', status: { tone: 'attention', label: 'En attente d’une décision' } });
    expect(c(s(), 'pc_offline')).toMatchObject({ enabled: false, placeholder: 'Reconnecte-toi pour écrire', status: { tone: 'muted', label: 'Connexion perdue · dernier état connu' } });
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
    expect(items).toHaveLength(1); // the op, unclaimed, is past: the PC moved on without it
    expect(items[0]).toMatchObject({ key: 't2' });
    expect(items[0]).not.toHaveProperty('delivery');
  });

  it('an unmatched own op carries its attachment ids', () => {
    const items = threadItems([], s(), ops({ ...withImages([IMG.id]), phase: 'sending' }));
    expect(items[0]).toMatchObject({ kind: 'me', delivery: 'sending', attachments: [IMG.id] });
  });

  it('folds the tools run in a row into one block, a capture or anything shown in between starting a new one (§3)', () => {
    const tool = (id: string, m: number, name: string, label: string, status: 'running' | 'success' | 'failed' = 'success', extra: object = {}): ThreadItem =>
      ({ kind: 'tool', ...base(id, m), tool: name, label, status, files: [], ...extra });
    const REF: AttachmentRef = { id: 'c'.repeat(64), mime: 'image/png', width: 1280, height: 800, bytes: 30_000, preview: true };
    const helper: ThreadItem = { kind: 'helper', ...base('h', 2), task: 'explore', state: 'working' };
    const out = threadItems([
      prompt('t1', 0, 'Monte la coque'),
      tool('a', 1, 'Read', 'App.tsx'), tool('b', 1, 'Edit', 'App.tsx'), helper, tool('c', 2, 'Read', 'Shell.tsx'), tool('d', 2, 'Bash', 'pnpm typecheck', 'failed'),
      reply('t2', 3, 'Le typecheck passe.'),
      tool('e', 4, 'Bash', 'pnpm e2e', 'running'),
      tool('f', 4, 'mcp__plugin_playwright_playwright__browser_take_screenshot', 'shot', 'success', { images: [REF] }),
      tool('g', 5, 'Edit', 'Shell.tsx')
    ], s(), {});
    expect(out.map(i => i.kind)).toEqual(['me', 'tools', 'agent', 'tools', 'capture', 'tools']);
    expect(out[1]).toEqual({ key: 'tools-a', kind: 'tools', at: T(1), tools: [
      { id: 'a', name: 'Read', label: 'App.tsx', status: 'success' }, { id: 'b', name: 'Edit', label: 'App.tsx', status: 'success' },
      { id: 'c', name: 'Read', label: 'Shell.tsx', status: 'success' }, { id: 'd', name: 'Bash', label: 'pnpm typecheck', status: 'failed' }
    ] });
    expect(out[1]!.kind === 'tools' && toolNames(out[1].tools)).toEqual(['Read', 'Edit', 'Bash']);
    expect(out[3]).toMatchObject({ tools: [{ id: 'e', status: 'running' }] });
  });

  it('makes a capture entry only for tool rows with images', () => {
    const REF: AttachmentRef = { id: 'c'.repeat(64), mime: 'image/png', width: 1280, height: 800, bytes: 30_000, preview: true };
    const toolRow = (id: string, extra: Partial<Extract<ThreadItem, { kind: 'tool' }>> = {}): ThreadItem =>
      ({ kind: 'tool', ...base(id, 1), tool: 'mcp__plugin_playwright_playwright__browser_take_screenshot', label: 'shot', status: 'success', files: [], ...extra });
    const out = threadItems([toolRow('t1'), toolRow('t2', { images: [REF] }), toolRow('t3', { imagesDropped: true }), toolRow('t4', { tool: 'mcp__x__snap', images: [REF] })], s(), {});
    expect(out.filter(i => i.kind === 'capture')).toEqual([
      { key: 't2', kind: 'capture', label: 'Capture', at: T(1), images: [REF] },
      { key: 't4', kind: 'capture', label: 'snap', at: T(1), images: [REF] }
    ]);
  });
});

describe('threadItems with a <task-notification>', () => {
  const note = '<task-notification>\n<task-id>b7x</task-id>\n<status>failed</status>\n<summary>Background command "pnpm test" failed (exit code 1)</summary>\n<output-file>/tmp/b7x.out</output-file>\n</task-notification>';

  it('reads a prompt that is one as a task card, not as an instruction from the person', () => {
    const items = threadItems([prompt('t1', 0, 'Lance les tests'), prompt('t2', 1, note), reply('t3', 2, 'Je regarde.')], s(), {}, Date.now(), ['t2']);
    expect(items.map(i => i.kind)).toEqual(['me', 'task', 'agent']);
    expect(items[1]).toMatchObject({ key: 't2', kind: 'task', at: T(1), cut: true, task: { status: 'failed', output: '/tmp/b7x.out', about: { kind: 'command', command: 'pnpm test', code: '1' } } });
  });

  it('a prompt that only mentions one stays the person’s', () => {
    expect(threadItems([prompt('t1', 0, `Regarde ça : ${note}`)], s(), {})).toMatchObject([{ kind: 'me' }]);
  });
});
