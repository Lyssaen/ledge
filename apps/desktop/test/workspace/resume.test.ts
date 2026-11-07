import { afterEach, describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { Session } from '@ledge/protocol';
import { agentTerminalTab, changesTab, empty, open } from '../../src/workspace/model';
import { LIVE_TABS_KEY, liveTabs, loadLiveTabs, nextMemo, saveLiveTabs, toResume } from '../../src/workspace/resume';
import { ATELIER_TAB } from '../../src/workspace/store';

const S = (id: string, extra: Partial<Session> = {}) => fakeSession(id, { name: id, ...extra });
const tab = (ref: string) => ({ kind: 'session' as const, ref });

afterEach(() => localStorage.clear());

describe('liveTabs', () => {
  it('the alive sessions with a tab: theirs, their Changes or their Terminal; sorted', () => {
    let w = open(empty(), ATELIER_TAB);
    w = open(w, tab('local:b'));
    w = open(w, changesTab('local:a'));
    w = open(w, agentTerminalTab('local:c'));
    const known = [S('local:a'), S('local:b'), S('local:c'), S('local:d')];
    expect(liveTabs(w, known)).toEqual(['local:a', 'local:b', 'local:c']);
  });

  it('leaves out the ended, the seats, the archived and those launched outside Ledge', () => {
    let w = empty();
    for (const id of ['x', 'seat', 'arch', 'hook', 'ok']) w = open(w, tab(`local:${id}`));
    const known = [
      S('local:x', { state: 'exited' }), S('local:seat', { source: 'rig', rig: { seat: 'dev@r', name: 'r' } }),
      S('local:arch', { archivedAt: '2026-11-07T10:00:00.000Z' }), S('local:hook', { source: 'hook_only' }), S('local:ok')
    ];
    expect(liveTabs(w, known)).toEqual(['local:ok']);
  });
});

describe('nextMemo', () => {
  it('keeps what a machine not ready had, takes the rest from the live tabs', () => {
    expect(nextMemo(['local:a', 'nas:b'], ['local:c'], new Set(['local']))).toEqual(['local:c', 'nas:b']);
    expect(nextMemo(['local:a'], [], new Set())).toEqual(['local:a']);
    expect(nextMemo(['local:a'], [], new Set(['local']))).toEqual([]);
  });
});

describe('toResume', () => {
  it('the memo\'s sessions now ended, that their machine can resume', () => {
    const known = [
      S('local:a', { state: 'exited' }), S('local:b'), S('local:c', { state: 'exited', offline: true }),
      S('local:d', { state: 'exited', archivedAt: '2026-11-07T10:00:00.000Z' }), S('local:e', { state: 'exited' })
    ];
    expect(toResume(['local:a', 'local:b', 'local:c', 'local:d', 'local:e', 'local:gone'], known, id => id !== 'local:e')).toEqual(['local:a']);
  });
});

describe('the memo in storage', () => {
  it('round trip; anything unreadable is an empty memo', () => {
    expect(loadLiveTabs()).toEqual([]);
    saveLiveTabs(['local:a']);
    expect(loadLiveTabs()).toEqual(['local:a']);
    localStorage.setItem(LIVE_TABS_KEY, '{"x":1}');
    expect(loadLiveTabs()).toEqual([]);
    localStorage.setItem(LIVE_TABS_KEY, '["local:a",3]');
    expect(loadLiveTabs()).toEqual(['local:a']);
  });
});
