import { describe, it, expect } from 'vitest';
import type { Pending, Session } from '@ledge/protocol';
import { pushFor } from '../src/daemon/push/triggers.js';

const T0 = '2026-10-14T18:00:00.000Z';
const pid = '0b7e4c1a-9d2f-4f6e-8a31-5c2d7e9b1a44';
const sess = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/p', project: 'proj', title: 'Otto', tmuxSession: 't', state: 'working', helpers: [],
  startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
const pend = (extra: Partial<Pending> = {}): Pending => ({ id: pid, version: 1, kind: 'permission', text: 'git push --force origin main', source: 'hook', ...extra });
const waiting = (id: string, p: Pending, extra: Partial<Session> = {}) => sess(id, { state: 'waiting_permission', pending: p, ...extra });

describe('pushFor', () => {
  it('a new permission request notifies with the task and the bot, opening its detail', () => {
    const before = sess('a', { topic: 'Badge d’attente' });
    const after = waiting('a', pend(), { topic: 'Badge d’attente' });
    expect(pushFor(before, after, [after])).toEqual({ v: 1, kind: 'request', title: 'Votre accord est demandé', body: 'Badge d’attente · Otto', url: `/m/#/request/a/${pid}`, badge: 1, tag: `req-${pid}`.slice(0, 32) });
  });
  it('falls back to the project when there is no topic', () => {
    const after = waiting('a', pend());
    expect(pushFor(sess('a'), after, [after])?.body).toBe('proj · Otto');
  });
  it('a version bump of the same request does not notify again', () => {
    const before = waiting('a', pend());
    const after = waiting('a', pend({ version: 2 }));
    expect(pushFor(before, after, [after])).toBeNull();
  });
  it('a new question names the bot in the title', () => {
    const after = waiting('a', pend({ kind: 'question', text: 'Quelle base ?', options: ['Oui, en prod'] }), { topic: 'Migration' });
    expect(pushFor(sess('a'), after, [after])).toMatchObject({ kind: 'question', title: 'Otto a une question', body: 'Migration', url: `/m/#/request/a/${pid}` });
  });
  it('the payload never carries the command, the question or the reply', () => {
    const b = sess('a', { lastReply: { text: 'secret reply' } as Session['lastReply'] });
    const perm = waiting('a', pend({ options: ['Oui, en prod'] }));
    const q = waiting('a', pend({ kind: 'question', text: 'drop table users?' }));
    expect(JSON.stringify(pushFor(b, perm, [perm]))).not.toMatch(/push --force|en prod/);
    expect(JSON.stringify(pushFor(b, q, [q]))).not.toMatch(/drop table/);
  });
  it('a request reason goes in the body, trimmed and cut to the 120 characters', () => {
    const after = waiting('a', pend({ reason: `  ${'x'.repeat(300)}  ` }));
    const p = pushFor(sess('a'), after, [after])!;
    expect(p.body.startsWith('proj · Otto · xxx')).toBe(true);
    expect(p.body.length).toBeLessThanOrEqual(120);
  });
  it('Codex boilerplate and blank reasons are left out', () => {
    for (const reason of ['Allow the requested shell command?', '   ']) {
      const after = waiting('a', pend({ reason }));
      expect(pushFor(sess('a'), after, [after])?.body).toBe('proj · Otto');
    }
  });
  it('a long task is cut so the body fits 120', () => {
    const after = waiting('a', pend({ reason: 'because' }), { topic: 'y'.repeat(400) });
    expect(pushFor(sess('a'), after, [after])!.body.length).toBeLessThanOrEqual(120);
  });
  it('a finished turn notifies and opens the thread', () => {
    const after = sess('a', { state: 'idle', topic: 'Refonte' });
    expect(pushFor(sess('a'), after, [after])).toEqual({ v: 1, kind: 'finished', title: 'Otto a terminé', body: 'Refonte', url: '/m/#/thread/a', badge: 0, tag: 'fin-a' });
  });
  it('every tag fits the 32 characters, even for an agent UUID session id', () => {
    const uuid = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const fin = pushFor(sess(uuid), sess(uuid, { state: 'idle' }), [])!;
    expect(fin.tag.length).toBeLessThanOrEqual(32);
    const longPid = `${pid}-${pid}`;
    const after = waiting(uuid, pend({ id: longPid }));
    expect(pushFor(sess(uuid), after, [after])!.tag.length).toBeLessThanOrEqual(32);
  });
  it('a turn that ends on a request is announced as a request, not as finished', () => {
    const after = waiting('a', pend(), { state: 'idle' });
    expect(pushFor(sess('a'), after, [after])?.kind).toBe('request');
  });
  it('any other change is silent', () => {
    expect(pushFor(sess('a'), sess('a', { state: 'waiting_input' }), [])).toBeNull();
    expect(pushFor(sess('a', { state: 'idle' }), sess('a', { state: 'working' }), [])).toBeNull();
    expect(pushFor(undefined, sess('a'), [])).toBeNull();
  });
  it('the badge counts every session waiting for a decision', () => {
    const b = waiting('b', pend({ id: 'pb' }));
    const noId = sess('c', { pending: pend({ id: undefined }) });
    const after = waiting('a', pend());
    expect(pushFor(sess('a'), after, [after, b, noId, sess('d')])?.badge).toBe(2);
  });
});
