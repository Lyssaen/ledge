import { describe, expect, it } from 'vitest';
import type { SessionChange } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { baselineOf, cueOf, diffSessions, settledMachines, strongestCue, toastFor, toastKind } from '../src/notify/alerts';
import { MESSAGES } from '../src/i18n/messages';
import { machine } from './fleet-helpers';

const copy = MESSAGES.en.notify;
const working = fakeSession('local:a', { name: 'Otto', state: 'working' });
const asking = fakeSession('local:a', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', source: 'hook', text: 'Run the tests?' } });

describe('which machines count', () => {
  it('only an open machine that has delivered its sessions', () => {
    expect(settledMachines([machine('local'), machine('devbox', { status: 'unreachable', ready: false }), machine('nas', { status: 'connecting', ready: false })])).toEqual(['local']);
  });
});

describe('diffSessions', () => {
  it('reads an ask on a settled machine', () => {
    expect(diffSessions(baselineOf([working], ['local']), [asking])).toEqual([{ kind: 'asked', id: 'local:a', ask: 'approval' }]);
  });
  it('a machine seen for the first time, or back from offline, is a baseline: nothing to report', () => {
    expect(diffSessions(baselineOf([], []), [asking])).toEqual([]);
    expect(diffSessions(baselineOf([{ ...working, offline: true }], []), [asking])).toEqual([]);
  });
  it('a frozen session changes nothing', () => {
    expect(diffSessions(baselineOf([working], ['local']), [{ ...asking, offline: true }])).toEqual([]);
  });
});

describe('cues', () => {
  it('maps changes to the island cues and keeps the strongest of a burst', () => {
    expect(cueOf({ kind: 'asked', id: 'x', ask: 'question' })).toBe('question');
    expect(cueOf({ kind: 'failed', id: 'x' })).toBe('error');
    const burst: SessionChange[] = [{ kind: 'joined', id: 'b' }, { kind: 'finished', id: 'c' }, { kind: 'asked', id: 'd', ask: 'question' }];
    expect(strongestCue(burst)).toBe('question');
    expect(strongestCue([])).toBeNull();
  });
});

describe('toasts', () => {
  it('an ask always, a finish or a failure only with a visual alert', () => {
    expect(toastKind({ kind: 'asked', id: 'x', ask: 'approval' }, 'none')).toBe('approval');
    expect(toastKind({ kind: 'finished', id: 'x' }, 'sound')).toBeNull();
    expect(toastKind({ kind: 'finished', id: 'x' }, 'bubble')).toBe('finished');
    expect(toastKind({ kind: 'failed', id: 'x' }, 'both')).toBe('failed');
    expect(toastKind({ kind: 'joined', id: 'x' }, 'both')).toBeNull();
  });
  it('one session: its name and its request', () => {
    expect(toastFor([{ kind: 'asked', id: 'local:a', ask: 'approval' }], [asking], 'both', copy)).toEqual({ title: 'Otto needs your approval', body: 'Run the tests?' });
    expect(toastFor([{ kind: 'finished', id: 'local:a' }], [working], 'both', copy)).toEqual({ title: 'Otto has finished', body: 'harness-assistant' });
  });
  it('a burst is one grouped toast; nothing worth a toast is null', () => {
    const changes: SessionChange[] = [{ kind: 'asked', id: 'local:a', ask: 'approval' }, { kind: 'asked', id: 'local:b', ask: 'question' }, { kind: 'finished', id: 'local:c' }];
    expect(toastFor(changes, [asking], 'both', copy)).toEqual({ title: 'Your team', body: '3 sessions need you or have finished' });
    expect(toastFor(changes, [asking], 'none', copy)).toEqual({ title: 'Your team', body: '2 sessions need you or have finished' });
    expect(toastFor([{ kind: 'joined', id: 'local:a' }], [asking], 'both', copy)).toBeNull();
  });
});
