import { describe, it, expect } from 'vitest';
import { PushPayloadSchema, pendingKey, type Session } from '@ledge/protocol';
import { pushFor, safeTag } from '../src/mobile/push/triggers.js';

const T0 = '2026-10-09T18:00:00.000Z';
const mk = (over: Partial<Session> = {}): Session => ({
  id: 's1', name: 'Otto', tool: 'claude', cwd: '/w', project: 'w', title: 'Otto · w', tmuxSession: 'ledge-s1',
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...over
});
const req = (text: string, kind: 'permission' | 'question' = 'permission'): NonNullable<Session['pending']> => ({ kind, text, source: 'hook' });

describe('pushFor', () => {
  it('announces a new request once, with the key the phone routes on', () => {
    const a = mk({ state: 'idle', pending: req('Run ls') });
    const first = pushFor(mk(), a, [a])!;
    expect(first).toMatchObject({ v: 1, kind: 'request', title: 'Otto attend votre accord', body: 'Run ls', badge: 1, tag: 's1' });
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
    expect(pushFor(mk(), a, [a])).toMatchObject({ kind: 'question', title: 'Otto a une question', body: 'Which db?' });
  });
  it('uses the command for the generic Codex request', () => {
    const a = mk({ pending: { ...req('Allow the requested shell command?'), body: 'rm -rf build' } });
    expect(pushFor(mk(), a, [a])!.body).toBe('rm -rf build');
  });
  it('announces the end of a turn, with the reply', () => {
    const b = mk({ state: 'idle', lastReply: { text: 'Done.', at: T0 } });
    const p = pushFor(mk(), b, [b])!;
    expect(p).toMatchObject({ kind: 'finished', title: 'Otto a terminé', body: 'Done.', url: '/#/thread/s1', badge: 0 });
    PushPayloadSchema.parse(p);
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
    expect(long.title.length).toBe(80);
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
