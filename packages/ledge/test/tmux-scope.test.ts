import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
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
