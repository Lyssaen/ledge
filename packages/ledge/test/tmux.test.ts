import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { realTmux, run } from '../src/tmux.js';
import { killTestServer, testSocketPath } from './helpers.js';
import { ensureLedgeDir } from '../src/paths.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const socket = `ledge-test-${process.pid}-${Date.now()}`;
const tmux = realTmux(socket, { scope: async () => false });
const name = 'ledge-t1';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir(); });
afterAll(async () => { await killTestServer(socket); });

describe('tmux', () => {
  it('creates a session running a command with env and cwd', async () => {
    await tmux.newSession({ name, cwd: '/tmp', env: { LEDGE_SESSION: 't1' }, command: ['sh', '-c', 'echo "LS=$LEDGE_SESSION PWD=$(pwd)"; cat'] });
    await sleep(300);
    expect(await tmux.hasSession(name)).toBe(true);
    expect(await tmux.listSessions()).toContain(name);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('LS=t1 PWD=/tmp');
  });
  it('gives a detached pane the PATH of its env (tmux hands it the client PATH otherwise)', async () => {
    const n = 'ledge-path';
    await tmux.newSession({ name: n, cwd: '/tmp', env: { PATH: '/ledge-test-first:/usr/bin:/bin' }, command: ['/bin/sh', '-c', 'echo "P=$PATH"; cat'] });
    await sleep(300);
    expect(await tmux.capture(n, 5)).toContain('P=/ledge-test-first:/usr/bin:/bin');
    await tmux.killSession(n);
  });
  it('sets a session option the terminal title can show', async () => {
    await tmux.setOption(name, '@ledge_title', 'Otto · x');
    expect((await run(['-L', socket, 'show-option', '-v', '-t', `=${name}:`, '@ledge_title'])).stdout.trim()).toBe('Otto · x');
  });
  it('sends text literally, then Enter separately', async () => {
    await tmux.sendText(name, '-n ; echo not-a-flag');
    await tmux.sendKeys(name, ['Enter']);
    await sleep(300);
    const out = await tmux.capture(name, 5);
    expect(out).toContain('-n ; echo not-a-flag');
  });
  it('capture returns only the last N lines', async () => {
    const n = 'ledge-t2';
    await tmux.newSession({ name: n, cwd: '/tmp', env: {}, command: ['sh', '-c', 'for i in $(seq 1 40); do echo line$i; done; cat'] });
    await sleep(400);
    const out = await tmux.capture(n, 5);
    expect(out!.split('\n')).toEqual(['line36', 'line37', 'line38', 'line39', 'line40']);
    await tmux.killSession(n);
  });
  it('sends a trailing or lone semicolon literally', async () => {
    const n = 'ledge-t3';
    await tmux.newSession({ name: n, cwd: '/tmp', env: {}, command: ['cat'] });
    await sleep(200);
    await tmux.sendText(n, 'echo hi;');
    await tmux.sendKeys(n, ['Enter']);
    await tmux.sendText(n, ';');
    await tmux.sendKeys(n, ['Enter']);
    await sleep(300);
    expect((await tmux.capture(n, 10))!.split('\n')).toEqual(['echo hi;', 'echo hi;', ';', ';']);
    await tmux.killSession(n);
  });
  it('sends a key name as a key: C-u is Ctrl+U (here the line kill of a cooked tty), never the text « C-u »', async () => {
    const n = 'ledge-t4';
    await tmux.newSession({ name: n, cwd: '/tmp', env: {}, command: ['cat'] });
    await sleep(200);
    await tmux.sendText(n, 'brouillon');
    await tmux.sendKeys(n, ['C-u']);
    await tmux.sendText(n, 'note');
    await tmux.sendKeys(n, ['Enter']);
    await sleep(300);
    expect((await tmux.capture(n, 10))!.split('\n').map(l => l.trimEnd())).toEqual(['note', 'note']);
    await tmux.killSession(n);
  });
  it('rejects text containing newlines', async () => {
    await expect(tmux.sendText(name, 'a\nb')).rejects.toThrow(/newline/);
    await expect(tmux.sendText(name, 'a\rb')).rejects.toThrow(/newline/);
  });
  it('does not prefix-match other sessions', async () => {
    for (const n of ['ledge-p1', 'ledge-p10']) await tmux.newSession({ name: n, cwd: '/tmp', env: {}, command: ['cat'] });
    await sleep(200);
    await tmux.killSession('ledge-p1');
    await sleep(100);
    await expect(tmux.sendText('ledge-p1', 'leak')).rejects.toThrow();
    await expect(tmux.sendKeys('ledge-p1', ['Enter'])).rejects.toThrow();
    expect(await tmux.capture('ledge-p1', 5)).toBeNull();
    await tmux.sendText('ledge-p10', 'ok');
    await sleep(200);
    expect(await tmux.capture('ledge-p10', 5)).toBe('ok');
    await tmux.killSession('ledge-p10');
  });
  it('reports a missing session', async () => {
    expect(await tmux.hasSession('ledge-nope')).toBe(false);
  });
  it('kills a session', async () => {
    await tmux.killSession(name);
    await sleep(100);
    expect(await tmux.hasSession(name)).toBe(false);
  });
  it('builds attach args for the dedicated server', () => {
    expect(tmux.attachArgs('ledge-x')).toEqual(['-L', socket, '-f', expect.stringContaining('tmux.conf'), 'attach-session', '-t', '=ledge-x']);
  });
});

describe('test helpers', () => {
  it('killTestServer kills the throwaway server and removes its socket file', async () => {
    const sock = `ledge-test-helper-${process.pid}-${Date.now()}`;
    const t = realTmux(sock, { scope: async () => false });
    await t.newSession({ name: 'h', cwd: '/tmp', env: {}, command: ['sleep', '60'] });
    expect(existsSync(testSocketPath(sock))).toBe(true);
    await killTestServer(sock);
    expect(await t.listSessions()).toEqual([]);
    expect(existsSync(testSocketPath(sock))).toBe(false);
  });
});

describe('tmux no server', () => {
  it('listSessions is empty when no server runs on the socket', async () => {
    expect(await realTmux(`ledge-test-none-${process.pid}`).listSessions()).toEqual([]);
  });
});
