import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LOCAL_MACHINE, SHELL_LINE_MARK, shellCommand, type MachineState } from '../src/machines';

// #299 review: the whole start line of a free shell, run for real (sh -c / eval), locally and as an ssh remote reads it, under sh
// and under fish as the remote login shell. The launcher is a stand-in that prints what `ledge shell` prints.
const N = '0123456789abcdef0123456789abcdef';
const root = mkdtempSync(join(tmpdir(), 'ledge-shellcmd-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const dir = join(root, "a b'$(touch PWNED)`id`*");
mkdirSync(dir, { recursive: true });
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** A launcher printing `out(dir)` on stdout, or failing on stderr with code 2. */
function launcher(name: string, body: string): string[] {
  const file = join(root, `${name}.mjs`);
  writeFileSync(file, body);
  return [process.execPath, file];
}
const good = launcher('good', `const d = process.argv.at(-1); const q = s => "'" + s.replace(/'/g, "'\\\\''") + "'";
process.stdout.write(${JSON.stringify(SHELL_LINE_MARK)} + 'cd ' + q(d) + ' && echo INTEGRATED:"$PWD:$1" && exit 0');`);
const noisy = launcher('noisy', `process.stdout.write('touch NOISE; echo EVALUATED');`);
const failing = launcher('failing', `process.stderr.write('ledge: unknown command shell'); process.exit(2);`);
const fallback = join(root, 'fallback.sh');
writeFileSync(fallback, '#!/bin/sh\necho FALLBACK:"$PWD"\n', { mode: 0o755 });

const at = (launch: string[], ssh?: string) => ({ ...LOCAL_MACHINE, ssh, launcher: launch, status: 'open', ready: true, recents: [], sessions: [],
  daemon: { version: '0.58.0', install: 'npm', systemd: true, freeShell: true } }) as MachineState;
const env = { ...process.env, SHELL: fallback };
/** What the remote login shell `outer` runs: ssh's last argument. */
const remote = (outer: string, argv: string[]) => spawnSync(outer, ['-c', argv.at(-1)!], { env, cwd: root, encoding: 'utf8' });
const noNoise = () => expect(readdirSync(root).filter(f => f === 'PWNED' || f === 'NOISE')).toEqual([]);
const fish = ['/usr/bin/fish', '/bin/fish'].find(existsSync);

describe('the integrated start line, run', () => {
  it('locally: the launcher\'s line is evaluated, in the folder, nothing of its name executed', () => {
    const argv = shellCommand(at(good), dir, N)!;
    expect(argv[0]).toBe('sh');
    expect(execFileSync('sh', ['-c', argv[2]!], { env, cwd: root, encoding: 'utf8' }).trim()).toBe(`INTEGRATED:${dir}:`);
    noNoise();
  });

  for (const outer of ['sh', ...(fish ? [fish] : [])]) {
    it(`over ssh, read by ${outer.split('/').at(-1)}: integrated; noise never evaluated; a failing launcher falls back silently`, () => {
      const ok = remote(outer, shellCommand(at(good, 'host'), dir, N)!);
      expect(ok.stdout.trim()).toBe(`INTEGRATED:${dir}:`);
      expect(ok.status).toBe(0);
      const loud = remote(outer, shellCommand(at(noisy, 'host'), dir, N)!);
      expect(loud.stdout.trim()).toBe(`FALLBACK:${dir}`);
      const gone = remote(outer, shellCommand(at(failing, 'host'), dir, N)!);
      expect(gone.stdout.trim()).toBe(`FALLBACK:${dir}`);
      expect(gone.stderr).toBe('');
      noNoise();
    });
  }
  it.runIf(!fish)('fish is not installed here: the remote fish case is not run', () => { expect(fish).toBeUndefined(); });
});

it('the ssh string never holds a double quote either (wsl.exe)', () => {
  expect(shellCommand(at(good, 'host'), dir, N)!.join(' ')).not.toContain('"');
  expect(q('x')).toBe("'x'");
});
