import { describe, it, expect, vi } from 'vitest';
import type { DaemonInfo, ServerMessage } from '@ledge/protocol';
import { createDaemonUpdater, npmCommand, lastLines, type UpdaterDeps } from '../src/update/run-update.js';

const NPM_INFO: DaemonInfo = { version: '0.2.2', install: 'npm', systemd: true };
function deps(over: Partial<UpdaterDeps> = {}): UpdaterDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, execPath: '/home/u/.local/share/nvm/v26.7.0/bin/node',
    info: () => NPM_INFO, atRisk: async () => false,
    npm: async cmd => { calls.push(`npm ${cmd.file} ${cmd.args.join(' ')}`); return { code: 0, output: 'added 1 package' }; },
    restart: async () => { calls.push('restart'); }, save: async () => { calls.push('save'); },
    ...over
  };
}
const collect = () => { const sent: ServerMessage[] = []; return { sent, send: (m: ServerMessage) => { sent.push(m); } }; };

describe('npmCommand', () => {
  it('uses the npm next to the running node, not the one on PATH', () => {
    expect(npmCommand('/home/u/.local/share/nvm/v26.7.0/bin/node', '0.3.0')).toEqual({ file: '/home/u/.local/share/nvm/v26.7.0/bin/npm', args: ['i', '-g', '@paradow/ledge@0.3.0'] });
  });
});

describe('lastLines', () => {
  it('keeps the end of npm output, without blank lines', () => {
    expect(lastLines('a\n\nnpm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules\n\n', 2)).toBe('npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules');
  });
});

describe('createDaemonUpdater', () => {
  it('installs, says so, saves the journal, then restarts', async () => {
    const d = deps(); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.progress', version: '0.3.0', step: 'installing' }, { type: 'update.progress', version: '0.3.0', step: 'restarting' }]);
    expect(d.calls).toEqual(['npm /home/u/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge@0.3.0', 'save', 'restart']);
  });
  it('refuses a clone and gives its command, touching nothing', async () => {
    const d = deps({ info: () => ({ version: '0.2.2', install: 'git', systemd: true, manual: 'cd /c && git pull' }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'git-install', command: 'cd /c && git pull' }]);
    expect(d.calls).toEqual([]);
  });
  it('refuses without systemd and gives the npm command', async () => {
    const d = deps({ info: () => ({ ...NPM_INFO, systemd: false }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent[0]).toMatchObject({ reason: 'no-systemd', command: '/home/u/.local/share/nvm/v26.7.0/bin/npm i -g @paradow/ledge@0.3.0' });
    expect(d.calls).toEqual([]);
  });
  it('refuses when the tmux server lives in the daemon service', async () => {
    const d = deps({ atRisk: async () => true }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'sessions-at-risk' }]);
    expect(d.calls).toEqual([]);
  });
  it('reports npm failures with its output and never restarts', async () => {
    const d = deps({ npm: async () => ({ code: 243, output: 'npm ERR! code EACCES\nnpm ERR! path /usr/local/lib/node_modules\n' }) }); const { sent, send } = collect();
    await createDaemonUpdater(d).update('0.3.0', send);
    expect(sent.at(-1)).toMatchObject({ type: 'update.failed', reason: 'npm-failed', detail: expect.stringContaining('EACCES'), command: expect.stringContaining('@paradow/ledge@0.3.0') });
    expect(d.calls).not.toContain('restart');
  });
  it('answers busy while an update runs', async () => {
    let release!: () => void;
    const d = deps({ npm: () => new Promise(r => { release = () => r({ code: 0, output: '' }); }) });
    const u = createDaemonUpdater(d); const a = collect(); const b = collect();
    const first = u.update('0.3.0', a.send);
    await vi.waitFor(() => expect(u.running()).toBe(true));
    await u.update('0.3.0', b.send);
    expect(b.sent).toEqual([{ type: 'update.failed', version: '0.3.0', reason: 'busy' }]);
    release(); await first;
    expect(u.running()).toBe(false);
  });
});
