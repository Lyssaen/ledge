import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ClientMessage, ServerMessage, Session, ThreadItem } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '../src/daemon/client';
import { daemonStore, attachClient } from '../src/daemon/store';
import { createFleetClient } from '../src/daemon/fleet';
import { LOCAL_MACHINE } from '../src/daemon/machines';
import { Surface } from '../src/surface/Surface';
import { fakeSession } from './mockDaemon';

/* An open session must survive the daemon's traffic in place: the same DOM nodes, a folded turn the user unfolded still
   unfolded. A view rebuilt from scratch on every message blinks and forgets what was open. */
const layer = () => document.querySelector('[data-layer="session"]') as HTMLElement;
const at = (s: number) => `2026-10-09T18:00:${String(s).padStart(2, '0')}.000Z`;
const items: ThreadItem[] = [
  { kind: 'prompt', id: 'prompt-1', at: at(1), turn: 1, text: 'first ask' },
  { kind: 'tool', id: 'tu-1', at: at(2), turn: 1, tool: 'Read', label: 'Read', status: 'success', files: [] },
  { kind: 'reply', id: 'reply-1', at: at(3), turn: 1, text: 'first answer' },
  { kind: 'prompt', id: 'prompt-2', at: at(4), turn: 2, text: 'second ask' },
  { kind: 'tool', id: 'tu-2', at: at(5), turn: 2, tool: 'Edit', label: 'Edit', input: 'src/a.ts', output: 'ok', status: 'success', files: [] }
];

/** A fake daemon socket: what the fleet client's peer sees. */
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const sent: ClientMessage[] = [];
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, emit: (m: ServerMessage) => act(() => { messages.forEach(f => f(m)); }) };
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); daemonStore.reset(); });
afterEach(() => { vi.useRealTimers(); });

/** Opens Otto, receives its thread, unfolds the previous turn and the tool row; returns what must stay put. */
function openAndUnfold(client: DaemonClient, deliverThread: () => void) {
  render(<Surface screenH={1080} theme="dark" client={client} dnd={false} onToggleDnd={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Otto .*open/ }));
  deliverThread();
  const root = layer();
  const previous = root.querySelector('[data-previous-turn]') as HTMLDetailsElement;
  const action = root.querySelector('[data-action]') as HTMLDetailsElement | null;
  expect(previous).toBeTruthy();
  previous.open = true;
  if (action) action.open = true;
  return { root, previous, action };
}
function expectStill({ root, previous, action }: ReturnType<typeof openAndUnfold>) {
  expect(layer()).toBe(root);
  expect(root.querySelector('[data-previous-turn]')).toBe(previous);
  expect(previous.open).toBe(true);
  if (action) { expect(root.querySelector('[data-action]')).toBe(action); expect(action.open).toBe(true); }
  expect(root.getAttribute('inert')).toBeNull();
  expect(root.querySelector('[data-thread]')).toBeTruthy();
}

describe('an open session stays put under daemon traffic', () => {
  it('direct daemon: keeps its DOM and an unfolded previous turn through updates, thread items and previews', () => {
    const client: DaemonClient = { connect() {}, close() {}, send() {}, status: () => 'open', onMessage: () => () => {}, onStatus: () => () => {} };
    const a = fakeSession('a');
    act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [a] }); });
    const kept = openAndUnfold(client, () => act(() => { daemonStore.apply({ type: 'session.thread', id: 'a', items }); }));
    act(() => { daemonStore.apply({ type: 'session.updated', session: { ...a, lastActivityAt: at(6) } }); });
    act(() => { daemonStore.apply({ type: 'session.preview', id: 'a', lines: ['$ tail'] }); });
    act(() => { daemonStore.apply({ type: 'session.thread.item', id: 'a', item: { kind: 'tool', id: 'tu-3', at: at(7), turn: 2, tool: 'Bash', label: 'Bash', status: 'running', files: [] } }); });
    act(() => { daemonStore.apply({ type: 'session.updated', session: { ...a, state: 'idle', lastActivityAt: at(8) } }); });
    act(() => { vi.advanceTimersByTime(5_000); });
    expectStill(kept);
  });

  it('through the fleet client (the app): a session.updated from the daemon neither empties the thread nor rebuilds the view', () => {
    const local = peer();
    const client = createFleetClient([LOCAL_MACHINE], () => local.client);
    const off = attachClient(client);
    act(() => { client.connect(); });
    const a = fakeSession('a');
    local.emit({ type: 'snapshot', sessions: [a], daemon: { version: '0.5.0', install: 'npm', systemd: true, routing: true } });
    const kept = openAndUnfold(client, () => local.emit({ type: 'session.thread', id: 'a', items }));
    expect(local.sent.filter(m => m.type === 'session.thread')).toHaveLength(1);
    const seq = daemonStore.getState().snapshotSeq;

    // The daemon's ordinary traffic while the user reads: tool hooks fire, the session's activity moves on.
    local.emit({ type: 'session.updated', session: { ...a, lastActivityAt: at(6) } });
    local.emit({ type: 'session.thread.item', id: 'a', item: { kind: 'tool', id: 'tu-3', at: at(7), turn: 2, tool: 'Bash', label: 'Bash', status: 'running', files: [] } });
    local.emit({ type: 'session.updated', session: { ...a, state: 'idle', lastActivityAt: at(8) } });
    act(() => { vi.advanceTimersByTime(5_000); });

    expect(daemonStore.getState().snapshotSeq).toBe(seq); // a session update is not a reconnection
    expect(daemonStore.getState().threads.get('local:a')).toHaveLength(items.length + 1);
    expect(local.sent.filter(m => m.type === 'session.thread')).toHaveLength(1); // not asked again
    expectStill(kept);
    off();
  });
});
