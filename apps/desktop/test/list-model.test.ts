import { describe, expect, it } from 'vitest';
import { fakeSession, T0 } from '@ledge/fleet/test/mockDaemon';
import type { Pending, Session } from '@ledge/protocol';
import { MESSAGES } from '../src/i18n/messages';
import { bucketOf, repoOf } from '../src/list/model';
import { spanOf, trackWaits, whenOf } from '../src/list/time';

const at = (min: number) => new Date(Date.parse(T0) - min * 60_000).toISOString();
const ask = (kind: Pending['kind'], text = 'npm test'): Pending => ({ kind, text, source: 'hook' });
const s = (id: string, extra: Partial<Session> = {}) => fakeSession(`local:${id}`, { name: id[0]!.toUpperCase() + id.slice(1), machineId: 'local', machineName: 'Local', cwd: '/w/ledge', ...extra });
const otto = s('otto', { branch: 'desktop' });
const nova = s('nova', { state: 'waiting_input', pending: ask('question'), lastActivityAt: at(2), branch: 'main' });
const pim = s('pim', { state: 'waiting_permission', pending: ask('permission'), lastActivityAt: at(10), branch: 'desktop', topic: 'Écrire la doc' });
const bix = s('bix', { state: 'idle' });
const rio = fakeSession('dev:rio', { name: 'Rio', machineId: 'dev', machineName: 'Dev SSH', cwd: '/w/pay', offline: true });
const kit = s('kit', { cwd: '/tmp/scratch', repo: 'scratch' });

describe('kept list helpers', () => {
  it('buckets a session; repo is s.repo or the cwd folder', () => {
    expect([bix, s('e', { state: 'error' }), s('x', { state: 'exited' }), s('i', { state: 'idle', helpers: [{ id: 'h', kind: 'K', task: 't', state: 'working' }] }), nova, rio].map(bucketOf))
      .toEqual(['done', 'running', 'done', 'running', 'decide', 'offline']);
    expect([repoOf(kit), repoOf(otto)]).toEqual(['scratch', 'ledge']);
  });
  it('spans round down: minutes, hours, days', () => {
    const min = 60_000, h = 60 * min, d = 24 * h;
    expect([0, min - 1, min, 60 * min - 1, h, 24 * h - 1, d, 3 * d, -5000].map(spanOf)).toEqual([
      'now', 'now', { n: 1, unit: 'min' }, { n: 59, unit: 'min' }, { n: 1, unit: 'h' }, { n: 23, unit: 'h' }, { n: 1, unit: 'd' }, { n: 3, unit: 'd' }, 'now'
    ]);
  });
  it('a wait says « depuis », the rest « il y a », offline « vu pour la dernière fois »; French and English', () => {
    const now = Date.parse(T0), fr = MESSAGES.fr.list.when, en = MESSAGES.en.list.when;
    expect(whenOf(pim, undefined, now, fr)).toEqual({ text: 'depuis 10 min', title: 'En attente depuis 10 min', waiting: true });
    expect(whenOf(pim, at(25), now, en)).toEqual({ text: 'for 25 min', title: 'Waiting for 25 min', waiting: true });
    expect(whenOf(s('b', { lastActivityAt: at(120) }), undefined, now, fr)).toEqual({ text: 'il y a 2 h', title: 'Dernière activité il y a 2 h', waiting: false });
    expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, fr)).toEqual({ text: 'il y a 3 j', title: 'Vu pour la dernière fois il y a 3 j', waiting: false });
    expect(whenOf({ ...rio, lastActivityAt: at(3 * 1440) }, undefined, now, en)).toEqual({ text: '3 d ago', title: 'Last seen 3 d ago', waiting: false });
    expect(whenOf(s('k', { state: 'waiting_input', pending: ask('question') }), undefined, now, fr)).toEqual({ text: 'à l’instant', title: 'Demande reçue à l’instant', waiting: true });
    expect(whenOf(s('w'), undefined, now, en)).toEqual({ text: 'just now', title: 'Last activity just now', waiting: false });
  });
  it('a wait starts at its request: pane activity during it does not restart it, a new request does', () => {
    const w0 = trackWaits(new Map(), [pim, nova, bix]);
    expect([...w0.keys()]).toEqual(['local:pim', 'local:nova']);
    expect(w0.get('local:pim')!.since).toBe(at(10));
    expect(trackWaits(w0, [{ ...pim, lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(10));
    expect(trackWaits(w0, [{ ...pim, pending: ask('permission', 'rm -rf dist'), lastActivityAt: at(1) }]).get('local:pim')!.since).toBe(at(1));
    expect(trackWaits(w0, [{ ...pim, state: 'working', pending: undefined }]).has('local:pim')).toBe(false);
  });
});
