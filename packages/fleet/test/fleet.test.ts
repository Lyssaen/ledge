import { act, renderHook } from '@testing-library/react';
import { useOpenRigAsksAll } from '../src/openrigAsks';
import { useLatency } from '../src/latency';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import { daemonStore, attachClient } from '../src/store';
import { usageAlerts } from '../src/usage';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, canManage, parseMachines, probeMachine, shellCommand, sshProblem, terminalCommand, type MachineState } from '../src/machines';
import { fakeSession } from './mockDaemon';
import { createTokenSource, type TokenRead } from '../src/token';

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
  const local = peer(), server = peer(), extra = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => o.url === LOCAL_MACHINE.url ? local.client : o.url.endsWith('/ssh/dev-server') ? server.client : extra.client);
  const got: ServerMessage[] = []; client.onMessage(m => got.push(m)); client.connect();
  const snapshot: ServerMessage = { type: 'snapshot', sessions: [fakeSession('same')], launcher: ['node', '/opt/ledge/cli.js'], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true, openrigRig: true } };
  local.emit(snapshot); server.emit({ ...snapshot, sshAlias: remote.ssh });
  return { client, local, server, extra, got, snapshot };
}
const lastSnapshot = (got: ServerMessage[]) => got.filter(m => m.type === 'snapshot').at(-1)!;
const lastHistory = (got: ServerMessage[]) => got.filter(m => m.type === 'chat.history').at(-1)!.turns;
beforeEach(() => localStorage.clear());

it('keeps its history and machines under the given prefix', () => {
  const local = peer();
  createFleetClient([LOCAL_MACHINE], () => local.client, { prefix: 'desktop' }).fleet!.configure([LOCAL_MACHINE, remote]);
  expect(localStorage.getItem('desktop.machines')).toContain('dev-server');
  expect(localStorage.getItem('ledge.machines')).toBeNull();
});

it('writes the fleet history under the given prefix', () => {
  const local = peer();
  createFleetClient([LOCAL_MACHINE], () => local.client, { prefix: 'desktop' }).connect(); // connect() persists the history
  expect(localStorage.getItem('desktop.fleet.history')).not.toBeNull();
  expect(localStorage.getItem('ledge.fleet.history')).toBeNull();
});

describe('multi-machine connections', () => {
  it('never mistakes an old local daemon answering an SSH URL for the remote host', () => {
    const { client, server, snapshot, got, local } = setup();
    server.set('unreachable'); server.set('open'); server.emit(snapshot);
    expect(client.fleet!.machines().find(m => m.id === 'server')).toMatchObject({ ready: false, error: expect.stringContaining('Update the local') });
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
  });
  it('qualifies the agent screen, whichever machine streams it', () => {
    const { got, server } = setup();
    server.emit({ type: 'term.output', id: 'same', data: 'aGk=' });
    server.emit({ type: 'term.output', id: 'same', shell: 's1', data: 'aGk=' });
    server.emit({ type: 'term.exit', id: 'same', why: 'gone' });
    expect(got.filter(m => m.type === 'term.output' || m.type === 'term.exit')).toEqual([
      { type: 'term.output', id: 'server:same', data: 'aGk=' },
      { type: 'term.output', id: 'server:same', shell: 's1', data: 'aGk=' },
      { type: 'term.exit', id: 'server:same', why: 'gone' }
    ]);
  });
  it('qualifies the session of a thread message, whichever machine sent it', () => {
    const { got, local, server } = setup();
    const at = new Date().toISOString();
    const item = { kind: 'message' as const, id: 'm1', at, turn: 1, text: 'hi' };
    local.emit({ type: 'session.thread', id: 'same', items: [item] });
    server.emit({ type: 'session.thread.item', id: 'same', item });
    expect(got.filter(m => m.type === 'session.thread' || m.type === 'session.thread.item').map(m => (m as { id: string }).id)).toEqual(['local:same', 'server:same']);
  });
  it('qualifies colliding IDs and never broadcasts a command', () => {
    const { client, got, local, server } = setup();
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same', 'server:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(server.sent).toEqual([{ type: 'session.decide', id: 'same', decision: 'accept' }]);
    expect(local.sent).toEqual([]);
  });
  it('hides disconnected sessions until a fresh snapshot and never falls back', () => {
    const { client, got, local, server, snapshot } = setup();
    server.set('unreachable');
    expect(client.status()).toBe('open');
    expect(lastSnapshot(got).sessions.map(s => s.id)).toEqual(['local:same']);
    client.send({ type: 'session.decide', id: 'server:same', decision: 'accept' });
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
    server.set('open'); expect(lastSnapshot(got).sessions).toHaveLength(1);
    server.emit({ ...snapshot, sshAlias: remote.ssh }); expect(lastSnapshot(got).sessions).toHaveLength(2);
  });
  it('can remove and add connections while synchronous callbacks fire', () => {
    const { client, server } = setup();
    client.fleet!.select('server');
    expect(() => client.fleet!.configure([LOCAL_MACHINE, { ...remote, id: 'new', ssh: 'another-server' }])).not.toThrow();
    expect(client.fleet!.selected()).toBe('local');
    server.emit({ type: 'snapshot', sessions: [fakeSession('stale')] });
    expect(client.fleet!.machines().map(m => m.id)).toEqual(['local', 'new']);
  });
  it('keeps remote terminal and document destinations when selection changes', () => {
    const { client, local, server } = setup();
    expect(client.fleet!.terminal('server:same')).toEqual(['ssh', '-t', '--', 'dev-server', "'node' '/opt/ledge/cli.js' 'attach' 'same'"]);
    client.send({ type: 'document.read', requestId: 'd', path: '/w/a.md', sessionId: 'server:same' });
    expect(server.sent[0]).toMatchObject({ type: 'document.read', sessionId: 'same' });
    client.send({ type: 'document.read', requestId: 'unknown', path: '/w/a.md' });
    expect(local.sent).toEqual([]); expect(server.sent).toHaveLength(1);
  });
  it('a read-only attach asks ledge for it, locally and through ssh', () => {
    const at = (ssh: string | undefined) => ({ ...LOCAL_MACHINE, ssh, launcher: ['node', '/opt/ledge/cli.js'], status: 'open', ready: true, recents: [], sessions: [] }) as MachineState;
    expect(terminalCommand(at(undefined), 'a1', { readOnly: true })).toEqual(['node', '/opt/ledge/cli.js', 'attach', '--read-only', 'a1']);
    expect(terminalCommand(at('dev-server'), 'a1', { readOnly: true })!.at(-1)).toBe("'node' '/opt/ledge/cli.js' 'attach' '--read-only' 'a1'");
  });
  it('a shell starts in the folder, falls back to home, and runs the login shell', () => {
    const at = (ssh?: string) => ({ ...LOCAL_MACHINE, ssh, launcher: null, status: 'open', ready: true, recents: [], sessions: [] }) as MachineState;
    expect(shellCommand(at(), '/home/u/w t')).toEqual(['sh', '-c', "cd '/home/u/w t' 2>/dev/null || cd; exec $(getent passwd $(id -un) | cut -d: -f7) -l"]);
    expect(shellCommand(at('build-01'), "/srv/it's")).toEqual(['ssh', '-t', '--', 'build-01', "cd '/srv/it'\\''s' 2>/dev/null || cd; exec $SHELL -l"]);
  });
  it('#299: with its nonce and a daemon that says freeShell, the launcher starts the shell with the integration', () => {
    const N = '0123456789abcdef0123456789abcdef';
    const at = (ssh: string | undefined, freeShell: boolean | undefined) => ({ ...LOCAL_MACHINE, ssh, launcher: ['node', '/opt/ledge/cli.js'], status: 'open', ready: true, recents: [], sessions: [],
      daemon: { version: '0.58.0', install: 'npm', systemd: true, ...(freeShell === undefined ? {} : { freeShell }) } }) as MachineState;
    // Run for real in shell-command-exec.test.ts; here, its shape: the launcher asked, its line evaluated only behind the mark.
    expect(shellCommand(at(undefined, true), '/home/u/w t', N)).toEqual(['sh', '-c',
      `set -f; IFS=; l=$('node' '/opt/ledge/cli.js' 'shell' '--nonce' '${N}' '/home/u/w t' 2>/dev/null); case $l in ': ledge-shell; '*) eval $l;; esac; unset IFS; set +f; cd '/home/u/w t' 2>/dev/null || cd; exec $(getent passwd $(id -un) | cut -d: -f7) -l`]);
    const ssh = shellCommand(at('build-01', true), '/srv', N)!;
    expect(ssh.slice(0, 4)).toEqual(['ssh', '-t', '--', 'build-01']);
    expect(ssh[4]).toMatch(/^sh -c 'IFS=; set -f; eval \$\(printf %s \$0 \| base64 -d\)' [A-Za-z0-9+/=]+$/);
    // An older daemon, no nonce, or not a nonce: the shell as before, no marks.
    for (const [m, n] of [[at(undefined, undefined), N], [at(undefined, false), N], [at(undefined, true), undefined], [at(undefined, true), "x'; rm -rf ~"]] as const)
      expect(shellCommand(m, '/w', n)).toEqual(['sh', '-c', "cd '/w' 2>/dev/null || cd; exec $(getent passwd $(id -un) | cut -d: -f7) -l"]);
  });
  it('no shell for a folder wsl.exe would mangle', () => {
    const local = { ...LOCAL_MACHINE, launcher: null, status: 'open', ready: true, recents: [], sessions: [] } as MachineState;
    expect(shellCommand(local, '/w/"x"')).toBeNull();
    expect(shellCommand(local, '/w/x\\')).toBeNull();
    expect(shellCommand(local, '')).toBeNull();
  });
  it('the fleet opens a shell in the folder the agent moved into', () => {
    const { client, local } = setup();
    local.emit({ type: 'snapshot', sessions: [fakeSession('a1', { cwd: '/r', workdir: '/r/.worktrees/x' })], launcher: ['node', '/opt/ledge/cli.js'], daemon: { version: '0.4.0', install: 'npm', systemd: true, routing: true } });
    expect(client.fleet!.shell('local:a1')!.at(-1)).toContain("cd '/r/.worktrees/x'");
    expect(client.fleet!.shell('local:nope')).toBeNull();
    expect(client.fleet!.terminal('local:a1', { readOnly: true })).toContain('--read-only');
  });
  it('opens a terminal whatever the path or the id holds, as plain arguments; none for one WSL cannot receive as is', () => {
    const at = (ssh: string | undefined, launcher: string[]) => ({ ...LOCAL_MACHINE, ssh, launcher, status: 'open', ready: true, recents: [], sessions: [] }) as MachineState;
    const node = ['/usr/bin/node', '/opt/ledge/cli.js'];
    expect(terminalCommand(at(undefined, node), '3f2a')).toEqual(['/usr/bin/node', '/opt/ledge/cli.js', 'attach', '3f2a']);
    expect(terminalCommand(at('dev-server', node), '9b1c-e2')).toEqual(['ssh', '-t', '--', 'dev-server', "'/usr/bin/node' '/opt/ledge/cli.js' 'attach' '9b1c-e2'"]);
    // `wsl.exe --exec` runs no shell: a space, an accent or `$(…)` stays text in the one argument it is.
    expect(terminalCommand(at(undefined, ['/usr/bin/node', '/opt/My Tools/cli.js']), '3f2a')).toEqual(['/usr/bin/node', '/opt/My Tools/cli.js', 'attach', '3f2a']);
    expect(terminalCommand(at(undefined, ['/usr/bin/node', '/home/élise/cli.js']), '3f2a')).toEqual(['/usr/bin/node', '/home/élise/cli.js', 'attach', '3f2a']);
    expect(terminalCommand(at(undefined, node), '$(touch /tmp/x)')).toEqual(['/usr/bin/node', '/opt/ledge/cli.js', 'attach', '$(touch /tmp/x)']);
    // Through ssh the remote shell reads the command: each word goes single-quoted.
    expect(terminalCommand(at('dev-server', ['/usr/bin/node', "/home/élise/My Tools/cli.js"]), "a'b;$(id)")).toEqual(['ssh', '-t', '--', 'dev-server', "'/usr/bin/node' '/home/élise/My Tools/cli.js' 'attach' 'a'\\''b;$(id)'"]);
    // Windows Terminal wraps an argument holding a space in double quotes and escapes nothing: these would not arrive whole.
    for (const id of ['a"b', 'a\tb', 'a\nb', '']) {
      expect(terminalCommand(at('dev-server', node), id)).toBeNull();
      expect(terminalCommand(at(undefined, node), id)).toBeNull();
    }
    // A final backslash would escape wt's closing quote; through ssh the word ends with its own quote instead.
    expect(terminalCommand(at(undefined, node), 'a\\')).toBeNull();
    expect(terminalCommand(at('dev-server', node), 'a\\')).toEqual(['ssh', '-t', '--', 'dev-server', "'/usr/bin/node' '/opt/ledge/cli.js' 'attach' 'a\\'"]);
    expect(terminalCommand(at(undefined, ['/usr/bin/node', '/opt/"x"/cli.js']), '3f2a')).toBeNull();
  });
  it('sends a launch to the machine it names, without machineId, and qualifies session.launched', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server', dirs: ['/w/b'] });
    expect(server.sent).toEqual([{ type: 'session.launch', tool: 'claude', cwd: '/w/a', dirs: ['/w/b'] }]);
    expect(local.sent).toEqual([]);
    server.emit({ type: 'session.launched', id: 'new1' });
    expect(got.filter(m => m.type === 'session.launched')).toEqual([{ type: 'session.launched', id: 'server:new1' }]);
  });
  it('sends a launch without machineId to the selected machine', () => {
    const { client, local, server } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a' });
    expect(local.sent).toHaveLength(1); expect(server.sent).toEqual([]);
  });
  it('routes repos.inspect to its machine and relays repos.info with the same requestId', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    expect(server.sent).toEqual([{ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'] }]);
    server.emit({ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] });
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] }]);
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] });
    expect(local.sent).toEqual([{ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] }]);
    local.emit({ type: 'repos.info', requestId: 'unknown', repos: [] });
    server.emit({ type: 'repos.info', requestId: 'r2', repos: [] }); // not the machine asked
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
  });
  it('routes a folder.list with machineId and requestId to that machine, without machineId, and relays only its listing', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w', requestId: 'f1' }]); expect(local.sent).toEqual([]);
    const listing: ServerMessage = { type: 'folder.listing', requestId: 'f1', path: '/w', parent: '/', entries: ['a'], repos: [{ name: 'a', branch: 'main' }] };
    local.emit(listing); // not the machine asked
    server.emit({ ...listing, requestId: 'other' }); // not the request asked
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    server.emit(listing);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([listing]);
    server.emit(listing); // answered once
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('a folder.list with requestId and no machineId goes to the local machine, even when another is selected', () => {
    const { client, local, server, got } = setup();
    client.fleet!.select('server');
    client.send({ type: 'folder.list', requestId: 'f1' });
    expect(local.sent).toEqual([{ type: 'folder.list', requestId: 'f1' }]); expect(server.sent).toEqual([]);
    local.emit({ type: 'folder.listing', requestId: 'f1', path: '/h', parent: '/', entries: [] });
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('a folder.list with machineId and no requestId (an older front) goes to that machine; its untagged listing follows the selected machine', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w' }]); expect(local.sent).toEqual([]);
    const listing: ServerMessage = { type: 'folder.listing', path: '/w', parent: '/', entries: ['a'] };
    server.emit(listing); // Local is selected: an untagged listing from another machine is not relayed
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    client.fleet!.select('server');
    server.emit(listing);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([listing]);
    local.emit(listing); // not the selected machine
    expect(got.filter(m => m.type === 'folder.listing')).toHaveLength(1);
  });
  it('answers a folder.list for an offline machine with error offline, and for a machine that drops', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'offline' }]);
    client.send({ type: 'folder.list', path: '/x', machineId: 'server', requestId: 'f2' });
    expect(got.filter(m => m.type === 'folder.listing').at(-1)).toEqual({ type: 'folder.listing', requestId: 'f2', path: '/x', parent: null, entries: [], error: 'offline' });
    expect(server.sent).toEqual([{ type: 'folder.list', path: '/w', requestId: 'f1' }]);
  });
  it('a machine refusing folder.list answers the pending request with the daemon error text', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.emit({ type: 'error', message: 'invalid message', request: 'folder.list' });
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'invalid message' }]);
  });
  it('a repos.inspect refusal leaves pending listings alone, and a folder.list refusal leaves inspections alone', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/a'], machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/b'], machineId: 'server' });
    server.emit({ type: 'error', message: 'boom', request: 'folder.list' });
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'f1', path: '/w', parent: null, entries: [], error: 'boom' }]);
  });
  it('routes a folder.create with machineId and requestId to that machine, and relays only its listing', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.create', parent: '/w', name: 'new', machineId: 'server', requestId: 'c1' });
    expect(server.sent).toEqual([{ type: 'folder.create', parent: '/w', name: 'new', requestId: 'c1' }]); expect(local.sent).toEqual([]);
    const listing: ServerMessage = { type: 'folder.listing', requestId: 'c1', path: '/w/new', parent: '/w', entries: [] };
    local.emit(listing); // not the machine asked
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    server.emit(listing);
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([listing]);
  });
  it('answers a folder.create for an offline machine, one that drops, or refuses it, with an error that keeps the parent', () => {
    const { client, server, got } = setup();
    client.send({ type: 'folder.create', parent: '/w', name: 'a', machineId: 'server', requestId: 'c1' });
    server.emit({ type: 'error', message: 'invalid message', request: 'folder.create' });
    expect(got.filter(m => m.type === 'folder.listing')).toEqual([{ type: 'folder.listing', requestId: 'c1', path: '/w', parent: null, entries: [], error: 'invalid message' }]);
    client.send({ type: 'folder.create', parent: '/w', name: 'b', machineId: 'server', requestId: 'c2' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'folder.listing').at(-1)).toEqual({ type: 'folder.listing', requestId: 'c2', path: '/w', parent: null, entries: [], error: 'offline' });
    client.send({ type: 'folder.create', parent: '/w', name: 'c', machineId: 'server', requestId: 'c3' });
    expect(got.filter(m => m.type === 'folder.listing').at(-1)).toEqual({ type: 'folder.listing', requestId: 'c3', path: '/w', parent: null, entries: [], error: 'offline' });
    expect(server.sent.filter(m => m.type === 'folder.create')).toHaveLength(2);
  });
  it('an older daemon answers folder.create without its requestId: the new folder, or the parent with the refusal, from that machine answers it', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.create', parent: '/w', name: ' new ', machineId: 'server', requestId: 'c1' });
    local.emit({ type: 'folder.listing', path: '/w/new', parent: '/w', entries: [] }); // not the machine asked
    server.emit({ type: 'folder.listing', path: '/w/other', parent: '/w', entries: [] }); // not the folder asked
    expect(got.filter(m => m.type === 'folder.listing' && m.requestId === 'c1')).toEqual([]);
    server.emit({ type: 'folder.listing', path: '/w/new', parent: '/w', entries: [] });
    expect(got.filter(m => m.type === 'folder.listing' && m.requestId === 'c1')).toEqual([{ type: 'folder.listing', requestId: 'c1', path: '/w/new', parent: '/w', entries: [] }]);
    client.send({ type: 'folder.create', parent: '/', name: 'w', machineId: 'server', requestId: 'c2' });
    server.emit({ type: 'folder.listing', path: '/', parent: null, entries: ['w'], error: 'already exists: w' });
    expect(got.filter(m => m.type === 'folder.listing' && m.requestId === 'c2')).toEqual([{ type: 'folder.listing', requestId: 'c2', path: '/', parent: null, entries: ['w'], error: 'already exists: w' }]);
  });
  it('a folder.list without requestId keeps the old behaviour: the selected machine, relayed only from it', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'folder.list', path: '/w' });
    expect(local.sent).toEqual([{ type: 'folder.list', path: '/w' }]);
    const l: ServerMessage = { type: 'folder.listing', path: '/w', parent: '/', entries: [] };
    server.emit(l); expect(got.filter(m => m.type === 'folder.listing')).toEqual([]);
    local.emit(l); expect(got.filter(m => m.type === 'folder.listing')).toEqual([l]);
  });
  it('answers for an offline machine: an error for a launch, nothing found for an inspection', () => {
    const { client, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a', '/w/b'], machineId: 'server' });
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.launch' }]);
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }, { path: '/w/b', exists: false, branch: null }] }]);
    expect(server.sent).toEqual([]);
  });
  it('a launch in flight on a machine that drops is refused with its request', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.launch' }]);
  });
  it('answers an inspection pending on a machine that drops', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }] }]);
  });
  it('an older daemon refusing repos.inspect (« invalid message ») answers « not found » for each path, as a drop does', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a', '/w/b'], machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    expect(got.filter(m => m.type === 'repos.info')).toEqual([{ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: false, branch: null }, { path: '/w/b', exists: false, branch: null }] }]);
    server.emit({ type: 'repos.info', requestId: 'r1', repos: [{ path: '/w/a', exists: true, branch: 'main' }] }); // the inspection is no longer pending
    server.set('unreachable');
    expect(got.filter(m => m.type === 'repos.info')).toHaveLength(1);
  });
  it('a refused inspection of one machine leaves another machine\'s pending', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/w/a'], machineId: 'server' });
    client.send({ type: 'repos.inspect', requestId: 'r2', paths: ['/w/b'] });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.inspect' });
    local.emit({ type: 'repos.info', requestId: 'r2', repos: [{ path: '/w/b', exists: true, branch: 'dev' }] });
    expect(got.filter(m => m.type === 'repos.info').map(m => m.type === 'repos.info' && m.requestId)).toEqual(['r1', 'r2']);
  });
  it('sends action.run to the local daemon, whichever machine is selected: the registry and Ledge\'s tasks are its own', () => {
    const { client, local, server, got } = setup();
    client.fleet!.select('server');
    client.send({ type: 'action.run', rid: 'a1', action: 'task.answer', args: { task: 't1a2b3c', answer: 'oui' }, confirmed: true });
    expect(server.sent.filter(m => m.type === 'action.run')).toEqual([]);
    expect(local.sent.filter(m => m.type === 'action.run')).toEqual([{ type: 'action.run', rid: 'a1', action: 'task.answer', args: { task: 't1a2b3c', answer: 'oui' }, confirmed: true }]);
    local.emit({ type: 'action.result', rid: 'a1', action: 'task.answer' });
    expect(got.filter(m => m.type === 'action.result')).toEqual([{ type: 'action.result', rid: 'a1', action: 'task.answer' }]);
  });
  it('routes repos.scan to its machine without machineId (local by default) and relays only that machine\'s repos.found', () => {
    const { client, local, server, got } = setup();
    client.fleet!.select('server');
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's2' });
    expect(server.sent).toEqual([{ type: 'repos.scan', requestId: 's1' }]);
    expect(local.sent).toEqual([{ type: 'repos.scan', requestId: 's2' }]);
    const found: ServerMessage = { type: 'repos.found', requestId: 's1', repos: [{ path: '/w/ledge', branch: 'main', remote: 'github.com/paradow/ledge' }], truncated: false };
    local.emit(found); // not the machine asked
    local.emit({ ...found, requestId: 'unknown' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([]);
    server.emit(found);
    expect(got.filter(m => m.type === 'repos.found')).toEqual([found]);
    server.emit(found); // answered already
    local.emit({ type: 'repos.found', requestId: 's2', repos: [], truncated: true });
    expect(got.filter(m => m.type === 'repos.found').map(m => m.type === 'repos.found' && m.requestId)).toEqual(['s1', 's2']);
  });
  it('routes models.list to its machine (local by default), relays only that machine\'s listing, answers offline and outdated (#58)', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'models.list', requestId: 'm1', tool: 'codex', machineId: 'server' });
    client.send({ type: 'models.list', requestId: 'm2', tool: 'claude' });
    expect(server.sent).toEqual([{ type: 'models.list', requestId: 'm1', tool: 'codex' }]);
    expect(local.sent).toEqual([{ type: 'models.list', requestId: 'm2', tool: 'claude' }]);
    const listing: ServerMessage = { type: 'models.listing', requestId: 'm1', tool: 'codex', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }] };
    local.emit(listing); // not the machine asked
    expect(got.filter(m => m.type === 'models.listing')).toEqual([]);
    server.emit(listing); server.emit(listing);
    expect(got.filter(m => m.type === 'models.listing')).toEqual([listing]);
    // An older daemon refuses models.list: answered outdated, the other machine's request still pending.
    client.send({ type: 'models.list', requestId: 'm3', tool: 'cursor', machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'models.list' });
    expect(got.filter(m => m.type === 'models.listing').at(-1)).toEqual({ type: 'models.listing', requestId: 'm3', tool: 'cursor', models: [], error: 'outdated' });
    client.send({ type: 'models.list', requestId: 'm4', tool: 'codex', machineId: 'server' });
    server.set('unreachable');
    client.send({ type: 'models.list', requestId: 'm5', tool: 'codex', machineId: 'server' });
    expect(got.filter(m => m.type === 'models.listing').slice(-2).map(m => m.type === 'models.listing' && [m.requestId, m.error])).toEqual([['m4', 'offline'], ['m5', 'offline']]);
    local.emit({ type: 'models.listing', requestId: 'm2', tool: 'claude', models: [] });
    expect(got.filter(m => m.type === 'models.listing').at(-1)).toMatchObject({ requestId: 'm2' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  describe('pull and merge requests (lot 8a)', () => {
    const AT = '2026-11-08T10:00:00.000Z';
    const pr = (n: number, sessions: string[], extra = {}) => ({ id: `github.com/Lyssaen/ledge#${n}`, forge: 'github' as const, host: 'github.com', repo: 'Lyssaen/ledge', number: n, ref: `#${n}`,
      url: `https://github.com/Lyssaen/ledge/pull/${n}`, title: 't', state: 'open' as const, branch: `b${n}`, target: 'main', headSha: 'a'.repeat(40), pipeline: 'ok' as const,
      approvals: { given: 1 }, mergeable: true, openThreads: 0, updatedAt: AT, sessions, ...extra });
    const forgeSetup = () => {
      const s = setup();
      const withForge = { ...s.snapshot, daemon: { version: '0.54.0', install: 'npm' as const, systemd: true, routing: true, forge: true } };
      s.local.emit(withForge); s.server.emit({ ...withForge, sshAlias: remote.ssh });
      return s;
    };
    it('sums two machines, sessions qualified, each request with its machine', () => {
      const { client, local, server, got } = forgeSetup();
      let changes = 0;
      client.fleet!.onForge(() => changes++);
      local.emit({ type: 'forge.state', prs: [pr(226, ['same'])], forges: [{ forge: 'github', host: 'github.com', status: 'ok', at: AT }] });
      server.emit({ type: 'forge.state', prs: [pr(41, ['same', 'other'], { forge: 'gitlab', host: 'gitlab.com', ref: '!41' })], forges: [{ forge: 'gitlab', host: 'gitlab.com', status: 'missing', message: 'glab is not installed', at: AT }] });
      expect(client.fleet!.prs().map(p => [p.ref, p.machineId, p.sessions])).toEqual([['#226', 'local', ['local:same']], ['!41', 'server', ['server:same', 'server:other']]]);
      expect(client.fleet!.forges().map(f => [f.machineId, f.status])).toEqual([['local', 'ok'], ['server', 'missing']]);
      expect(client.fleet!.followed()).toEqual([]);
      expect(changes).toBe(2);
      expect(got.filter(m => m.type === 'forge.state').map(m => m.type === 'forge.state' && m.machineId)).toEqual(['local', 'server']);
      server.emit({ type: 'forge.state', prs: [], forges: [], followed: [{ session: 'same', forge: 'gitlab', host: 'gitlab.com', repo: 'synapse/synapse' }] });
      expect(client.fleet!.followed()).toEqual([{ session: 'server:same', forge: 'gitlab', host: 'gitlab.com', repo: 'synapse/synapse', machineId: 'server' }]);
    });
    it('a machine that falls takes its requests out and rejects its request in flight « hors ligne »', async () => {
      const { client, server } = forgeSetup();
      server.emit({ type: 'forge.state', prs: [pr(41, ['same'])], forges: [] });
      const asked = client.fleet!.prDetail('github.com/Lyssaen/ledge#41', 'server');
      const sent = server.sent.at(-1) as Extract<ClientMessage, { type: 'forge.detail' }>;
      expect(sent).toMatchObject({ type: 'forge.detail', prId: 'github.com/Lyssaen/ledge#41' });
      expect(sent).not.toHaveProperty('machineId');
      server.set('unreachable');
      await expect(asked).rejects.toEqual({ code: 'offline', message: 'hors ligne' });
      expect(client.fleet!.prs()).toEqual([]);
      await expect(client.fleet!.prAct('github.com/Lyssaen/ledge#41', 'server', { kind: 'rerun' })).rejects.toMatchObject({ code: 'offline' });
    });
    it('routes to the machine asked and answers once, from it; a refusal rejects with its code', async () => {
      const { client, local, server } = forgeSetup();
      const act = client.fleet!.prAct('github.com/Lyssaen/ledge#226', 'local', { kind: 'merge', headSha: 'a'.repeat(40) });
      const sent = local.sent.at(-1) as Extract<ClientMessage, { type: 'forge.act' }>;
      server.emit({ type: 'forge.act.reply', requestId: sent.requestId, ok: true, command: 'from the wrong machine' });
      local.emit({ type: 'forge.act.reply', requestId: sent.requestId, ok: false, code: 'not_offered', message: 'the pipeline is not green' });
      await expect(act).rejects.toEqual({ code: 'not_offered', message: 'the pipeline is not green' });
      const detail = client.fleet!.prDetail('github.com/Lyssaen/ledge#226', 'local', { log: '42' });
      const d = local.sent.at(-1) as Extract<ClientMessage, { type: 'forge.detail' }>;
      expect(d.log).toBe('42');
      local.emit({ type: 'forge.detail.reply', requestId: d.requestId, ok: true, detail: { pr: pr(226, ['same']), description: '', author: 'pim', reviewers: [], labels: [], issues: [], jobs: [], threads: [], files: [], commits: [], mergeCommand: 'gh pr merge', mergeBlockers: [] } });
      expect((await detail).pr.sessions).toEqual(['local:same']);
    });
    it('a daemon without forge: true does not count: its request is « version trop ancienne »', async () => {
      const { client, server } = setup();
      await expect(client.fleet!.prDetail('github.com/x/y#1', 'server')).rejects.toMatchObject({ code: 'outdated' });
      expect(server.sent.filter(m => m.type === 'forge.detail')).toEqual([]);
    });
  });
  it('keeps each machine\'s usage; the threshold goes to every machine, « Compris » to those that hold the alert', () => {
    const { client, local, server } = setup();
    const alert = { id: 'claude|a1b2c3d4e5f6|five_hour|-|threshold|-', harness: 'claude' as const, account: 'a1b2c3d4e5f6', window: { kind: 'five_hour' as const, pct: 84, resetsAt: null }, level: 'threshold' as const, at: '2026-11-05T14:00:00.000Z' };
    const state = (alerts: typeof alert[]) => ({ type: 'usage.state' as const, harnesses: [], alerts, prefs: { alert: 0.8 } });
    expect(client.fleet!.usage().size).toBe(0);
    local.emit(state([alert])); server.emit(state([]));
    expect([...client.fleet!.usage().keys()]).toEqual(['local', 'server']);
    expect(client.fleet!.usage().get('local')?.machineId).toBe('local');
    client.fleet!.setUsageAlert(0.9);
    expect(local.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }]);
    expect(server.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }]);
    client.fleet!.ackUsage(alert.id);
    expect(local.sent.at(-1)).toEqual({ type: 'usage.ack', id: alert.id });
    expect(server.sent).toHaveLength(1);
    expect(() => client.fleet!.setUsageAlert(0.2)).toThrow();
  });

  it('a machine away when the threshold or « Compris » was given gets them once it speaks again (review of 39e21fa2)', () => {
    const { client, local, server, snapshot } = setup();
    const alert = { id: 'x', harness: 'claude' as const, account: 'a1b2c3d4e5f6', window: { kind: 'five_hour' as const, pct: 100, resetsAt: null }, level: 'full' as const, at: new Date().toISOString() };
    const state = { type: 'usage.state' as const, harnesses: [], alerts: [alert], prefs: { alert: 0.8 } };
    local.emit(state); server.emit(state);
    server.set('unreachable');
    client.fleet!.setUsageAlert(0.9);
    client.fleet!.ackUsage('x');
    expect(server.sent).toEqual([]);
    server.set('open'); server.emit({ ...snapshot, sshAlias: remote.ssh }); server.emit(state);
    expect(server.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }, { type: 'usage.ack', id: 'x' }]);
    // Once only: the next state sends nothing more.
    server.emit({ ...state, prefs: { alert: 0.9 }, alerts: [] });
    expect(server.sent).toHaveLength(2);
  });

  it('what a machine away missed survives the front\'s restart; a « Compris » follows an alert born there later (review of 975e508b)', () => {
    const a = (pct: number) => ({ id: 'claude|acc|five_hour|-|threshold|r1', harness: 'claude' as const, account: 'a1b2c3d4e5f6', window: { kind: 'five_hour' as const, pct, resetsAt: null }, level: 'threshold' as const, at: new Date().toISOString() });
    const st = (alerts: ReturnType<typeof a>[], alert = 0.8) => ({ type: 'usage.state' as const, harnesses: [], alerts, prefs: { alert } });
    const first = setup();
    first.local.emit(st([a(84)])); first.server.emit(st([]));
    first.server.set('unreachable');
    first.client.fleet!.setUsageAlert(0.9);
    // The alert is raised on Local only; « Compris » there. The server, away, will raise the same one later.
    first.client.fleet!.ackUsage(a(84).id);
    expect(first.local.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }, { type: 'usage.ack', id: a(84).id }]);
    expect(first.server.sent).toEqual([]);
    // The front quits; a new one starts (same storage), the server comes back with the alert and its old threshold.
    first.client.close?.();
    const again = setup();
    again.server.emit(st([a(84)]));
    expect(again.server.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }, { type: 'usage.ack', id: a(84).id }]);
    // Once: the server's next state (it has both) sends nothing more.
    again.server.emit(st([], 0.9));
    expect(again.server.sent).toHaveLength(2);
  });

  it('a machine never heard from this run gets the threshold when it comes; one set elsewhere since keeps its own (review of 05601442)', () => {
    const st = (alert: number) => ({ type: 'usage.state' as const, harnesses: [], alerts: [], prefs: { alert } });
    // The server is away from the start: it never sent its usage.
    const a = setup();
    a.local.emit(st(0.8));
    a.server.set('unreachable');
    a.client.fleet!.setUsageAlert(0.9);
    a.server.set('open'); a.server.emit({ ...a.snapshot, sshAlias: remote.ssh }); a.server.emit(st(0.8));
    expect(a.server.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }]);
    localStorage.clear();
    // Seen at 0.8, then away; set to 0.9 here. Meanwhile another front set it to 0.7 there: on its return 0.7 stays.
    const b = setup();
    b.local.emit(st(0.8)); b.server.emit(st(0.8));
    b.server.set('unreachable');
    b.client.fleet!.setUsageAlert(0.9);
    b.server.set('open'); b.server.emit({ ...b.snapshot, sshAlias: remote.ssh }); b.server.emit(st(0.7));
    expect(b.server.sent).toEqual([]);
  });

  it('an offline machine\'s alert counts only while its reading is under an hour old, as its windows (review of 39e21fa2)', () => {
    const old = new Date(Date.now() - 2 * 3600_000).toISOString();
    const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
    const w = { kind: 'five_hour' as const, pct: 100, resetsAt: null };
    const st = (readAt: string) => ({ type: 'usage.state' as const, harnesses: [{ harness: 'claude' as const, account: 'a1b2c3d4e5f6', status: 'ok' as const, readAt, windows: [w] }], alerts: [{ id: 'x', harness: 'claude' as const, account: 'a1b2c3d4e5f6', window: w, level: 'full' as const, at: readAt }], prefs: { alert: 0.8 } });
    expect(usageAlerts(new Map([['server', st(old)]]), () => false)).toEqual([]);
    expect(usageAlerts(new Map([['server', st(fresh)]]), () => false)).toHaveLength(1);
    expect(usageAlerts(new Map([['server', st(old)]]), () => true)).toHaveLength(1);
  });

  it('relays each machine\'s usage tagged with it, and sends the threshold and « Compris » to the machine named (local by default)', () => {
    const { client, local, server, got } = setup();
    const state = { type: 'usage.state' as const, harnesses: [{ harness: 'claude' as const, account: 'a1b2c3d4e5f6', status: 'ok' as const, readAt: '2026-11-05T14:00:00.000Z', windows: [] }], alerts: [], prefs: { alert: 0.8 } };
    server.emit(state); local.emit(state);
    expect(got.filter(m => m.type === 'usage.state').map(m => m.type === 'usage.state' && m.machineId)).toEqual(['server', 'local']);
    client.send({ type: 'usage.set', prefs: { alert: 0.9 }, machineId: 'server' });
    client.send({ type: 'usage.ack', id: 'x' });
    expect(server.sent).toEqual([{ type: 'usage.set', prefs: { alert: 0.9 } }]);
    expect(local.sent).toEqual([{ type: 'usage.ack', id: 'x' }]);
    // An offline machine: nothing is sent, nothing answers.
    server.set('unreachable');
    client.send({ type: 'usage.ack', id: 'y', machineId: 'server' });
    expect(server.sent).toHaveLength(1);
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes session.commands to the session\'s machine, relays only its listing with the qualified id, answers offline and outdated', () => {
    const { client, local, server, got } = setup();
    const listings = () => got.filter(m => m.type === 'session.commands.listing');
    client.send({ type: 'session.commands', requestId: 'c1', id: 'server:otto' });
    client.send({ type: 'session.commands', requestId: 'c2', id: 'local:nova' });
    expect(server.sent).toEqual([{ type: 'session.commands', requestId: 'c1', id: 'otto' }]);
    expect(local.sent).toEqual([{ type: 'session.commands', requestId: 'c2', id: 'nova' }]);
    const listing: ServerMessage = { type: 'session.commands.listing', requestId: 'c1', id: 'otto', tool: 'claude', commands: [{ name: 'compact', source: 'builtin' }] };
    local.emit(listing); // not the machine asked
    expect(listings()).toEqual([]);
    server.emit(listing); server.emit(listing);
    expect(listings()).toEqual([{ ...listing, id: 'server:otto' }]);
    // An older daemon refuses session.commands: answered outdated.
    client.send({ type: 'session.commands', requestId: 'c3', id: 'server:otto' });
    server.emit({ type: 'error', message: 'invalid message', request: 'session.commands' });
    expect(listings().at(-1)).toEqual({ type: 'session.commands.listing', requestId: 'c3', id: 'server:otto', commands: [], error: 'outdated' });
    client.send({ type: 'session.commands', requestId: 'c4', id: 'server:otto' });
    server.set('unreachable');
    client.send({ type: 'session.commands', requestId: 'c5', id: 'server:otto' });
    client.send({ type: 'session.commands', requestId: 'c6', id: 'nowhere' });
    expect(listings().slice(-3).map(m => m.type === 'session.commands.listing' && [m.requestId, m.id, m.error])).toEqual([['c4', 'server:otto', 'offline'], ['c5', 'server:otto', 'offline'], ['c6', 'nowhere', 'offline']]);
    local.emit({ type: 'session.commands.listing', requestId: 'c2', id: 'nova', commands: [] });
    expect(listings().at(-1)).toMatchObject({ requestId: 'c2', id: 'local:nova' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes OpenRig asks to their machine, tags each answer with it, answers offline and outdated', () => {
    const { client, local, server, got } = setup();
    const rig = () => got.filter(m => m.type === 'openrig.state' || m.type === 'openrig.done');
    client.send({ type: 'openrig.status', requestId: 'r1', machineId: 'server' });
    client.send({ type: 'openrig.act', requestId: 'r2', action: { kind: 'daemon.stop' } });
    expect(server.sent).toEqual([{ type: 'openrig.status', requestId: 'r1' }]);
    expect(local.sent).toEqual([{ type: 'openrig.act', requestId: 'r2', action: { kind: 'daemon.stop' } }]);
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, rigs: [], at: '2026-11-02T09:00:00.000Z' };
    local.emit({ type: 'openrig.state', requestId: 'r1', state }); // not the machine asked
    expect(rig()).toEqual([]);
    server.emit({ type: 'openrig.state', requestId: 'r1', state }); server.emit({ type: 'openrig.state', requestId: 'r1', state });
    expect(rig()).toEqual([{ type: 'openrig.state', requestId: 'r1', machineId: 'server', state }]);
    local.emit({ type: 'openrig.done', requestId: 'r2', ok: true, commands: ['rig daemon stop'] });
    // The state an action broadcasts reaches the fronts from whichever machine, tagged with it.
    server.emit({ type: 'openrig.state', state });
    expect(rig().slice(-2)).toEqual([
      { type: 'openrig.done', requestId: 'r2', machineId: 'local', ok: true, commands: ['rig daemon stop'] },
      { type: 'openrig.state', machineId: 'server', state }
    ]);
    // An older daemon refuses OpenRig: answered outdated; a drop and an offline machine answer offline.
    client.send({ type: 'openrig.status', requestId: 'r3', machineId: 'server' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.status' });
    expect(rig().at(-1)).toEqual({ type: 'openrig.state', requestId: 'r3', machineId: 'server', error: 'outdated' });
    client.send({ type: 'openrig.act', requestId: 'r4', machineId: 'server', action: { kind: 'rig.start', rig: 'starter' } });
    server.set('unreachable');
    client.send({ type: 'openrig.status', requestId: 'r5', machineId: 'server' });
    expect(rig().slice(-2)).toEqual([
      { type: 'openrig.done', requestId: 'r4', machineId: 'server', ok: false, commands: [], error: 'offline' },
      { type: 'openrig.state', requestId: 'r5', machineId: 'server', error: 'offline' }
    ]);
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes the spec list and a launch to their machine, answers them offline and outdated', () => {
    const { client, server, got } = setup();
    const rig = () => got.filter(m => m.type === 'openrig.specList' || m.type === 'openrig.launched');
    client.send({ type: 'openrig.specs', requestId: 's1', machineId: 'server' });
    client.send({ type: 'openrig.launch', requestId: 'l1', machineId: 'server', launch: { spec: 'starter', cwd: '/w', name: 'starter', plan: true } });
    expect(server.sent).toEqual([{ type: 'openrig.specs', requestId: 's1' }, { type: 'openrig.launch', requestId: 'l1', launch: { spec: 'starter', cwd: '/w', name: 'starter', plan: true } }]);
    server.emit({ type: 'openrig.specList', requestId: 's1', specs: [] });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.launch' });
    expect(rig()).toEqual([
      { type: 'openrig.specList', requestId: 's1', machineId: 'server', specs: [] },
      { type: 'openrig.launched', requestId: 'l1', machineId: 'server', ok: false, plan: false, commands: [], error: 'outdated' }
    ]);
    server.set('unreachable');
    client.send({ type: 'openrig.specs', requestId: 's2', machineId: 'server' });
    expect(rig().at(-1)).toEqual({ type: 'openrig.specList', requestId: 's2', machineId: 'server', specs: [], error: 'offline' });
  });
  it('routes a queue row to its machine; an older daemon refuses only that ask', () => {
    const { client, server, got } = setup();
    const rows = () => got.filter(m => m.type === 'openrig.rowState' || m.type === 'openrig.roleList');
    client.send({ type: 'openrig.row', requestId: 'w1', machineId: 'server', qitem: 'qitem-1-a' });
    expect(server.sent).toEqual([{ type: 'openrig.row', requestId: 'w1', qitem: 'qitem-1-a' }]);
    server.emit({ type: 'openrig.rowState', requestId: 'w1', qitem: 'qitem-1-a', error: 'not_found' });
    server.emit({ type: 'openrig.rowState', requestId: 'w1', qitem: 'qitem-1-a', error: 'not_found' }); // once only
    expect(rows()).toEqual([{ type: 'openrig.rowState', requestId: 'w1', machineId: 'server', qitem: 'qitem-1-a', error: 'not_found' }]);
    client.send({ type: 'openrig.roles', requestId: 'o1', machineId: 'server' });
    client.send({ type: 'openrig.row', requestId: 'w2', machineId: 'server', qitem: 'qitem-2-b' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.row' });
    expect(rows().at(-1)).toEqual({ type: 'openrig.rowState', requestId: 'w2', machineId: 'server', qitem: 'qitem-2-b', error: 'outdated' });
    server.emit({ type: 'openrig.roleList', requestId: 'o1', roles: [] }); // the roles ask was still pending
    expect(rows().at(-1)).toEqual({ type: 'openrig.roleList', requestId: 'o1', machineId: 'server', roles: [] });
    server.set('unreachable');
    client.send({ type: 'openrig.row', requestId: 'w3', machineId: 'server', qitem: 'qitem-3-c' });
    expect(rows().at(-1)).toEqual({ type: 'openrig.rowState', requestId: 'w3', machineId: 'server', qitem: 'qitem-3-c', error: 'offline' });
  });
  it('routes « À toi » asks and answers to their machine; a push carries its machine; an older daemon refuses only those', () => {
    const { client, server, got } = setup();
    const human = () => got.filter(m => m.type === 'openrig.asksChanged' || m.type === 'openrig.answered' || m.type === 'openrig.state');
    client.send({ type: 'openrig.asks', requestId: 'h1', machineId: 'server' });
    client.send({ type: 'openrig.answer', requestId: 'h2', machineId: 'server', qitemId: 'q1', answer: { kind: 'seen' } });
    expect(server.sent).toEqual([{ type: 'openrig.asks', requestId: 'h1' }, { type: 'openrig.answer', requestId: 'h2', qitemId: 'q1', answer: { kind: 'seen' } }]);
    const channel = { state: 'ready' as const, person: null, slack: false };
    server.emit({ type: 'openrig.asksChanged', requestId: 'h1', channel, asks: [] });
    server.emit({ type: 'openrig.asksChanged', channel, asks: [] }); // a push
    server.emit({ type: 'openrig.answered', requestId: 'h2', qitemId: 'q1', ok: true, outcome: 'answered' });
    expect(human()).toEqual([
      { type: 'openrig.asksChanged', requestId: 'h1', machineId: 'server', channel, asks: [] },
      { type: 'openrig.asksChanged', machineId: 'server', channel, asks: [] },
      { type: 'openrig.answered', requestId: 'h2', machineId: 'server', qitemId: 'q1', ok: true, outcome: 'answered' }
    ]);
    client.send({ type: 'openrig.status', requestId: 'h3', machineId: 'server' });
    client.send({ type: 'openrig.answer', requestId: 'h4', machineId: 'server', qitemId: 'q2', answer: { kind: 'words', text: 'Oui' } });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.answer' });
    expect(human().at(-1)).toEqual({ type: 'openrig.answered', requestId: 'h4', machineId: 'server', qitemId: 'q2', ok: false, error: 'outdated' });
    server.set('unreachable');
    client.send({ type: 'openrig.asks', requestId: 'h5', machineId: 'server' });
    expect(human().at(-1)).toEqual({ type: 'openrig.asksChanged', requestId: 'h5', machineId: 'server', asks: [], error: 'offline' });
  });
  it('an answer already sent whose machine drops is uncertain, never offline; a read stays offline; an answer refused before sending is offline', () => {
    const { client, server, got } = setup();
    client.send({ type: 'openrig.answer', requestId: 'w1', machineId: 'server', qitemId: 'q1', answer: { kind: 'seen' } });
    client.send({ type: 'openrig.asks', requestId: 'w2', machineId: 'server' });
    server.set('unreachable');
    const end = (id: string) => got.find(m => 'requestId' in m && m.requestId === id);
    expect(end('w1')).toMatchObject({ type: 'openrig.answered', qitemId: 'q1', ok: false, error: 'uncertain' });
    expect(end('w2')).toMatchObject({ type: 'openrig.asksChanged', error: 'offline' });
    client.send({ type: 'openrig.answer', requestId: 'w3', machineId: 'server', qitemId: 'q2', answer: { kind: 'seen' } });
    expect(end('w3')).toMatchObject({ type: 'openrig.answered', ok: false, error: 'offline' });
  });
  it('through the real fleet, useOpenRigAsksAll gets uncertain for an answer whose machine drops in flight, offline for one refused before', async () => {
    const { client, server } = setup();
    const { result } = renderHook(() => useOpenRigAsksAll(client, ['local', 'server']));
    const inFlight = result.current.answer('server', 'q-flight', { kind: 'words', text: 'Oui' });
    expect(server.sent.some(m => m.type === 'openrig.answer')).toBe(true);
    act(() => { server.set('unreachable'); });
    expect(await inFlight).toMatchObject({ type: 'openrig.answered', machineId: 'server', qitemId: 'q-flight', ok: false, error: 'uncertain' });
    expect(await result.current.answer('server', 'q-after', { kind: 'seen' })).toMatchObject({ machineId: 'server', qitemId: 'q-after', ok: false, error: 'offline' });
  });
  it('routes goals, a goal sent and a reply to Max to their machine; an older daemon refuses only those', () => {
    const { client, server, got } = setup();
    const goals = () => got.filter(m => m.type === 'openrig.goalsChanged' || m.type === 'openrig.goal.sent' || m.type === 'openrig.goal.replied');
    client.send({ type: 'openrig.goals', requestId: 'g1', machineId: 'server' });
    client.send({ type: 'openrig.goal.send', requestId: 'g2', machineId: 'server', goalId: 'abcdef12-0000', text: 'x' });
    expect(server.sent).toEqual([{ type: 'openrig.goals', requestId: 'g1' }, { type: 'openrig.goal.send', requestId: 'g2', goalId: 'abcdef12-0000', text: 'x' }]);
    server.emit({ type: 'openrig.goalsChanged', requestId: 'g1', goals: [] });
    server.emit({ type: 'openrig.goalsChanged', goals: [] }); // a push
    server.emit({ type: 'openrig.goal.sent', requestId: 'g2', goalId: 'abcdef12-0000', ok: true, qitemId: 'q' });
    expect(goals()).toEqual([
      { type: 'openrig.goalsChanged', requestId: 'g1', machineId: 'server', goals: [] },
      { type: 'openrig.goalsChanged', machineId: 'server', goals: [] },
      { type: 'openrig.goal.sent', requestId: 'g2', machineId: 'server', goalId: 'abcdef12-0000', ok: true, qitemId: 'q' }
    ]);
    client.send({ type: 'openrig.asks', requestId: 'g3', machineId: 'server' });
    client.send({ type: 'openrig.goal.reply', requestId: 'g4', machineId: 'server', goalId: 'abcdef12-0000', replyId: 'fedcba98-0000', text: 'y' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.goal.reply' });
    expect(goals().at(-1)).toEqual({ type: 'openrig.goal.replied', requestId: 'g4', machineId: 'server', goalId: 'abcdef12-0000', replyId: 'fedcba98-0000', ok: false, error: 'outdated' });
    expect(got.some(m => m.type === 'openrig.asksChanged' && m.requestId === 'g3')).toBe(false); // still pending
    server.set('unreachable');
    client.send({ type: 'openrig.goal.send', requestId: 'g5', machineId: 'server', goalId: 'abcdef12-0001', text: 'z' });
    expect(goals().at(-1)).toEqual({ type: 'openrig.goal.sent', requestId: 'g5', machineId: 'server', goalId: 'abcdef12-0001', ok: false, error: 'offline' });
  });
  it('a write already sent whose machine drops is uncertain, never offline; a read stays offline; a write refused before sending is offline', () => {
    const { client, server, got } = setup();
    client.send({ type: 'openrig.goal.send', requestId: 'w1', machineId: 'server', goalId: 'abcdef12-0000', text: 'x' });
    client.send({ type: 'openrig.goal.reply', requestId: 'w2', machineId: 'server', goalId: 'abcdef12-0000', replyId: 'fedcba98-0000', text: 'y' });
    client.send({ type: 'openrig.answer', requestId: 'w3', machineId: 'server', qitemId: 'q1', answer: { kind: 'seen' } });
    client.send({ type: 'openrig.goals', requestId: 'w4', machineId: 'server' });
    server.set('unreachable');
    const end = (id: string) => got.find(m => 'requestId' in m && m.requestId === id);
    expect(end('w1')).toMatchObject({ type: 'openrig.goal.sent', goalId: 'abcdef12-0000', ok: false, error: 'uncertain' });
    expect(end('w2')).toMatchObject({ type: 'openrig.goal.replied', replyId: 'fedcba98-0000', ok: false, error: 'uncertain' });
    expect(end('w3')).toMatchObject({ type: 'openrig.answered', qitemId: 'q1', ok: false, error: 'uncertain' });
    expect(end('w4')).toMatchObject({ type: 'openrig.goalsChanged', error: 'offline' });
    client.send({ type: 'openrig.goal.send', requestId: 'w5', machineId: 'server', goalId: 'abcdef12-0001', text: 'z' });
    expect(end('w5')).toMatchObject({ ok: false, error: 'offline' });
  });
  it('routes roles, a role and a role file to their machine; an older daemon refuses only those, the others stay pending', () => {
    const { client, server, got } = setup();
    const roles = () => got.filter(m => m.type === 'openrig.roleList' || m.type === 'openrig.roleDetail' || m.type === 'openrig.roleFileContent' || m.type === 'openrig.state');
    client.send({ type: 'openrig.roles', requestId: 'o1', machineId: 'server' });
    client.send({ type: 'openrig.role', requestId: 'o2', machineId: 'server', roleId: 'f95e' });
    expect(server.sent).toEqual([{ type: 'openrig.roles', requestId: 'o1' }, { type: 'openrig.role', requestId: 'o2', roleId: 'f95e' }]);
    server.emit({ type: 'openrig.roleList', requestId: 'o1', roles: [] });
    server.emit({ type: 'openrig.roleList', requestId: 'o1', roles: [] }); // once only
    server.emit({ type: 'openrig.roleDetail', requestId: 'o2', roleId: 'f95e', error: 'role_not_found' });
    expect(roles()).toEqual([
      { type: 'openrig.roleList', requestId: 'o1', machineId: 'server', roles: [] },
      { type: 'openrig.roleDetail', requestId: 'o2', machineId: 'server', roleId: 'f95e', error: 'role_not_found' }
    ]);
    // A daemon that drives OpenRig but predates roles: the roles asks are outdated, its pending status is not.
    client.send({ type: 'openrig.status', requestId: 'o3', machineId: 'server' });
    client.send({ type: 'openrig.roleFile', requestId: 'o4', machineId: 'server', roleId: 'f95e', path: '/a/role.md' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.roleFile' });
    expect(roles().at(-1)).toEqual({ type: 'openrig.roleFileContent', requestId: 'o4', machineId: 'server', roleId: 'f95e', path: '/a/role.md', error: 'outdated' });
    const state = { installed: true, daemon: { state: 'running' as const }, kernel: { state: 'ready' as const }, rigs: [], at: 'now' };
    server.emit({ type: 'openrig.state', requestId: 'o3', state });
    expect(roles().at(-1)).toEqual({ type: 'openrig.state', requestId: 'o3', machineId: 'server', state });
    server.set('unreachable');
    client.send({ type: 'openrig.role', requestId: 'o5', machineId: 'server', roleId: 'f95e' });
    expect(roles().at(-1)).toEqual({ type: 'openrig.roleDetail', requestId: 'o5', machineId: 'server', roleId: 'f95e', error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes a role duplicate to its machine; an older daemon answers outdated, a machine that drops mid-write answers uncertain, an offline one offline', () => {
    const { client, server, got } = setup();
    const dup = () => got.filter(m => m.type === 'openrig.roleDuplicated');
    client.send({ type: 'openrig.role.duplicate', requestId: 'd1', machineId: 'server', roleId: 'f95e', name: 'mine' });
    expect(server.sent).toEqual([{ type: 'openrig.role.duplicate', requestId: 'd1', roleId: 'f95e', name: 'mine' }]);
    server.emit({ type: 'openrig.roleDuplicated', requestId: 'd1', ok: true, roleId: 'abc1', path: '/h/.openrig/specs/mine' });
    server.emit({ type: 'openrig.roleDuplicated', requestId: 'd1', ok: true }); // once only
    expect(dup()).toEqual([{ type: 'openrig.roleDuplicated', requestId: 'd1', machineId: 'server', ok: true, roleId: 'abc1', path: '/h/.openrig/specs/mine' }]);
    client.send({ type: 'openrig.role.duplicate', requestId: 'd2', machineId: 'server', roleId: 'f95e', name: 'mine2' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.role.duplicate' });
    expect(dup().at(-1)).toEqual({ type: 'openrig.roleDuplicated', requestId: 'd2', machineId: 'server', ok: false, error: 'outdated' });
    client.send({ type: 'openrig.role.duplicate', requestId: 'd3', machineId: 'server', roleId: 'f95e', name: 'mine3' });
    server.set('unreachable');
    expect(dup().at(-1)).toEqual({ type: 'openrig.roleDuplicated', requestId: 'd3', machineId: 'server', ok: false, error: 'uncertain' });
    client.send({ type: 'openrig.role.duplicate', requestId: 'd4', machineId: 'server', roleId: 'f95e', name: 'mine4' });
    expect(dup().at(-1)).toEqual({ type: 'openrig.roleDuplicated', requestId: 'd4', machineId: 'server', ok: false, error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  describe('a daemon without openrigRig (lot 7a)', () => {
    const old = { type: 'snapshot', sessions: [], daemon: { version: '0.4.0', install: 'npm', systemd: true, openrig: true } } as ServerMessage;
    const gated: ClientMessage[] = [
      { type: 'openrig.graph', requestId: 'x1', machineId: 'server', rig: 'a' },
      { type: 'openrig.snapshots', requestId: 'x2', machineId: 'server', rig: 'a' },
      { type: 'openrig.permissions', requestId: 'x3', machineId: 'server', rig: 'a' },
      { type: 'openrig.queue', requestId: 'x4', machineId: 'server', rig: 'a' },
      { type: 'openrig.role.duplicate', requestId: 'x5', machineId: 'server', roleId: 'f95e', name: 'mine' },
      { type: 'openrig.act', requestId: 'x6', machineId: 'server', action: { kind: 'rig.snapshot', rig: 'a' } },
      { type: 'openrig.act', requestId: 'x7', machineId: 'server', action: { kind: 'rig.permissions', rig: 'a', mode: 'auto', seats: ['s'] } as never },
      { type: 'openrig.act', requestId: 'x8', machineId: 'server', action: { kind: 'rig.start', rig: 'a', snapshot: 'snap-1' } as never },
    ];
    it('answers each gated message outdated without sending it, for the remote machine and the local one', () => {
      const { client, local, server, got } = setup();
      server.emit({ ...old, sshAlias: remote.ssh } as ServerMessage); local.emit(old);
      server.sent.length = 0; local.sent.length = 0;
      for (const m of gated) client.send(m);
      for (const m of gated) client.send({ ...m, requestId: `${(m as { requestId: string }).requestId}l`, machineId: undefined } as ClientMessage);
      expect(server.sent).toEqual([]); expect(local.sent).toEqual([]);
      const answers = got.filter(m => m.type.startsWith('openrig.') && 'error' in m);
      expect(answers).toHaveLength(16);
      expect(answers.every(m => (m as { error?: string }).error === 'outdated')).toBe(true);
      expect(answers.find(m => (m as { requestId?: string }).requestId === 'x6')).toEqual({ type: 'openrig.done', requestId: 'x6', machineId: 'server', ok: false, commands: [], error: 'outdated' });
      expect(answers.find(m => (m as { requestId?: string }).requestId === 'x8l')).toEqual({ type: 'openrig.done', requestId: 'x8l', machineId: 'local', ok: false, commands: [], error: 'outdated' });
    });
    it('still sends what it knows (status poll, a plain rig.start, other actions) and fails no pending ask', () => {
      const { client, server, got } = setup();
      server.emit({ ...old, sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
      client.send({ type: 'openrig.status', requestId: 'p1', machineId: 'server' });
      client.send({ type: 'openrig.act', requestId: 'p2', machineId: 'server', action: { kind: 'rig.start', rig: 'a' } });
      client.send({ type: 'openrig.act', requestId: 'p3', machineId: 'server', action: { kind: 'rig.stop', rig: 'a', snapshot: true } });
      client.send({ type: 'openrig.graph', requestId: 'p4', machineId: 'server', rig: 'a' });
      expect(server.sent.map(m => (m as { requestId: string }).requestId)).toEqual(['p1', 'p2', 'p3']);
      expect(got.filter(m => 'error' in m)).toHaveLength(1); // p4 only
    });
    const policy = { type: 'openrig.act', requestId: 'y1', machineId: 'server', action: { kind: 'rig.policy', rig: 'a', policy: 'standard', seats: ['s@a'] } } as ClientMessage;
    it('rig.policy needs openrigPolicy: outdated, not sent, with openrigRig alone; sent with it', () => {
      const { client, server, got } = setup();
      const withRig = { type: 'snapshot', sessions: [], daemon: { version: '0.7.0', install: 'npm', systemd: true, openrig: true, openrigRig: true } } as ServerMessage;
      server.emit({ ...withRig, sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
      client.send(policy);
      expect(server.sent).toEqual([]);
      expect(got.at(-1)).toEqual({ type: 'openrig.done', requestId: 'y1', machineId: 'server', ok: false, commands: [], error: 'outdated' });
      server.emit({ ...withRig, daemon: { ...(withRig as { daemon: object }).daemon, openrigPolicy: true }, sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
      client.send({ ...policy, requestId: 'y2' } as ClientMessage);
      expect(server.sent.map(m => (m as { requestId: string }).requestId)).toEqual(['y2']);
    });
    it('rig.start with fresh needs openrigFresh: outdated, not sent, without it; sent with it; a plain rig.start is not gated', () => {
      const { client, server, got } = setup();
      const base = { type: 'snapshot', sessions: [], daemon: { version: '0.7.0', install: 'npm', systemd: true, openrig: true, openrigRig: true, openrigPolicy: true } } as ServerMessage;
      server.emit({ ...base, sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
      const fresh = { type: 'openrig.act', requestId: 'f1', machineId: 'server', action: { kind: 'rig.start', rig: 'a', fresh: ['dev.build'] } } as ClientMessage;
      client.send(fresh);
      expect(server.sent).toEqual([]);
      expect(got.at(-1)).toEqual({ type: 'openrig.done', requestId: 'f1', machineId: 'server', ok: false, commands: [], error: 'outdated' });
      client.send({ type: 'openrig.act', requestId: 'f0', machineId: 'server', action: { kind: 'rig.start', rig: 'a' } });
      expect(server.sent.map(m => (m as { requestId: string }).requestId)).toEqual(['f0']);
      server.emit({ ...base, daemon: { ...(base as { daemon: object }).daemon, openrigFresh: true }, sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
      client.send({ ...fresh, requestId: 'f2' } as ClientMessage);
      expect(server.sent.map(m => (m as { requestId: string }).requestId)).toEqual(['f2']);
    });
    it('sends them all when the daemon says openrigRig', () => {
      const { client, server } = setup();
      server.sent.length = 0;
      for (const m of gated) client.send(m);
      expect(server.sent).toHaveLength(8);
    });
    it('a refused role duplicate fails only the pending duplicates, not the roles asks', () => {
      const { client, server, got } = setup();
      client.send({ type: 'openrig.roles', requestId: 'r1', machineId: 'server' });
      client.send({ type: 'openrig.role', requestId: 'r2', machineId: 'server', roleId: 'f95e' });
      client.send({ type: 'openrig.role.duplicate', requestId: 'r3', machineId: 'server', roleId: 'f95e', name: 'mine' });
      server.emit({ type: 'error', message: 'invalid message', request: 'openrig.role.duplicate' });
      expect(got.filter(m => m.type.startsWith('openrig.role') && 'error' in m).map(m => (m as { requestId: string }).requestId)).toEqual(['r3']);
    });
  });
  it('routes a rig graph to its machine; an older daemon answers outdated, a machine that dropped offline', () => {
    const { client, server, got } = setup();
    const graphs = () => got.filter(m => m.type === 'openrig.graphState');
    const graph = { pods: [], seats: [], links: [] };
    client.send({ type: 'openrig.graph', requestId: 'g1', machineId: 'server', rig: 'kernel' });
    expect(server.sent).toEqual([{ type: 'openrig.graph', requestId: 'g1', rig: 'kernel' }]);
    server.emit({ type: 'openrig.graphState', requestId: 'g1', rig: 'kernel', graph });
    server.emit({ type: 'openrig.graphState', requestId: 'g1', rig: 'kernel', graph }); // once only
    expect(graphs()).toEqual([{ type: 'openrig.graphState', requestId: 'g1', machineId: 'server', rig: 'kernel', graph }]);
    client.send({ type: 'openrig.graph', requestId: 'g2', machineId: 'server', rig: 'kernel' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.graph' });
    expect(graphs().at(-1)).toEqual({ type: 'openrig.graphState', requestId: 'g2', machineId: 'server', rig: 'kernel', error: 'outdated' });
    server.set('unreachable');
    client.send({ type: 'openrig.graph', requestId: 'g3', machineId: 'server', rig: 'starter' });
    expect(graphs().at(-1)).toEqual({ type: 'openrig.graphState', requestId: 'g3', machineId: 'server', rig: 'starter', error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes a rig\'s snapshots to its machine; an older daemon answers outdated, a machine that dropped offline', () => {
    const { client, server, got } = setup();
    const lists = () => got.filter(m => m.type === 'openrig.snapshotList');
    const snapshots = [{ id: '01M6XTAV9KM2HVRS841K1FQ6RV', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:52:23' }];
    client.send({ type: 'openrig.snapshots', requestId: 'n1', machineId: 'server', rig: 'kernel' });
    expect(server.sent).toEqual([{ type: 'openrig.snapshots', requestId: 'n1', rig: 'kernel' }]);
    server.emit({ type: 'openrig.snapshotList', requestId: 'n1', rig: 'kernel', snapshots });
    server.emit({ type: 'openrig.snapshotList', requestId: 'n1', rig: 'kernel', snapshots }); // once only
    expect(lists()).toEqual([{ type: 'openrig.snapshotList', requestId: 'n1', machineId: 'server', rig: 'kernel', snapshots }]);
    client.send({ type: 'openrig.snapshots', requestId: 'n2', machineId: 'server', rig: 'kernel' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.snapshots' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.snapshotList', requestId: 'n2', machineId: 'server', rig: 'kernel', snapshots: [], error: 'outdated' });
    server.set('unreachable');
    client.send({ type: 'openrig.snapshots', requestId: 'n3', machineId: 'server', rig: 'starter' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.snapshotList', requestId: 'n3', machineId: 'server', rig: 'starter', snapshots: [], error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes a rig\'s permissions to its machine; an older daemon answers outdated, a machine that dropped offline', () => {
    const { client, server, got } = setup();
    const lists = () => got.filter(m => m.type === 'openrig.permissionList');
    const seats = [{ logicalId: 'advisor.lead', session: 'advisor-lead@kernel', mode: 'acceptEdits', source: 'kernel_default', posture: 'floor', selection: 'inherit', summary: 's' }];
    client.send({ type: 'openrig.permissions', requestId: 'p1', machineId: 'server', rig: 'kernel' });
    expect(server.sent).toEqual([{ type: 'openrig.permissions', requestId: 'p1', rig: 'kernel' }]);
    server.emit({ type: 'openrig.permissionList', requestId: 'p1', rig: 'kernel', policy: 'builtin:auto', seats });
    server.emit({ type: 'openrig.permissionList', requestId: 'p1', rig: 'kernel', seats }); // once only
    expect(lists()).toEqual([{ type: 'openrig.permissionList', requestId: 'p1', machineId: 'server', rig: 'kernel', policy: 'builtin:auto', seats }]);
    client.send({ type: 'openrig.permissions', requestId: 'p2', machineId: 'server', rig: 'kernel' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.permissions' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.permissionList', requestId: 'p2', machineId: 'server', rig: 'kernel', seats: [], error: 'outdated' });
    server.set('unreachable');
    client.send({ type: 'openrig.permissions', requestId: 'p3', machineId: 'server', rig: 'starter' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.permissionList', requestId: 'p3', machineId: 'server', rig: 'starter', seats: [], error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('routes a rig\'s queue to its machine; an older daemon answers outdated, a machine that dropped offline', () => {
    const { client, server, got } = setup();
    const lists = () => got.filter(m => m.type === 'openrig.queueState');
    const rows = [{ id: 'qitem-1', state: 'pending', from: 'a@kernel', to: 'dev-build@x', createdAt: 'a', updatedAt: 'b', at: 'c', needsInput: { count: 1, reason: 'permission_prompt' } }];
    client.send({ type: 'openrig.queue', requestId: 'q1', machineId: 'server', rig: 'x' });
    expect(server.sent).toEqual([{ type: 'openrig.queue', requestId: 'q1', rig: 'x' }]);
    server.emit({ type: 'openrig.queueState', requestId: 'q1', rig: 'x', rows, truncated: false });
    server.emit({ type: 'openrig.queueState', requestId: 'q1', rig: 'x', rows: [], truncated: false }); // once only
    expect(lists()).toEqual([{ type: 'openrig.queueState', requestId: 'q1', machineId: 'server', rig: 'x', rows, truncated: false }]);
    client.send({ type: 'openrig.queue', requestId: 'q2', machineId: 'server', rig: 'x' });
    server.emit({ type: 'error', message: 'invalid message', request: 'openrig.queue' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.queueState', requestId: 'q2', machineId: 'server', rig: 'x', rows: [], truncated: false, error: 'outdated' });
    server.set('unreachable');
    client.send({ type: 'openrig.queue', requestId: 'q3', machineId: 'server', rig: 'y' });
    expect(lists().at(-1)).toEqual({ type: 'openrig.queueState', requestId: 'q3', machineId: 'server', rig: 'y', rows: [], truncated: false, error: 'offline' });
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('answers a repos.scan for an offline machine, and one pending on a machine that drops, with error offline', () => {
    const { client, server, got } = setup();
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    server.set('unreachable');
    client.send({ type: 'repos.scan', requestId: 's2', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's3', machineId: 'nowhere' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([
      { type: 'repos.found', requestId: 's1', repos: [], truncated: false, error: 'offline' },
      { type: 'repos.found', requestId: 's2', repos: [], truncated: false, error: 'offline' },
      { type: 'repos.found', requestId: 's3', repos: [], truncated: false, error: 'offline' }
    ]);
    expect(server.sent).toEqual([{ type: 'repos.scan', requestId: 's1' }]);
    expect(got.filter(m => m.type === 'error')).toEqual([]);
  });
  it('an older daemon refusing repos.scan answers error outdated, leaving inspections, listings and another machine\'s scan pending', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'repos.scan', requestId: 's1', machineId: 'server' });
    client.send({ type: 'repos.scan', requestId: 's2' });
    client.send({ type: 'repos.inspect', requestId: 'r1', paths: ['/a'], machineId: 'server' });
    client.send({ type: 'folder.list', path: '/w', machineId: 'server', requestId: 'f1' });
    server.emit({ type: 'error', message: 'invalid message', request: 'repos.scan' });
    expect(got.filter(m => m.type === 'repos.found')).toEqual([{ type: 'repos.found', requestId: 's1', repos: [], truncated: false, error: 'outdated' }]);
    expect(got.filter(m => m.type === 'error' || m.type === 'repos.info' || m.type === 'folder.listing')).toEqual([]);
    server.emit({ type: 'repos.found', requestId: 's1', repos: [], truncated: false }); // no longer pending
    local.emit({ type: 'repos.found', requestId: 's2', repos: [], truncated: false });
    expect(got.filter(m => m.type === 'repos.found').map(m => m.type === 'repos.found' && m.requestId)).toEqual(['s1', 's2']);
    server.set('unreachable'); // the inspection and the listing were still pending
    expect(got.filter(m => m.type === 'repos.found')).toHaveLength(2);
    expect(got.filter(m => m.type === 'repos.info' || m.type === 'folder.listing')).toHaveLength(2);
  });
  it('an unrelated error from a machine keeps its launch in flight: a later drop still refuses the launch', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.emit({ type: 'error', id: 'same', message: 'not waiting', request: 'session.decide' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error').at(-1)).toEqual({ type: 'error', message: 'dev-server is offline', request: 'session.launch' });
  });
  it('the launch\'s own refusal ends it: a later drop says nothing more of it', () => {
    const { client, server, got } = setup();
    client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
    server.emit({ type: 'error', message: 'no such folder', request: 'session.launch' });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server: no such folder', request: 'session.launch' }]);
  });
  it('validates loopback connections, aliases and duplicate destinations', () => {
    // The url is never read: a non-loopback local url is replaced by the pinned one, a remote url is dropped.
    expect(parseMachines([{ ...LOCAL_MACHINE, url: 'ws://example.org:47831' }])[0]!.url).toBe(LOCAL_MACHINE.url);
    expect(parseMachines([LOCAL_MACHINE, { ...remote, url: 'ws://example.org:47831' }])[1]!.url).toBeUndefined();
    expect(parseMachines([{ id: 'local', label: 'Local' }])[0]!.url).toBe(LOCAL_MACHINE.url);
    expect(() => parseMachines([{ ...LOCAL_MACHINE, ssh: 'x' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, { id: 'a', label: 'A' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, { ...remote, ssh: '-oProxyCommand=evil' }])).toThrow();
    expect(() => parseMachines([LOCAL_MACHINE, remote, { ...remote, id: 'duplicate-alias' }])).toThrow();
    expect(parseMachines([LOCAL_MACHINE, remote])).toHaveLength(2);
  });
});

describe('common chat routing', () => {
  it('asks for clarification without launching or asking either target', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance les tests' });
    expect(local.sent[0]).toMatchObject({ type: 'chat.route', context: { machines: [expect.objectContaining({ id: 'local' }), expect.objectContaining({ id: 'server' })] } });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: null, text: 'Sur quelle machine ?', choices: ['local', 'server'] } });
    expect(lastHistory(got)[0]).toMatchObject({ answer: 'Sur quelle machine ?', choices: [{ id: 'local', label: 'Local' }, { id: 'server', label: 'dev-server' }] });
    expect(server.sent).toEqual([]); expect(local.sent).toHaveLength(1);
  });
  it('keeps proposal ownership, history and confirmation separate from routing', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance sur le serveur' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance une session dans /w/repo' } });
    expect(server.sent).toEqual([{ type: 'chat.ask', qid: 'q', text: 'Lance une session dans /w/repo', tool: undefined }]);
    server.emit({ type: 'chat.done', qid: 'q', text: 'Confirmer ?', at: new Date().toISOString(), proposal: { cwd: '/w/repo', project: 'repo', tool: 'claude' } });
    expect(lastHistory(got)[0]).toMatchObject({ question: 'Lance sur le serveur', machineId: 'server', proposal: { cwd: '/w/repo' } });
    client.fleet!.select('local');
    client.send({ type: 'session.launch', cwd: '/w/repo', tool: 'claude', qid: 'q' });
    expect(server.sent.at(-1)).toMatchObject({ type: 'session.launch', qid: 'q' });
    expect(local.sent).toHaveLength(1);
    server.set('unreachable');
    expect(got.at(-2)).toMatchObject({ type: 'error' });
  });
  it('keeps every row of a session card and qualifies the launched ones (#24)', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance a et b sur le serveur' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance a et b' } });
    const a = { cwd: '/w/a', project: 'a', tool: 'claude' as const }, b = { cwd: '/w/b', project: 'b', tool: 'claude' as const };
    server.emit({ type: 'chat.done', qid: 'q', text: 'Deux sessions.', at: new Date().toISOString(), proposal: a, proposals: [a, b] });
    expect(lastHistory(got)[0]).toMatchObject({ proposal: a, proposals: [a, b] });
    server.emit({ type: 'chat.history', turns: [{ qid: 'q', question: 'Lance a et b', askedAt: new Date().toISOString(), steps: [], answer: 'Deux sessions.', answeredAt: new Date().toISOString(), proposal: a, proposals: [a, { ...b, launchedId: 'n2' }] }] });
    expect(lastHistory(got)[0]!.proposals![1]).toMatchObject({ launchedId: 'server:n2' });
    client.send({ type: 'session.launch', cwd: '/w/a', tool: 'claude', qid: 'q', rows: [0, 1] });
    expect(server.sent.at(-1)).toMatchObject({ type: 'session.launch', qid: 'q', rows: [0, 1] });
  });
  describe('generic card', () => {
    const at = new Date().toISOString();
    const rows = (over: Record<string, unknown> = {}) => [{ action: 'session.interrupt', args: { session: 'a1' }, summary: 'Interrompre **bot1**', vars: { session: 'bot1' }, risk: 'reversible' as const, session: 'a1', ...over }];
    function routed() {
      const s = setup();
      s.client.send({ type: 'chat.ask', qid: 'q', text: 'Interromps bot1 sur le serveur' });
      s.local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Interromps bot1' } });
      return s;
    }
    it('keeps the rows of a remote chat.done, their session qualified, and in the history', () => {
      const { server, got } = routed();
      server.emit({ type: 'chat.done', qid: 'q', text: 'Une.', at, actions: rows() });
      expect(lastHistory(got)[0]!.actions).toEqual([{ ...rows()[0], session: 'server:a1' }]);
      server.emit({ type: 'chat.history', turns: [{ qid: 'q', question: 'Interromps', askedAt: at, steps: [], answer: 'Une.', answeredAt: at, actions: rows({ state: 'done', doneAt: at }) }] });
      expect(lastHistory(got)[0]!.actions![0]).toMatchObject({ session: 'server:a1', state: 'done' });
    });
    it('routes chat.act and chat.ignore to the turn\'s machine, and relays chat.acted under the overlay\'s qid', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.done', qid: 'q', text: 'Une.', at, actions: rows() });
      client.send({ type: 'chat.act', rid: 'r1', qid: 'q' });
      expect(server.sent.at(-1)).toEqual({ type: 'chat.act', rid: 'r1', qid: 'q' });
      client.send({ type: 'chat.ignore', qid: 'q' });
      expect(server.sent.at(-1)).toEqual({ type: 'chat.ignore', qid: 'q' });
      server.emit({ type: 'chat.acted', rid: 'r1', qid: 'q', done: [0], failed: [] });
      expect(got.at(-1)).toEqual({ type: 'chat.acted', rid: 'r1', qid: 'q', done: [0], failed: [] });
    });
  });
  describe('close card', () => {
    const at = new Date().toISOString();
    const closes = (over: Array<Record<string, unknown>> = [{}, {}]) => over.map((o, i) => ({ id: `a${i + 1}`, name: `bot${i + 1}`, tool: 'claude' as const, ...o }));
    const turn = (cs: ReturnType<typeof closes>) => ({ qid: 'q', question: 'Ferme-les', askedAt: at, steps: [], answer: 'Deux.', answeredAt: at, closes: cs });
    function routed() {
      const s = setup();
      s.client.send({ type: 'chat.ask', qid: 'q', text: 'Ferme-les sur le serveur' });
      s.local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Ferme-les' } });
      return s;
    }
    const drops = (got: ServerMessage[]) => got.filter(m => m.type === 'error' && m.message === 'dev-server is offline');
    it('qualifies the close rows of a remote turn, in the history and through chat.done', () => {
      const { server, got } = routed();
      server.emit({ type: 'chat.done', qid: 'q', text: 'Deux.', at, closes: closes() });
      expect(lastHistory(got)[0]!.closes!.map(c => c.id)).toEqual(['server:a1', 'server:a2']);
      server.emit({ type: 'chat.history', turns: [turn(closes([{ closedAt: at, how: 'exit' }, {}]))] });
      expect(lastHistory(got)[0]!.closes![0]).toMatchObject({ id: 'server:a1', how: 'exit' });
    });
    it('relays session.closed qualified, without ending anything else', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q' });
      expect(server.sent.at(-1)).toEqual({ type: 'session.close', qid: 'q' });
      server.emit({ type: 'session.closed', qid: 'q', row: 0, id: 'a1', how: 'exit' });
      expect(got.filter(m => m.type === 'session.closed')).toEqual([{ type: 'session.closed', qid: lastHistory(got)[0]!.qid, row: 0, id: 'server:a1', how: 'exit' }]);
      server.set('unreachable');
      expect(drops(got)).toHaveLength(1);
    });
    it('holds a close operation until every requested row is settled', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes([{}, { error: 'old failure' }]))] });
      client.send({ type: 'session.close', qid: 'q', rows: [0, 1] });
      server.emit({ type: 'chat.history', turns: [turn(closes([{ closedAt: at, how: 'exit' }, { error: 'old failure' }]))] });
      server.set('unreachable'); // row 1's error did not change since the send: still held
      expect(drops(got)).toHaveLength(1);
    });
    it('a launch on the same machine supersedes the close: a drop names the launch', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q' });
      client.send({ type: 'session.launch', tool: 'claude', cwd: '/w/a', machineId: 'server' });
      server.emit({ type: 'chat.history', turns: [turn(closes([{ closedAt: at, how: 'exit' }, { closedAt: at, how: 'exit' }]))] }); // the old close's rows settling must not end the launch
      server.set('unreachable');
      expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.launch' }]);
    });
    it('does not hold a close operation for a turn without closes', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [{ ...turn(closes()), closes: undefined }] });
      client.send({ type: 'session.close', qid: 'q' });
      expect(server.sent.at(-1)).toEqual({ type: 'session.close', qid: 'q' });
      server.set('unreachable');
      expect(got.filter(m => m.type === 'error')).toEqual([]);
    });
    it('sends the raw qid of a turn whose global qid differs', () => {
      const { client, local, server, got } = setup();
      client.send({ type: 'chat.ask', qid: 'q', text: 'Ferme-les' });
      local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'local', text: 'Ferme-les' } });
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      const remoteQid = lastHistory(got).find(t => t.machineId === 'server')!.qid;
      expect(remoteQid).not.toBe('q');
      client.send({ type: 'session.close', qid: remoteQid });
      expect(server.sent.at(-1)).toEqual({ type: 'session.close', qid: 'q' });
      expect(local.sent.some(m => m.type === 'session.close')).toBe(false);
    });
    it('without rows, waits for every row', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q' });
      server.emit({ type: 'chat.history', turns: [turn(closes([{ closedAt: at, how: 'exit' }, {}]))] });
      server.set('unreachable');
      expect(drops(got)).toHaveLength(1);
    });
    it('a row refused with a new error settles the operation', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes([{}, { error: 'old failure' }]))] });
      client.send({ type: 'session.close', qid: 'q', rows: [0, 1] });
      server.emit({ type: 'chat.history', turns: [turn(closes([{ closedAt: at, how: 'exit' }, { error: 'new failure' }]))] });
      server.set('unreachable');
      expect(drops(got)).toHaveLength(0);
    });
    it('settles only the requested rows', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q', rows: [1] });
      server.emit({ type: 'chat.history', turns: [turn(closes([{}, { closedAt: at, how: 'killed' }]))] });
      server.set('unreachable');
      expect(drops(got)).toHaveLength(0);
    });
    it('ends a close operation on its error and on the machine\'s drop', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q' });
      server.emit({ type: 'error', message: 'unknown turn', request: 'session.close' });
      server.set('unreachable');
      expect(drops(got)).toHaveLength(0);
    });
    it('refuses a close in flight when the machine drops, naming the request', () => {
      const { client, server, got } = routed();
      server.emit({ type: 'chat.history', turns: [turn(closes())] });
      client.send({ type: 'session.close', qid: 'q' });
      server.set('unreachable');
      expect(got.filter(m => m.type === 'error')).toEqual([{ type: 'error', message: 'dev-server is offline', request: 'session.close' }]);
    });
  });
  it('keeps a project proposal on the routed turn, with its machine (lot 11 task 5)', () => {
    const { client, local, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Crée un projet Paper' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'local', text: 'Crée un projet Paper' } });
    const projectProposal = { name: 'Paper', repos: [{ path: '/w/paper', why: 'Nommé paper' }] };
    local.emit({ type: 'chat.done', qid: 'q', text: 'Je propose Paper.', at: new Date().toISOString(), projectProposal });
    expect(lastHistory(got)[0]).toMatchObject({ machineId: 'local', projectProposal });
  });
  it('a reply to an offline machine says which request it refuses', () => {
    const { client, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'session.reply', id: 'server:same', text: 'Go' });
    expect(got.at(-1)).toEqual({ type: 'error', id: 'server:same', message: 'dev-server is offline', request: 'session.reply' });
  });
  it('refuses an offline routed destination even while the coordinator stays online', () => {
    const { client, local, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'chat.ask', qid: 'q', text: 'Sur serveur' });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance' } });
    expect(lastHistory(got)[0]?.error).toContain('offline');
    expect(local.sent).toHaveLength(1); expect(server.sent).toEqual([]);
  });
});

class FakeProbe {
  static last: FakeProbe; url: string; protocols?: string[]; closed = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onopen: (() => void) | null = null;
  constructor(url: string, protocols?: string[]) { this.url = url; this.protocols = protocols; FakeProbe.last = this; }
  close() { this.closed = true; }
  emit(m: ServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const probeSnapshot = (sshAlias?: string): ServerMessage => ({ type: 'snapshot', sessions: [fakeSession('a'), fakeSession('b')], daemon: { version: '0.4.1', install: 'npm', systemd: true, routing: true }, sshAlias });

describe('connection test', () => {
  it('probe presents the token', async () => {
    const T = 'a'.repeat(64);
    vi.stubGlobal('WebSocket', FakeProbe);
    try {
      const fleet = createFleetClient([LOCAL_MACHINE], () => peer().client, { token: createTokenSource(async () => ({ kind: 'token', token: T })) }).fleet!;
      const done = fleet.probe('dev-server');
      await vi.waitFor(() => expect(FakeProbe.last?.url).toBe('ws://127.0.0.1:47831/ssh/dev-server'));
      expect(FakeProbe.last.protocols).toEqual([`ledge.${T}`]);
      FakeProbe.last.emit(probeSnapshot('dev-server'));
      await expect(done).resolves.toEqual({ ok: true, version: '0.4.1', sessions: 2 });
    } finally { vi.unstubAllGlobals(); }
  });
  it('a probe without the token opens nothing and says why', async () => {
    const before = FakeProbe.last;
    const absent = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, token: createTokenSource(async () => ({ kind: 'absent' })) });
    await expect(absent).resolves.toEqual({ ok: false, error: expect.stringContaining('token') });
    const unavailable = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, token: createTokenSource(async () => ({ kind: 'unavailable' })) });
    await expect(unavailable).resolves.toEqual({ ok: false, error: expect.stringContaining('token') });
    expect(FakeProbe.last).toBe(before);
  });
  it('a probe that never opened re-reads the token next time; one that opened does not', async () => {
    const read = vi.fn(async (): Promise<TokenRead> => ({ kind: 'token', token: 'a'.repeat(64) }));
    const token = createTokenSource(read);
    const before = FakeProbe.last;
    const refused = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, token });
    await vi.waitFor(() => expect(FakeProbe.last).not.toBe(before));
    FakeProbe.last.onclose?.();
    await refused;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    const second = FakeProbe.last;
    const opened = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, token });
    await vi.waitFor(() => expect(FakeProbe.last).not.toBe(second));
    FakeProbe.last.onopen?.(); FakeProbe.last.onclose?.();
    await opened;
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('opens the SSH route of the local daemon and answers with the remote version and sessions', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'dev-server', { WebSocketImpl: FakeProbe });
    expect(FakeProbe.last.url).toBe('ws://127.0.0.1:47831/ssh/dev-server');
    FakeProbe.last.emit(probeSnapshot('dev-server'));
    await expect(done).resolves.toEqual({ ok: true, version: '0.4.1', sessions: 2 });
    expect(FakeProbe.last.closed).toBe(true);
  });
  it('reports the SSH error that preceded the close', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe });
    FakeProbe.last.emit({ type: 'error', message: 'ssh: Could not resolve hostname box' });
    FakeProbe.last.onclose?.();
    await expect(done).resolves.toEqual({ ok: false, error: 'ssh: Could not resolve hostname box' });
  });
  it('refuses a snapshot from an old local daemon that ignores the SSH route', async () => {
    const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe });
    FakeProbe.last.emit(probeSnapshot());
    const r = await done;
    expect(r.ok).toBe(false);
    expect(!r.ok && sshProblem(r.error)).toBe('local');
  });
  it('gives up when nothing answers', async () => {
    vi.useFakeTimers();
    try {
      const done = probeMachine('ws://127.0.0.1:47831', 'box', { WebSocketImpl: FakeProbe, timeoutMs: 1000 });
      vi.advanceTimersByTime(1000);
      const r = await done;
      expect(r).toEqual({ ok: false, error: 'SSH: no Ledge snapshot received.' });
      expect(FakeProbe.last.closed).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ['ssh: Could not resolve hostname box: Name or service not known', 'alias'],
    ['agent@host: Permission denied (publickey).', 'key'],
    ['Host key verification failed.', 'hostKey'],
    ['ssh: connect to host box port 22: Connection timed out', 'unreachable'],
    ['bash: line 1: ledge: command not found', 'ledge'],
    ['connect ECONNREFUSED 127.0.0.1:47831', 'stopped'],
    ['Update the local Ledge daemon: SSH transport is unavailable', 'local'],
    ['The local Ledge daemon token is missing: start or update the daemon.', 'local'],
    ['something odd', 'other'],
  ] as const)('explains %s as %s', (raw, kind) => { expect(sshProblem(raw)).toBe(kind); });
});

describe('session traffic through the fleet', () => {
  it('relays a session update, a removal and the recents as themselves, never as a fresh snapshot', () => {
    const { client, got, local, server } = setup();
    const before = got.filter(m => m.type === 'snapshot').length;
    local.emit({ type: 'session.updated', session: fakeSession('same', { state: 'idle' }) });
    server.emit({ type: 'session.updated', session: fakeSession('other', { name: 'Pim' }) });
    local.emit({ type: 'recents', recents: [{ cwd: '/w/x', project: 'x', lastAt: '2026-10-09T18:00:00.000Z' }] });
    server.emit({ type: 'recents', recents: [] }); // not the selected machine: its recents stay out of the list
    server.emit({ type: 'session.removed', id: 'other' });
    expect(got.filter(m => m.type === 'snapshot').length).toBe(before);
    expect(got.slice(-4)).toEqual([
      { type: 'session.updated', session: expect.objectContaining({ id: 'local:same', state: 'idle', machineId: 'local' }) },
      { type: 'session.updated', session: expect.objectContaining({ id: 'server:other', name: 'Pim', machineId: 'server' }) },
      { type: 'recents', recents: [{ cwd: '/w/x', project: 'x', lastAt: '2026-10-09T18:00:00.000Z' }] },
      { type: 'session.removed', id: 'server:other' }
    ]);
    // The fleet's own inventory followed anyway.
    expect(client.fleet!.machines().find(m => m.id === 'server')!.sessions.map(s => s.id)).toEqual(['same']);
    expect(client.fleet!.machines().find(m => m.id === 'local')!.sessions[0]).toMatchObject({ state: 'idle' });
    expect(client.fleet!.machines().find(m => m.id === 'local')!.recents).toHaveLength(1);
  });
  it('a peer without a snapshot yet keeps its updates to itself until its snapshot publishes them', () => {
    const { got, extra } = setup();
    const n = got.length;
    extra.emit({ type: 'session.updated', session: fakeSession('early') });
    expect(got.length).toBe(n);
  });
});

describe('updating a remote daemon', () => {
  it('sends to one machine only, and not to a machine that is not connected', () => {
    const { client, local, server } = setup();
    expect(client.fleet!.sendTo('server', { type: 'update.daemon', version: '0.5.0' })).toBe(true);
    expect(server.sent).toEqual([{ type: 'update.daemon', version: '0.5.0' }]); expect(local.sent).toEqual([]);
    server.set('unreachable');
    expect(client.fleet!.sendTo('server', { type: 'update.daemon', version: '0.5.0' })).toBe(false);
  });
  it('gives each daemon message with its machine, and the daemon info with the machine', () => {
    const { client, server } = setup();
    const seen: Array<[string, string]> = []; client.fleet!.onMachineMessage((machine, m) => seen.push([machine, m.type]));
    server.emit({ type: 'update.progress', version: '0.5.0', step: 'installing' });
    expect(seen).toEqual([['server', 'update.progress']]);
    expect(client.fleet!.machines().find(m => m.id === 'server')?.daemon).toMatchObject({ version: '0.4.0', install: 'npm' });
  });
  it('keeps quiet about the SSH bridge closing while the remote daemon restarts', () => {
    const { got, server, snapshot } = setup();
    server.emit({ type: 'update.progress', version: '0.5.0', step: 'restarting' });
    server.emit({ type: 'error', message: 'SSH connection closed (1). Ledge daemon disconnected (1001)' });
    server.set('connecting'); server.set('open'); server.emit({ ...snapshot, sshAlias: remote.ssh });
    server.emit({ type: 'error', message: 'later failure' });
    expect(got.filter(m => m.type === 'error').map(m => (m as { message: string }).message)).toEqual(['dev-server: later failure']);
  });
});

describe('archived sessions', () => {
  const archivedAt = '2026-10-09T19:00:00.000Z';
  it('a remote archived session is qualified like any other', () => {
    const { client, server, snapshot } = setup();
    daemonStore.reset(); const detach = attachClient(client);
    server.emit({ ...snapshot, sessions: [fakeSession('old', { archivedAt }), fakeSession('live')], sshAlias: remote.ssh });
    expect(daemonStore.getState().archived.map(s => s.id)).toEqual(['server:old']);
    expect(daemonStore.getState().sessions.map(s => s.id)).not.toContain('server:old');
    detach();
  });
  it('a machine counts only its live sessions', () => {
    const { client, server, snapshot } = setup();
    server.emit({ ...snapshot, sessions: [fakeSession('old', { archivedAt }), fakeSession('live')], sshAlias: remote.ssh });
    expect(client.fleet!.machines().find(m => m.id === 'server')!.sessions.map(s => s.id)).toEqual(['live']);
  });
  it('canManage follows daemon.archive', () => {
    expect(canManage({ daemon: { version: '1', install: 'npm', systemd: true, archive: true } })).toBe(true);
    expect(canManage({ daemon: { version: '1', install: 'npm', systemd: true } })).toBe(false);
    expect(canManage({})).toBe(false);
  });
});

describe('attachments', () => {
  const image = { mime: 'image/png' as const, data: 'AAAA' };
  const ref = { id: 'a'.repeat(64), mime: 'image/png' as const, width: 1, height: 1, bytes: 4, preview: true };
  it('routes a put by its session id and only emits the answer of the machine asked', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'attachment.put', requestId: 'r1', id: 'server:s1', image });
    expect(server.sent).toEqual([{ type: 'attachment.put', requestId: 'r1', id: 's1', image }]);
    expect(local.sent).toEqual([]);
    local.emit({ type: 'attachment.stored', requestId: 'r1', ref });
    expect(got.filter(m => m.type === 'attachment.stored')).toEqual([]);
    server.emit({ type: 'attachment.stored', requestId: 'r1', ref });
    expect(got.filter(m => m.type === 'attachment.stored')).toEqual([{ type: 'attachment.stored', requestId: 'r1', ref }]);
    // answered once: the same answer again is dropped
    server.emit({ type: 'attachment.stored', requestId: 'r1', ref });
    expect(got.filter(m => m.type === 'attachment.stored')).toHaveLength(1);
  });
  it('routes a get by machine, without the machine field', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'attachment.get', requestId: 'g1', attachment: ref.id, machine: 'server' });
    expect(server.sent).toEqual([{ type: 'attachment.get', requestId: 'g1', attachment: ref.id }]);
    server.emit({ type: 'attachment.data', requestId: 'g1', attachment: ref.id, mime: 'image/png', data: 'AAAA' });
    expect(got.filter(m => m.type === 'attachment.data')).toHaveLength(1);
    expect(local.sent).toEqual([]);
  });
  it('sends a put or get without a route to the local machine, not the selected one', () => {
    const { client, local, server } = setup();
    client.fleet!.select('server');
    client.send({ type: 'attachment.put', requestId: 'r1', image });
    client.send({ type: 'attachment.get', requestId: 'g1', attachment: ref.id });
    expect(local.sent.map(m => m.type)).toEqual(['attachment.put', 'attachment.get']);
    expect(server.sent).toEqual([]);
  });
  it('answers « offline » and sends nothing when the target machine is not connected', () => {
    const { client, server, got } = setup();
    server.set('unreachable');
    client.send({ type: 'attachment.put', requestId: 'r1', id: 'server:s1', image });
    client.send({ type: 'attachment.get', requestId: 'g1', attachment: ref.id, machine: 'server' });
    expect(server.sent).toEqual([]);
    expect(got.filter(m => m.type === 'attachment.error')).toEqual([{ type: 'attachment.error', requestId: 'r1', reason: 'offline' }, { type: 'attachment.error', requestId: 'g1', reason: 'offline' }]);
  });
  it('answers « offline » for a pending ask when its machine drops, and forgets it', () => {
    const { client, server, got } = setup();
    client.send({ type: 'attachment.put', requestId: 'r1', id: 'server:s1', image });
    server.set('unreachable');
    expect(got.filter(m => m.type === 'attachment.error')).toEqual([{ type: 'attachment.error', requestId: 'r1', reason: 'offline' }]);
    server.emit({ type: 'attachment.stored', requestId: 'r1', ref });
    expect(got.filter(m => m.type === 'attachment.stored')).toEqual([]);
  });
  it('answers « offline » for an unqualified or unknown route instead of a generic error', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'attachment.put', requestId: 'r1', id: 's1', image });
    client.send({ type: 'attachment.get', requestId: 'g1', attachment: ref.id, machine: 'nowhere' });
    expect(got.filter(m => m.type === 'attachment.error')).toEqual([{ type: 'attachment.error', requestId: 'r1', reason: 'offline' }, { type: 'attachment.error', requestId: 'g1', reason: 'offline' }]);
    expect(got.some(m => m.type === 'error')).toBe(false);
    expect(local.sent).toEqual([]); expect(server.sent).toEqual([]);
  });
  it('keeps chat images out of chat.route and hands them to the routed machine', () => {
    const { client, local, server } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance sur le serveur', images: [image] });
    expect(local.sent[0]).toMatchObject({ type: 'chat.route' });
    expect(local.sent[0]).not.toHaveProperty('images');
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance' } });
    expect(server.sent).toEqual([{ type: 'chat.ask', qid: 'q', text: 'Lance', tool: undefined, images: [image] }]);
  });
  it('ends the turn when the routed machine refuses its images, and takes the next question', () => {
    const { client, local, server, got } = setup();
    client.send({ type: 'chat.ask', qid: 'q', text: 'Lance sur le serveur', images: [image] });
    local.emit({ type: 'chat.routed', qid: 'q', result: { machineId: 'server', text: 'Lance' } });
    server.emit({ type: 'chat.error', qid: 'q', message: 'image refused: too_large' });
    expect(lastHistory(got)[0]).toMatchObject({ qid: 'q', error: 'image refused: too_large' });
    client.send({ type: 'chat.ask', qid: 'q2', text: 'Autre' });
    expect(got.some(m => m.type === 'chat.error' && m.message === 'one question at a time')).toBe(false);
    expect(local.sent.at(-1)).toMatchObject({ type: 'chat.route', qid: 'q2' });
  });
});

describe('ping and useLatency (lot 7d)', () => {
  const withPing = (ping: boolean) => ({ type: 'snapshot', sessions: [], daemon: { version: '0.7.0', install: 'npm', systemd: true, ...(ping ? { ping: true } : {}) } }) as ServerMessage;
  it('answers a ping outdated without sending it to a daemon without ping; sends it with ping, and the pong comes back tagged with the machine', () => {
    const { client, server, got } = setup();
    server.emit({ ...withPing(false), sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
    client.send({ type: 'ping', requestId: 'g1', machineId: 'server' });
    expect(server.sent).toEqual([]);
    expect(got.at(-1)).toEqual({ type: 'pong', requestId: 'g1', machineId: 'server', error: 'outdated' });
    server.emit({ ...withPing(true), sshAlias: remote.ssh } as ServerMessage); server.sent.length = 0;
    client.send({ type: 'ping', requestId: 'g2', machineId: 'server' });
    expect(server.sent).toEqual([{ type: 'ping', requestId: 'g2' }]);
    server.emit({ type: 'pong', requestId: 'g2' });
    expect(got.at(-1)).toEqual({ type: 'pong', requestId: 'g2', machineId: 'server' });
    server.set('unreachable');
    client.send({ type: 'ping', requestId: 'g3', machineId: 'server' });
    expect(got.at(-1)).toEqual({ type: 'pong', requestId: 'g3', machineId: 'server', error: 'offline' });
  });
  it('useLatency measures the round trip per machine, one ping at a time, again every round; null without ping, never sending to that daemon', () => {
    vi.useFakeTimers();
    try {
      const { client, server, local } = setup();
      local.emit(withPing(true)); server.emit({ ...withPing(false), sshAlias: remote.ssh } as ServerMessage);
      local.sent.length = 0; server.sent.length = 0;
      const { result, unmount } = renderHook(() => useLatency(client, ['local', 'server'], 1000));
      expect(local.sent).toHaveLength(1);
      expect(server.sent).toEqual([]);
      expect(result.current.get('server')).toBeNull();
      expect(result.current.has('local')).toBe(false);
      act(() => { vi.advanceTimersByTime(40); });
      act(() => local.emit({ type: 'pong', requestId: (local.sent[0] as { requestId: string }).requestId }));
      expect(result.current.get('local')).toBe(40);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(local.sent).toHaveLength(2);
      // The round before is still unanswered at the next round: given up (null), and a stale pong changes nothing.
      act(() => { vi.advanceTimersByTime(1000); });
      expect(local.sent).toHaveLength(3);
      expect(result.current.get('local')).toBeNull();
      act(() => local.emit({ type: 'pong', requestId: (local.sent[1] as { requestId: string }).requestId }));
      expect(result.current.get('local')).toBeNull();
      unmount();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(local.sent).toHaveLength(3);
      expect(server.sent).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
