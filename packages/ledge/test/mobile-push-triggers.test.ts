import { describe, it, expect } from 'vitest';
import { PushPayloadSchema, pendingKey, type Session } from '@ledge/protocol';
import { chatEndPayload, decisionPayload, pushFor, resolvedFor, safeTag } from '../src/mobile/push/triggers.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (over: Partial<Session> = {}): Session => ({
  id: 's1', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: 'ledge-s1',
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...over
});
const req = (text: string, kind: 'permission' | 'question' = 'permission'): NonNullable<Session['pending']> => ({ kind, text, source: 'hook' });

describe('the name the phone writes its title with (Q29)', () => {
  it('each payload about someone carries that name; the chat end none; an older phone still reads it', () => {
    const asking = mk({ state: 'idle', pending: req('Run ls') });
    expect(pushFor(mk(), asking, [asking])).toMatchObject({ kind: 'request', name: 'Otto' });
    const q = mk({ state: 'idle', pending: req('Which db?', 'question') });
    expect(pushFor(mk(), q, [q])).toMatchObject({ kind: 'question', name: 'Otto' });
    expect(resolvedFor(asking, mk({ state: 'idle' }), [])).toMatchObject({ kind: 'resolved', name: 'Otto' });
    const decision = decisionPayload({ id: 't1', giverName: 'Pim', title: 'Ship it?' } as never, 1);
    expect(decision).toMatchObject({ kind: 'decision', name: 'Pim' });
    expect(PushPayloadSchema.parse(decision)).toEqual(decision);
    expect(chatEndPayload(undefined, 0)).not.toHaveProperty('name');
    expect(pushFor(mk(), mk({ name: 'N'.repeat(150), pending: req('x') }), [])!.name).toHaveLength(100);
    // A payload from an older daemon, without the name, is still valid.
    const { name: _n, ...old } = pushFor(mk(), asking, [asking])!;
    expect(PushPayloadSchema.safeParse(old).success).toBe(true);
  });
});

describe('pushFor', () => {
  it('announces a new request once, with the key the phone routes on', () => {
    const a = mk({ state: 'idle', pending: req('Run ls') });
    const first = pushFor(mk(), a, [a])!;
    expect(first).toMatchObject({ v: 1, kind: 'request', title: 'Ledge', body: 'Otto · Run ls', badge: 1, tag: 's1' });
    expect(first.url).toBe(`/#/request/s1/${pendingKey(a.pending!)}`);
    expect(PushPayloadSchema.parse(first)).toEqual(first);
    expect(pushFor(a, { ...a, lastActivityAt: '2026-10-09T18:05:00.000Z' }, [a])).toBeNull();
  });
  it('announces a replaced request again', () => {
    const a = mk({ pending: req('one') }), b = mk({ pending: req('two') });
    expect(pushFor(mk(), a, [a])).not.toBeNull();
    expect(pushFor(a, b, [b])).not.toBeNull();
  });
  it('announces a question', () => {
    const a = mk({ pending: req('Which db?', 'question') });
    expect(pushFor(mk(), a, [a])).toMatchObject({ kind: 'question', title: 'Ledge', body: 'Otto · Which db?' });
  });
  it('request push title says Ledge and body names the session', () => {
    const a = mk({ pending: req('Run ls') });
    const p = pushFor(mk(), a, [a])!;
    expect(p.title).toBe('Ledge');
    expect(p.body.startsWith('Otto')).toBe(true);
  });
  it('uses the command for the generic Codex request', () => {
    const a = mk({ pending: { ...req('Allow the requested shell command?'), body: 'rm -rf build' } });
    expect(pushFor(mk(), a, [a])!.body).toBe('Otto · rm -rf build');
  });
  it('pushFor no longer returns finished', () => {
    const b = mk({ state: 'idle', lastReply: { text: 'Done.', at: T0 } });
    expect(pushFor(mk(), b, [b])).toBeNull();
  });
  it('does not announce an end of turn with a request waiting, nor idle to idle', () => {
    const a = mk({ state: 'idle', pending: req('x') });
    expect(pushFor(mk({ pending: req('x') }), a, [a])).toBeNull();
    expect(pushFor(mk({ state: 'idle' }), mk({ state: 'idle' }), [])).toBeNull();
  });
  it('cuts long text by characters, never inside a surrogate pair, within the schema maxima', () => {
    const a = mk({ name: '😀'.repeat(200), pending: req('😀'.repeat(300)) });
    const p = pushFor(mk(), a, [a])!;
    expect([...p.title].length).toBeLessThanOrEqual(80);
    expect([...p.body].length).toBeLessThanOrEqual(120);
    expect(p.title.length).toBeLessThanOrEqual(80);
    expect(p.body.length).toBeLessThanOrEqual(120);
    expect(p.body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(p.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    PushPayloadSchema.parse(p);
    const long = pushFor(mk(), mk({ name: 'n'.repeat(200), pending: req('x') }), [])!;
    expect(long.body.length).toBe(120);
    expect(long.name).toHaveLength(100);
    PushPayloadSchema.parse(long);
  });
  it('makes a safe tag and an encoded url from an odd session id', () => {
    const a = mk({ id: 'a/b:c', pending: req('x') });
    const p = pushFor(mk({ id: 'a/b:c' }), a, [a])!;
    expect(p.tag).toBe('a_b_c');
    expect(p.url.startsWith('/#/request/a%2Fb%3Ac/')).toBe(true);
    PushPayloadSchema.parse(p);
    expect(safeTag('x'.repeat(50))).toHaveLength(32);
  });
  it('counts the sessions with a request as the badge', () => {
    const a = mk({ pending: req('x') }), b = mk({ id: 's2', pending: req('y') });
    expect(pushFor(mk(), a, [a, b, mk({ id: 's3' })])!.badge).toBe(2);
  });
});
