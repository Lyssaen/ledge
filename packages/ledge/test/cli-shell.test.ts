// #299: `ledge shell [--nonce N] <dir>` prints the line Desktop's free shell evals: the person's login shell in <dir> with the
// integration, every value quoted for POSIX sh; on failure nothing on stdout. Run for real: the printed line, evaluated by sh under a
// pty, gives a shell whose commands are marked and signed.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARK, shellLine } from '../src/cli/shell.js';

const NONCE = '0123456789abcdef0123456789abcdef';
const dir = () => mkdtempSync(join(tmpdir(), 'ledge-cli-shell-'));
const has = (bin: string) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const marks = (out: string) => [...out.matchAll(/\x1b\]633;([^\x07]*)\x07/g)].map(m => m[1]!);
const line = (r: ReturnType<typeof shellLine>) => { if ('error' in r) throw new Error(r.error); return r.line; };

describe('#299: ledge shell, the line it prints', () => {
  it('bash: cd, the exports, exec of a login shell, all quoted', () => {
    const d = dir();
    const l = line(shellLine(['--nonce', NONCE, "/w/it's here"], { env: { HOME: '/h', PATH: '/bin' }, shell: '/bin/bash', dir: d }));
    expect(MARK).toBe(': ledge-shell; ');
    expect(l.startsWith(`${MARK}cd '/w/it'\\''s here' 2>/dev/null || cd; `)).toBe(true);
    expect(l).not.toContain('\n');
    expect(l).toContain(`export LEDGE_SHELL_NONCE='${NONCE}'`);
    expect(l).toContain(`export LEDGE_SHELL_BOOT='__ledge_ut=$(builtin trap -p DEBUG); . '\\''${join(d, 'bash.sh')}'\\'''`);
    // No file of its own in a shared folder (a link placed there would be written through).
    expect(l).not.toMatch(/TMPDIR|ledge-trap/);
    expect(l.endsWith(`exec '/bin/bash' '-l'`)).toBe(true);
    expect(l).not.toContain('export PATH'); // only what changes
  });

  it('~ is the home folder', () => {
    const d = dir();
    expect(line(shellLine(['~'], { env: { HOME: '/h' }, shell: '/bin/bash', dir: d })).startsWith(`${MARK}cd '/h' 2>/dev/null`)).toBe(true);
    expect(line(shellLine(['~/src'], { env: { HOME: '/h' }, shell: '/bin/bash', dir: d })).startsWith(`${MARK}cd '/h/src' 2>/dev/null`)).toBe(true);
  });

  it('another shell, or the integration turned off: the plain login shell', () => {
    const d = dir();
    expect(line(shellLine(['/w'], { env: {}, shell: '/usr/bin/nu', dir: d }))).toBe(`${MARK}cd '/w' 2>/dev/null || cd; exec '/usr/bin/nu' -l`);
    expect(line(shellLine(['/w'], { env: { LEDGE_SHELL_INTEGRATION: '0' }, shell: '/bin/bash', dir: d }))).toBe(`${MARK}cd '/w' 2>/dev/null || cd; exec '/bin/bash' -l`);
  });

  it('no nonce: one of its own', () => {
    const l = line(shellLine(['/w'], { env: {}, shell: '/usr/bin/zsh', dir: dir() }));
    expect(l).toMatch(/export LEDGE_SHELL_NONCE='[0-9a-f]{32}'/);
  });

  it('a bad call is an error, never a line', () => {
    for (const args of [[], ['--nonce'], ['--nonce', 'xyz', '/w'], ['--nonce', NONCE.toUpperCase(), '/w'], ['/a', '/b'], ['--what', '/w'], ['']]) {
      expect('error' in shellLine(args, { env: {}, shell: '/bin/bash', dir: dir() })).toBe(true);
    }
  });
});

describe('#299: the printed line, run as Desktop runs it', () => {
  /** sh -c 'eval "$(…)"; exec <bare shell> -l' under a pty, with keys typed once the shell is up. */
  const run = (shell: string, keys: string, home: string, extra: Record<string, string> = {}) => {
    const d = dir();
    const l = line(shellLine(['--nonce', NONCE, home], { env: { HOME: home, ...extra }, shell, dir: d }));
    const file = join(d, 'line'); writeFileSync(file, l);
    // Desktop's form (dev-front, #299): only a line with the mark is evaluated, then the plain shell if nothing exec'd.
    const inner = `set -f; IFS=; l=$(cat '${file}' 2>/dev/null); case $l in '${MARK}'*) eval $l;; esac; unset IFS; set +f; exec ${shell} -l`;
    return spawnSync('sh', ['-c', `(sleep 1.2; ${keys}; sleep 0.3; printf 'exit\\r'; sleep 0.4) | script -qfec "$0" /dev/null`, `sh -c '${inner.replace(/'/g, `'\\''`)}'`], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 12_000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TERM: 'dumb', ...extra }
    }).stdout;
  };

  it.runIf(has('bash') && has('script'))('bash: in the folder, a login shell, its commands marked and signed', () => {
    const home = dir();
    writeFileSync(join(home, '.hushlogin'), '');
    writeFileSync(join(home, '.bash_profile'), 'shopt -q login_shell && echo LOGIN-SHELL\nPS1="b> "\n');
    const out = run('/bin/bash', "printf 'false\\r'", home);
    expect(out).toContain('LOGIN-SHELL');
    const m = marks(out);
    expect(m).toContain(`E;false;${NONCE}`);
    expect(m).toContain('D;1');
    expect(m).toContain(`P;Cwd=${home}`);
  }, 15_000);

  it.runIf(has('fish') && has('script'))('fish: the same', () => {
    const home = dir();
    const out = run('/usr/bin/fish', "printf 'false\\r'", home, { XDG_CACHE_HOME: '/nonexistent', XDG_CONFIG_HOME: join(home, '.config') });
    const m = marks(out);
    expect(m).toContain(`E;false;${NONCE}`);
    expect(m).toContain('D;1');
  }, 15_000);

  it('noise, an error or an older ledge\'s output is never evaluated: the plain shell of the second half starts', () => {
    for (const printed of ['echo nope >&2; exit 2', 'echo PWNED; exit 0', 'echo "usage: ledge …"']) {
      const out = spawnSync('sh', ['-c', `set -f; IFS=; l=$(sh -c '${printed}' 2>/dev/null); case $l in '${MARK}'*) eval $l;; esac; unset IFS; set +f; echo PLAIN-SHELL-REACHED`], { encoding: 'utf8' }).stdout;
      expect(out.trim()).toBe('PLAIN-SHELL-REACHED');
    }
  });
});
