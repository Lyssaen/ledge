import { describe, expect, it } from 'vitest';
import { bornShell } from '../src/term/shell.js';

describe('bornShell', () => {
  it('starts a login shell in the session folder and watches it as its own session', async () => {
    const created: Array<{ name: string; cwd: string; command: string[] }> = [];
    const watched: Array<{ tmuxName: string; shell: string; owned: boolean }> = [];
    await bornShell({
      session: { id: 'a', cwd: '/c', workdir: '/w' }, tag: 's1', cols: 80, rows: 24,
      env: async () => ({ SHELL: '/bin/zsh', PATH: '/bin' }),
      newSession: async o => { created.push(o); },
      watch: s => { watched.push(s); },
      reply: () => {}, name: () => 'sh-aabbccddeeff'
    });
    expect(created[0]).toMatchObject({ name: 'sh-aabbccddeeff', cwd: '/w', command: ['/bin/zsh', '-l'] });
    expect(watched).toEqual([{ id: 'a', tmuxName: 'sh-aabbccddeeff', shell: 's1', owned: true }]);
  });

  it('says failed, and logs no pane bytes, when the session cannot be created', async () => {
    const sent: unknown[] = [];
    const lines: string[] = [];
    await bornShell({
      session: { id: 'a', cwd: '/missing' }, tag: 's2', cols: 80, rows: 24,
      env: async () => ({}),
      newSession: async () => { throw new Error('tmux new-session failed: secret output'); },
      watch: () => { throw new Error('watched'); },
      reply: m => { sent.push(m); }, log: l => { lines.push(l); }, name: () => 'sh-001122334455'
    });
    expect(sent).toEqual([{ type: 'term.exit', id: 'a', shell: 's2', why: 'failed' }]);
    expect(lines).toEqual(['shell s2 of a failed']);
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('kills the session when the socket closes while it is starting', async () => {
    const killed: string[] = [];
    let open = true;
    await bornShell({
      session: { id: 'a', cwd: '/w' }, tag: 's1', cols: 80, rows: 24,
      env: async () => ({ SHELL: '/bin/bash' }),
      newSession: async () => { open = false; },
      watch: () => { throw new Error('watched'); },
      reply: () => { throw new Error('replied'); },
      alive: () => open, killSession: n => { killed.push(n); }, name: () => 'sh-ff'
    });
    expect(killed).toEqual(['sh-ff']);
  });
});
