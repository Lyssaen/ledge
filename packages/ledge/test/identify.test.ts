import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, SessionEvent } from '@ledge/protocol';
import { reduce } from '../src/daemon/state.js';
import { identify, pendingKey } from '../src/daemon/identify.js';
import { Store } from '../src/daemon/store.js';

const T0 = '2026-10-09T18:00:00.000Z';
const T1 = '2026-10-09T18:00:05.000Z';
const T2 = '2026-10-09T18:00:09.000Z';
const base = (extra: Partial<Session> = {}): Session => ({
  id: '7f3a', name: 'Otto', tool: 'claude', cwd: '/w/h', project: 'h', title: 'Otto · h', tmuxSession: 'ledge-7f3a',
  state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});
const idle = () => base({ state: 'idle' });
const ev = (name: SessionEvent['name'], extra: Partial<SessionEvent> = {}): SessionEvent => ({ name, at: T1, source: 'hook', ...extra });

describe('request identity in the reducer', () => {
  it('a new pending gets p1, version 1 and since = event time', () => {
    const s = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls', at: T1 }));
    expect(s.pending).toMatchObject({ id: `p1-${Date.parse(T1).toString(36)}`, version: 1, since: T1 });
    expect(s.pendingSeq).toBe(1);
  });
  it('hook over pane keeps id and bumps version', () => {
    const a = reduce(base({ tool: 'codex' }), ev('PanePrompt', { kind: 'permission', text: 'git push', source: 'pane' }));
    const b = reduce(a, ev('PermissionRequest', { tool: 'Bash', text: 'git push --force origin main' }));
    expect(b.pending!.id).toBe(a.pending!.id);
    expect(b.pending!.version).toBe(2);
    expect(b.pending!.since).toBe(a.pending!.since);
  });
  it('the same request again after a decision is a new id', () => {
    const a = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls' }));
    const b = reduce(reduce(a, ev('Decided', { source: 'daemon' })), ev('PermissionRequest', { tool: 'Bash', text: 'ls', at: T2 }));
    expect(b.pending!.id).not.toBe(a.pending!.id);
    expect(b.pendingSeq).toBe(2);
  });
  it('a helper request routed to the parent has its own id', () => {
    let s = reduce(base(), ev('SubagentStart', { helperId: 'a1', tool: 'Explore' }));
    s = reduce(s, ev('PermissionRequest', { tool: 'Bash', text: 'npm test', helperId: 'a1' }));
    expect(s.pending).toMatchObject({ helperId: 'a1', version: 1, since: T1 });
    expect(s.pending!.id).toMatch(/^p1-/);
  });
  it('the same request seen again keeps its version', () => {
    const a = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls' }));
    const b = reduce(a, ev('PermissionRequest', { tool: 'Bash', text: 'ls', at: T2 }));
    expect(b.pending).toMatchObject({ id: a.pending!.id, version: 1 });
  });
  it('nothing changes: reduce returns the same object', () => {
    const s = idle();
    expect(reduce(s, ev('PaneIdle'))).toBe(s);
  });
  it('identify leaves a session without pending alone', () => {
    const s = idle();
    expect(identify(s, { ...s }, T1).pending).toBeUndefined();
  });
  it('pendingKey tells requests apart by content', () => {
    const p = { kind: 'permission', text: 'ls', source: 'hook' } as const;
    expect(pendingKey(p)).toBe(pendingKey({ ...p }));
    expect(pendingKey(p)).not.toBe(pendingKey({ ...p, reason: 'List files' }));
  });
  it('a reason on the event lands on the pending', () => {
    const s = reduce(base(), ev('PermissionRequest', { tool: 'Bash', text: 'ls', reason: 'List files' }));
    expect(s.pending!.reason).toBe('List files');
  });
});

describe('Store.load identity', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ledge-id-')); process.env.LEDGE_HOME = dir; });
  it('gives an id to a journal pending that has none', async () => {
    const s = base({ state: 'waiting_permission', pending: { kind: 'permission', text: 'ls', source: 'hook' } });
    writeFileSync(join(dir, 'sessions.json'), JSON.stringify({ sessions: [s] }));
    const store = new Store(); await store.load();
    const loaded = store.get('7f3a')!;
    expect(loaded.pending).toMatchObject({ version: 1, since: T0 });
    expect(loaded.pending!.id).toMatch(/^p1-/);
    expect(loaded.pendingSeq).toBe(1);
  });
});
