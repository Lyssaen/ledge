import { describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { agentMode, reconnectDelay } from '../src/term/mode';

const live: Session = {
  id: 'local:a', name: 'Nova', tool: 'claude', cwd: '/r', project: 'r', title: 'r', tmuxSession: 'ledge-a', state: 'working',
  helpers: [], startedAt: '2026-10-19T08:00:00.000Z', lastActivityAt: '2026-10-19T08:00:00.000Z', source: 'launcher'
};

describe('agentMode', () => {
  it('the agent tab is live, a subagent sees its parent, an offline or launched-elsewhere session gets the preview', () => {
    expect(agentMode(live, null, true)).toEqual({ kind: 'live' });
    expect(agentMode(live, { id: 'h1' }, true)).toEqual({ kind: 'parent', parentId: live.id });
    expect(agentMode({ ...live, offline: true }, { id: 'h1' }, true)).toEqual({ kind: 'offline' });
    expect(agentMode({ ...live, tmuxSession: null }, null, true)).toEqual({ kind: 'preview', why: 'outside' });
    expect(agentMode({ ...live, state: 'exited' }, null, true)).toEqual({ kind: 'preview', why: 'ended' });
    expect(agentMode(live, null, false)).toEqual({ kind: 'browser' });
    // OMP has no screen to attach nor to preview, live, ended or archived: the pane holds shells only.
    const omp = { ...live, tool: 'omp' as const, backend: 'omp-rpc' as const, tmuxSession: null };
    expect(agentMode(omp, null, true)).toEqual({ kind: 'native' });
    expect(agentMode({ ...omp, state: 'exited' }, null, true)).toEqual({ kind: 'native' });
    expect(agentMode(omp, null, false)).toEqual({ kind: 'browser' });
  });
  it('an archived session is ended, even with its tmux name gone', () => {
    expect(agentMode({ ...live, archivedAt: '2026-10-19T09:00:00.000Z', tmuxSession: null }, null, true)).toEqual({ kind: 'preview', why: 'ended' });
  });
  it('the browser build wins over everything', () => {
    expect(agentMode({ ...live, offline: true }, { id: 'h1' }, false)).toEqual({ kind: 'browser' });
  });
});

describe('reconnectDelay', () => {
  it('backs off 1, 2, 4, 8 then 15 s', () => { expect([1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]); });
});
