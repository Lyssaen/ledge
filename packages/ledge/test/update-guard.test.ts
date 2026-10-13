import { describe, it, expect } from 'vitest';
import { inDaemonService, tmuxServerAtRisk } from '../src/update/guard.js';

const IN_SERVICE = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-daemon.service\n';
const IN_SCOPE = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/ledge-tmux-1760266000000.scope\n';

describe('inDaemonService', () => {
  it('spots the daemon service in a cgroup line', () => {
    expect(inDaemonService(IN_SERVICE)).toBe(true);
    expect(inDaemonService(IN_SCOPE)).toBe(false);
  });
});

describe('tmuxServerAtRisk', () => {
  const tmuxWith = (stdout: string, code = 0) => async () => ({ code, stdout, stderr: code ? 'no server running on /tmp/tmux-1000/ledge' : '' });
  it('refuses when the tmux server lives in the daemon service', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('406005\n406005\n'), readCgroup: async () => IN_SERVICE })).toBe(true);
  });
  it('is safe when the server has its own scope', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('5000\n'), readCgroup: async () => IN_SCOPE })).toBe(false);
  });
  it('is safe when no server runs', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('', 1), readCgroup: async () => { throw new Error('unused'); } })).toBe(false);
  });
  it('fails closed when the cgroup cannot be read', async () => {
    expect(await tmuxServerAtRisk({ runTmux: tmuxWith('5000\n'), readCgroup: async () => { throw new Error('EACCES'); } })).toBe(true);
  });
});
