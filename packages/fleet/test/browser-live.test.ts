import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { daemonStore } from '../src/store';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE } from '../src/machines';
import { fakeSession } from './mockDaemon';

/** The agent's browser through the fleet (docs/mockups/ledge-browser-live.html; protocol packages/protocol/src/browser.ts). */
const remote = { id: 'server', label: 'dev-server', url: 'ws://127.0.0.1:47832', ssh: 'dev-server' };
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const sent: ClientMessage[] = [];
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, set, emit: (m: ServerMessage) => messages.forEach(f => f(m)) };
}
function setup() {
  const local = peer(), server = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => (o.url === LOCAL_MACHINE.url ? local.client : server.client));
  const got: ServerMessage[] = []; client.onMessage(m => got.push(m)); client.connect();
  const snapshot: ServerMessage = { type: 'snapshot', sessions: [fakeSession('otto')], daemon: { version: '0.41.0', install: 'npm', systemd: true, browserLive: true } };
  local.emit(snapshot); server.emit({ ...snapshot, sshAlias: remote.ssh });
  return { client, local, server, got, snapshot };
}
const AT = '2026-11-03T14:56:00.000Z';
const live = (id: string, state: 'none' | 'off' | 'live' | 'closed' = 'live'): ServerMessage => ({ type: 'browser.live', id, state, tabs: state === 'live' ? 1 : 0, url: 'http://localhost:8733/a.html', title: 'A', since: AT });
const browsers = (got: ServerMessage[]) => got.filter(m => m.type === 'browser.live').map(m => `${(m as { id: string }).id}:${(m as { state: string }).state}`);
beforeEach(() => { localStorage.clear(); daemonStore.reset(); });

describe('the agent’s browser through the fleet', () => {
  it('qualifies browser.live and browser.frame by machine, and sends each browser again after a snapshot it publishes', () => {
    const { client, got, local, server } = setup();
    local.emit(live('otto'));
    server.emit(live('otto', 'closed'));
    local.emit({ type: 'browser.frame', id: 'otto', data: 'AAAA', at: AT, live: true });
    expect(browsers(got)).toEqual(['local:otto:live', 'server:otto:closed']);
    expect(got.filter(m => m.type === 'browser.frame').map(m => (m as { id: string }).id)).toEqual(['local:otto']);
    // Each snapshot the fleet publishes (asked, or another machine's) is followed by the browsers: a store that cleared them gets them back.
    got.length = 0;
    client.send({ type: 'snapshot.request' });
    const at = got.findIndex(m => m.type === 'snapshot');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(browsers(got.slice(at))).toEqual(['local:otto:live', 'server:otto:closed']);
    // `none` is forgotten, a daemon's snapshot forgets them all (it sends again those that are not none).
    local.emit(live('otto', 'none'));
    server.emit({ type: 'snapshot', sessions: [fakeSession('otto')], sshAlias: remote.ssh });
    expect(browsers(got.slice(got.map(m => m.type).lastIndexOf('snapshot')))).toEqual([]);
  });

  it('routes browser.watch to the session’s machine, and browser.enable to the local daemon whichever machine is selected', () => {
    const { client, local, server } = setup();
    client.send({ type: 'browser.watch', id: 'server:otto' });
    client.send({ type: 'browser.unwatch', id: 'local:otto' });
    client.fleet!.select('server');
    client.send({ type: 'browser.enable', rid: 'e1', confirmed: true });
    expect(server.sent).toEqual([{ type: 'browser.watch', id: 'otto' }]);
    expect(local.sent.filter(m => m.type.startsWith('browser.'))).toEqual([{ type: 'browser.unwatch', id: 'otto' }, { type: 'browser.enable', rid: 'e1', confirmed: true }]);
  });
});

describe('the store', () => {
  it('keeps each session’s browser that is not none, drops it with its session, and lets frames go by without a new state', () => {
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b')] });
    daemonStore.apply(live('a'));
    daemonStore.apply(live('b', 'off'));
    expect([...daemonStore.getState().browsers.keys()]).toEqual(['a', 'b']);
    const before = daemonStore.getState();
    daemonStore.apply({ type: 'browser.frame', id: 'a', data: 'AAAA', at: AT, live: true });
    daemonStore.apply({ type: 'browser.enabled', rid: 'e1', outcome: 'enabled' });
    expect(daemonStore.getState()).toBe(before);
    daemonStore.apply(live('b', 'none'));
    daemonStore.apply({ type: 'session.removed', id: 'a' });
    expect(daemonStore.getState().browsers.size).toBe(0);
    daemonStore.apply(live('a'));
    daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('a')] });
    expect(daemonStore.getState().browsers.size).toBe(0);
  });
});
