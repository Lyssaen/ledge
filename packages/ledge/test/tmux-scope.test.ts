import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureLedgeDir } from '../src/paths.js';
import { newSessionCommand, systemdAvailable, realTmux, run } from '../src/tmux.js';
import { killTestServer } from './helpers.js';

describe('newSessionCommand', () => {
  it('runs tmux directly when not scoped', () => {
    expect(newSessionCommand(['-L', 'ledge', 'new-session', '-d'], false, 'u')).toEqual({ file: 'tmux', args: ['-L', 'ledge', 'new-session', '-d'] });
  });
  it('wraps tmux in a transient user scope when scoped, so the server leaves the caller cgroup', () => {
    expect(newSessionCommand(['-L', 'ledge', 'new-session', '-d'], true, 'ledge-tmux-42')).toEqual({
      file: 'systemd-run',
      args: ['--user', '--scope', '--quiet', '--collect', '--unit=ledge-tmux-42', '--', 'tmux', '-L', 'ledge', 'new-session', '-d']
    });
  });
});

describe('systemdAvailable', () => {
  it('needs the user manager socket under XDG_RUNTIME_DIR', () => {
    expect(systemdAvailable({ XDG_RUNTIME_DIR: '/run/user/1000' }, p => p === '/run/user/1000/systemd/private')).toBe(true);
    expect(systemdAvailable({ XDG_RUNTIME_DIR: '/run/user/1000' }, () => false)).toBe(false);
    expect(systemdAvailable({}, () => true)).toBe(false);
  });
});

const socket = `ledge-scope-${process.pid}-${Date.now()}`;
afterAll(async () => { await killTestServer(socket); });

describe.skipIf(!systemdAvailable())('a scoped server (real systemd)', () => {
  it('lives in its own ledge-tmux scope, not in the caller cgroup', async () => {
    const tmux = realTmux(socket, { scope: async () => true });
    await tmux.newSession({ name: 'ledge-s1', cwd: '/tmp', env: {}, command: ['cat'] });
    const pid = (await run(['-L', socket, 'list-sessions', '-F', '#{pid}'])).stdout.trim().split('\n')[0]!;
    expect(readFileSync(`/proc/${pid}/cgroup`, 'utf8')).toMatch(/ledge-tmux-\d+\.scope/);
  });
  it('does not open a second scope once the server runs', async () => {
    const tmux = realTmux(socket, { scope: async () => true });
    await tmux.newSession({ name: 'ledge-s2', cwd: '/tmp', env: {}, command: ['cat'] });
    expect(await tmux.listSessions()).toEqual(expect.arrayContaining(['ledge-s1', 'ledge-s2']));
  });
});

const fallback = `ledge-noscope-${process.pid}-${Date.now()}`;
afterAll(async () => { await killTestServer(fallback); });

describe('a scope that cannot be opened', () => {
  it('still starts tmux, unscoped, so agents can launch', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-')); await ensureLedgeDir();
    // A systemd-run that always fails, found first on the client PATH.
    const bin = mkdtempSync(join(tmpdir(), 'ledge-bin-'));
    writeFileSync(join(bin, 'systemd-run'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const tmux = realTmux(fallback, { scope: async () => true });
    await tmux.newSession({ name: 'ledge-f1', cwd: '/tmp', env: { PATH: `${bin}:${process.env.PATH}` }, command: ['cat'] });
    expect(await tmux.listSessions()).toEqual(['ledge-f1']);
  });
});
