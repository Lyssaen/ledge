import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crossSessionNotices } from '../src/daemon/crossSession.js';

const F = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'cross-session', 'notices.json'), 'utf8')) as Record<string, string>;

describe('cross-session notices', () => {
  it('reads an idle notice: the session, the time, its harness\'s summary', () => {
    expect(crossSessionNotices(F.idle!)).toEqual([{ kind: 'idle', peer: 'ledge-cd', time: '09:17', summary: 'J\'ai accepté le plan de `ledge-75` pour mettre les issues 18 et 19 ensemble sur main. Il dit que tu…', text: F.idle }]);
    expect(crossSessionNotices(F.idleBare!)).toEqual([{ kind: 'idle', peer: 'Pim', text: F.idleBare }]);
  });

  it('reads the other idle-subscription outcomes: exited, unavailable, expired', () => {
    expect(crossSessionNotices(F.exited!)).toEqual([{ kind: 'exited', peer: 'Nova', time: '10:02', text: F.exited }]);
    expect(crossSessionNotices(F.unavailable!)).toEqual([{ kind: 'unavailable', peer: 'Otto', reason: 'peer_unavailable', text: F.unavailable }]);
    expect(crossSessionNotices(F.expired!)).toEqual([{ kind: 'expired', peer: 'Iris', text: F.expired }]);
  });

  it('reads a delivery notice: its outcome, how many messages, to whom, why', () => {
    expect(crossSessionNotices(F.held!)).toEqual([{ kind: 'delivery', status: 'held', count: 1, recipients: ['Orion'], text: F.held }]);
    expect(crossSessionNotices(F.denied!)).toEqual([{ kind: 'delivery', status: 'denied', count: 2, recipients: ['Orion', 'Iris'], text: F.denied }]);
    expect(crossSessionNotices(F.expiredDelivery!)).toEqual([{ kind: 'delivery', status: 'expired', count: 1, recipients: [], text: F.expiredDelivery }]);
    expect(crossSessionNotices(F.delivered!)).toMatchObject([{ status: 'delivered', recipients: ['Orion'] }]);
    expect(crossSessionNotices(F.refused!)).toMatchObject([{ status: 'refused', recipients: ['Pim'] }]);
    expect(crossSessionNotices(F.dropped!)).toMatchObject([{ status: 'dropped', count: 1, recipients: ['Pim'], reason: 'you sent faster than that session accepts' }]);
  });

  it('splits several notices queued in one prompt, one per line start', () => {
    const all = crossSessionNotices(`${F.idle}\n${F.held}\n\n${F.exited}`)!;
    expect(all.map(n => n.kind)).toEqual(['idle', 'delivery', 'exited']);
    expect(all[0]!.text).toBe(F.idle);
  });

  it('is tolerant: an unknown wording keeps its kind and the quoted session, an unknown notice its text', () => {
    expect(crossSessionNotices('[Cross-session idle notice] "Zed" did something new.')).toEqual([{ kind: 'idle', peer: 'Zed', text: '[Cross-session idle notice] "Zed" did something new.' }]);
    expect(crossSessionNotices('[Cross-session delivery notice] Something else happened.')).toEqual([{ kind: 'delivery', status: 'unknown', count: 1, recipients: [], text: '[Cross-session delivery notice] Something else happened.' }]);
    expect(crossSessionNotices('[Cross-session relay notice] New.')).toEqual([{ kind: 'other', text: '[Cross-session relay notice] New.' }]);
  });

  it('is not a notice when the user wrote around one, nor for a message or a plain prompt', () => {
    expect(crossSessionNotices(F.userQuotingOne!)).toBeUndefined();
    expect(crossSessionNotices('<cross-session-message from="uds:x">\nSalut</cross-session-message>')).toBeUndefined();
    expect(crossSessionNotices('Lance les tests')).toBeUndefined();
  });
});
