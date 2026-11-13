// #299: a free shell starts with its integration (OSC 633 marks around prompts and commands) for bash, zsh and fish; another shell,
// or LEDGE_SHELL_INTEGRATION=0, starts as before. The bash and fish scripts are run for real when the shell is there.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRIPTS, withIntegration } from '../src/term/shellIntegration.js';
import { bornShell } from '../src/term/shell.js';

const dir = () => mkdtempSync(join(tmpdir(), 'ledge-si-'));
const marks = (out: string) => [...out.matchAll(/\x1b\]633;([^\x07]*)\x07/g)].map(m => m[1]!);
/** A prompt drawn again (a shell repaints it: bash without a terminal, fish as keys come) repeats its A and B: counted once. */
const once = (m: string[]) => m.filter((x, i) => !((x === 'A' && m[i - 2] === 'A' && m[i - 1] === 'B') || (x === 'B' && m[i - 3] === 'A' && m[i - 2] === 'B' && m[i - 1] === 'A')));
const has = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;

describe('#299: which shell gets the integration', () => {
  it('bash: its own init file, which reads the login files', () => {
    const d = dir();
    const s = withIntegration('/bin/bash', { PATH: '/bin' }, d)!;
    expect(s.command).toEqual(['/bin/bash', '--init-file', join(d, 'bash.sh')]);
    expect(s.env).toEqual({ PATH: '/bin', LEDGE_SHELL_LOGIN: '1' });
    expect(readFileSync(join(d, 'bash.sh'), 'utf8')).toBe(SCRIPTS['bash.sh']);
  });

  it('zsh: a login shell whose ZDOTDIR is Ledge\'s, which reads the person\'s own (theirs kept when they have one)', () => {
    const d = dir();
    expect(withIntegration('/usr/bin/zsh', {}, d)).toEqual({ command: ['/usr/bin/zsh', '-l'], env: { ZDOTDIR: join(d, 'zsh') } });
    expect(withIntegration('/usr/bin/zsh', { ZDOTDIR: '/h/.config/zsh' }, d)!.env).toEqual({ ZDOTDIR: join(d, 'zsh'), LEDGE_USER_ZDOTDIR: '/h/.config/zsh' });
    for (const f of ['.zshenv', '.zprofile', '.zshrc', '.zlogin']) expect(existsSync(join(d, 'zsh', f))).toBe(true);
  });

  it('fish: a login shell that sources the script after its configuration', () => {
    const d = dir();
    expect(withIntegration('/usr/bin/fish', {}, d)!.command).toEqual(['/usr/bin/fish', '-l', '--init-command', `source '${join(d, 'fish.fish')}'`]);
  });

  it('another shell, the integration turned off, or no place to write it: as before', () => {
    const d = dir();
    expect(withIntegration('/bin/sh', {}, d)).toBeNull();
    expect(withIntegration('/usr/bin/nu', {}, d)).toBeNull();
    expect(withIntegration('/bin/bash', { LEDGE_SHELL_INTEGRATION: '0' }, d)).toBeNull();
    const ro = dir(); writeFileSync(join(ro, 'file'), ''); // a file where the folder should be
    expect(withIntegration('/bin/bash', {}, join(ro, 'file', 'si'))).toBeNull();
  });

  it('a script changed on disk is written again', () => {
    const d = dir();
    withIntegration('/bin/bash', {}, d);
    writeFileSync(join(d, 'bash.sh'), 'old');
    withIntegration('/bin/bash', {}, d);
    expect(readFileSync(join(d, 'bash.sh'), 'utf8')).toBe(SCRIPTS['bash.sh']);
  });

  it('bornShell starts what the integration says', async () => {
    const created: Array<{ command: string[]; env: Record<string, string> }> = [];
    await bornShell({
      session: { id: 'a', cwd: '/w' }, tag: 's1', cols: 80, rows: 24,
      env: async () => ({ SHELL: '/bin/bash' }),
      newSession: async o => { created.push(o); }, watch: () => {}, reply: () => {}, name: () => 'sh-aabbccddeeff',
      integration: (shell, env) => ({ command: [shell, '--init-file', '/si/bash.sh'], env: { ...env, LEDGE_SHELL_LOGIN: '1' } })
    });
    expect(created[0]).toMatchObject({ command: ['/bin/bash', '--init-file', '/si/bash.sh'], env: { SHELL: '/bin/bash', LEDGE_SHELL_LOGIN: '1' } });
  });
});

describe('#299: the scripts, run', () => {
  it.runIf(has('bash'))('bash: the person\'s files are read, their prompt kept, and each command marked with its line and exit code', () => {
    const d = dir(); const home = dir();
    mkdirSync(join(home, 'my dir'));
    writeFileSync(join(home, '.bash_profile'), 'echo PROFILE-READ\n[ -r ~/.bashrc ] && . ~/.bashrc\n');
    writeFileSync(join(home, '.bashrc'), 'PS1="mine> "\nPROMPT_COMMAND="true"\n');
    const s = withIntegration('/bin/bash', {}, d)!;
    // stderr (the prompt, with A and B) and stdout (the other marks) in one stream, in the order bash wrote them.
    const r = spawnSync('sh', ['-c', 'exec "$@" 2>&1', 'sh', 'bash', ...s.command.slice(1), '-i'], {
      cwd: home, input: "cd 'my dir'\nfalse\n\necho 'a;b'\n", encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TERM: 'dumb', ...s.env }
    });
    const out = r.stdout + r.stderr;
    expect(out).toContain('PROFILE-READ');
    expect(out).toContain('mine> ');
    const m = marks(out);
    const cwd = join(home, 'my dir');
    // From the first command on: E, C, D, then the next prompt's P, A, B.
    const from = m.indexOf("E;cd 'my dir'");
    expect(once(m.slice(from))).toEqual([
      "E;cd 'my dir'", 'C', 'D;0', `P;Cwd=${cwd}`, 'A', 'B',
      'E;false', 'C', 'D;1', `P;Cwd=${cwd}`, 'A', 'B',
      `P;Cwd=${cwd}`, 'A', 'B', // an empty line: no command
      "E;echo 'a\\x3bb'", 'C', 'D;0', `P;Cwd=${cwd}`, 'A', 'B'
    ]);
  });

  // fish reads a pipe as a script (no prompt, no events): it runs under a pty (`script`), the keys typed after it started.
  it.runIf(has('fish') && has('script'))('fish: the same marks, and the person\'s prompt still sees the last status', () => {
    const d = dir(); const home = dir();
    mkdirSync(join(home, '.config', 'fish'), { recursive: true });
    writeFileSync(join(home, '.config', 'fish', 'config.fish'), 'function fish_prompt\n  echo -n "fishy[$status]> "\nend\n');
    chmodSync(home, 0o755);
    const s = withIntegration('/usr/bin/fish', {}, d)!;
    // No PATH and no cache inside fish: it starts no background job (its completions) still writing when the folder goes.
    const bin = spawnSync('sh', ['-c', 'command -v fish'], { encoding: 'utf8' }).stdout.trim();
    const fish = ['env', 'PATH=/nonexistent', 'XDG_CACHE_HOME=/nonexistent', bin, ...s.command.slice(1)].map(a => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
    const r = spawnSync('sh', ['-c', `(sleep 1; printf 'false\\r'; sleep 0.5; printf 'exit\\r'; sleep 0.5) | script -qfec "$0" /dev/null`, fish], {
      cwd: home, encoding: 'utf8', timeout: 10_000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, XDG_CONFIG_HOME: join(home, '.config'), TERM: 'dumb' }
    });
    const out = r.stdout + r.stderr;
    const m = marks(out);
    const from = m.indexOf('E;false');
    expect(once(m.slice(from)).slice(0, 6)).toEqual(['E;false', 'C', 'D;1', `P;Cwd=${home}`, 'A', 'B']);
    expect(out).toContain('fishy[1]> ');
  }, 15_000);

  it.runIf(has('zsh') && has('script'))('zsh: the person\'s files read through Ledge\'s ZDOTDIR, their prompt kept, their ZDOTDIR given back', () => {
    const d = dir(); const home = dir();
    writeFileSync(join(home, '.zprofile'), 'echo ZPROFILE-READ\n');
    writeFileSync(join(home, '.zshrc'), 'PS1="zmine> "\necho ZSHRC-READ\n');
    writeFileSync(join(home, '.zlogin'), 'echo ZLOGIN-READ\n');
    const s = withIntegration('/usr/bin/zsh', {}, d)!;
    const bin = spawnSync('sh', ['-c', 'command -v zsh'], { encoding: 'utf8' }).stdout.trim();
    const r = spawnSync('sh', ['-c', `(sleep 1; printf 'false\\r'; sleep 0.4; printf 'echo "zd=$ZDOTDIR"\\r'; sleep 0.4; printf 'exit\\r'; sleep 0.3) | script -qfec "$0 -l" /dev/null`, bin], {
      cwd: home, encoding: 'utf8', timeout: 10_000,
      // FPATH: a zsh unpacked outside /usr finds its functions (add-zsh-hook) only through it.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TERM: 'dumb', ...(process.env.FPATH ? { FPATH: process.env.FPATH } : {}), ...s.env }
    });
    const out = r.stdout + r.stderr;
    for (const w of ['ZPROFILE-READ', 'ZSHRC-READ', 'ZLOGIN-READ', 'zmine> ', 'zd=\r']) expect(out).toContain(w);
    const m = once(marks(out));
    const from = m.indexOf('E;false');
    expect(m.slice(from, from + 6)).toEqual(['E;false', 'C', 'D;1', `P;Cwd=${home}`, 'A', 'B']);
  }, 15_000);
});
