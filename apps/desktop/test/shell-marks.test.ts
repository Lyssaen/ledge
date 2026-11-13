import { describe, expect, it } from 'vitest';
import { commandRows, commandText, dirLabel, draftText, outputText, parse633, ShellMarks, statusOf, unescape633, type Mark, type ShellCommand } from '../src/term/shellMarks';

/** #299 (docs/mockups/ledge-shell-marks.html, form A): the OSC 633 model of a free shell. */

/** A buffer read between columns, as xterm's translateToString (ASCII here: a column is a character). */
const columns = (screen: string[]) => ({ line: (n: number, start = 0, end?: number) => screen[n]?.slice(start, end) });

/** A fake terminal: a cursor (line, column) moved by the test, marks at the cursor. */
function fakeTerm() {
  const pos = { line: 0, x: 0 };
  let now = 1000;
  const mk = (line: number): Mark => ({ line, isDisposed: false, dispose() {} });
  const marks = new ShellMarks({ mark: () => mk(pos.line), markAt: line => mk(line), cursorX: () => pos.x, now: () => now });
  return { pos, marks, tick: (ms: number) => { now += ms; } };
}

describe('parse633', () => {
  it('reads A B C D E P; ignores what Ledge does not use', () => {
    expect(parse633('A')).toEqual({ kind: 'A' });
    expect(parse633('D;1')).toEqual({ kind: 'D', code: 1 });
    expect(parse633('D')).toEqual({ kind: 'D', code: null });
    expect(parse633('E;git commit -m a\\x3bb;nonce')).toEqual({ kind: 'E', commandLine: 'git commit -m a;b' });
    expect(parse633('P;Cwd=/home/u/ledge')).toEqual({ kind: 'P', key: 'Cwd', value: '/home/u/ledge' });
    expect(parse633('Z')).toBeNull();
    expect(unescape633('a\\\\b')).toBe('a\\b');
  });
});

describe('ShellMarks', () => {
  it('no OSC 633: inactive, no command (a shell without integration is left as it was)', () => {
    const { marks } = fakeTerm();
    expect(marks.active).toBe(false);
    expect(marks.commands()).toEqual([]);
  });

  it('a succeeded, a failed and a running command; the prompt being typed in is « typing »', () => {
    const { pos, marks, tick } = fakeTerm();
    const run = (line: number, end: number, code: number | null) => {
      pos.line = line; pos.x = 0; marks.handle('A');
      pos.x = 20; marks.handle('B');
      pos.line = line + 1; pos.x = 0; marks.handle('C');
      tick(3200);
      if (code !== null) { pos.line = end; pos.x = 0; marks.handle(`D;${code}`); }
    };
    run(0, 2, 0);
    run(2, 6, 1);
    run(6, 0, null); // running
    const list = marks.commands();
    expect(list.map((c, i) => statusOf(c, i === list.length - 1))).toEqual(['ok', 'failed', 'running']);
    expect(commandRows(list[1]!, 9)).toEqual({ from: 2, to: 5 });
    expect(commandRows(list[2]!, 9)).toEqual({ from: 6, to: 9 });
    expect(list[1]!.endedAt! - list[1]!.startedAt!).toBe(3200);
    expect(marks.running()).toBe(list[2]);
    // The next prompt without a D (Ctrl C): unknown, never red.
    pos.line = 10; marks.handle('A');
    const after = marks.commands();
    expect(statusOf(after[2]!, false)).toBe('unknown');
    expect(statusOf(after[3]!, true)).toBe('typing');
  });

  it('D right after a prompt with no command ends nothing; P;Cwd keeps the first folder as the start', () => {
    const { pos, marks } = fakeTerm();
    marks.handle('P;Cwd=/home/u/ledge');
    marks.handle('A'); marks.handle('B'); marks.handle('D;0');
    expect(marks.commands()[0]!.end).toBeNull();
    marks.handle('P;Cwd=/home/u/ledge/packages');
    expect(marks.cwd).toBe('/home/u/ledge/packages');
    expect(marks.startCwd).toBe('/home/u/ledge');
    pos.line = 3;
    marks.reset();
    expect(marks.commands()).toEqual([]);
  });

  it('the command from E, else from the screen; the output without its trailing blank lines', () => {
    const { pos, marks } = fakeTerm();
    const screen = ['u@wsl:~$ pnpm lint', 'src/a.ts', '  1:1 error', '', 'u@wsl:~$ '];
    const buf = columns(screen);
    marks.handle('A'); pos.x = 9; marks.handle('B');
    pos.line = 1; pos.x = 0; marks.handle('C');
    pos.line = 4; marks.handle('D;1');
    const c = marks.commands()[0]!;
    expect(commandText(c, buf)).toBe('pnpm lint');
    expect(outputText(c, buf, 4)).toBe('src/a.ts\n  1:1 error');
    c.commandLine = 'pnpm lint --fix';
    expect(commandText(c, buf)).toBe('pnpm lint --fix');
  });
});

describe('review #299', () => {
  it('copies only the output before the next prompt on the same line (review-qa repro: `printf foo`)', () => {
    const mark = (line: number) => ({ line, isDisposed: false, dispose() {} });
    const c: ShellCommand = { id: 1, prompt: mark(0), input: null, output: mark(1), end: { mark: mark(1), x: 3 }, commandLine: 'printf foo', code: 0, startedAt: 0, endedAt: 1 };
    expect(outputText(c, columns(['$ printf foo', 'foo$ secret-draft']), 1)).toBe('foo');
  });

  it('the draft at the prompt: empty, typed, or unknown (no prompt being typed in)', () => {
    const { pos, marks } = fakeTerm();
    const screen = ['$ ls', 'README.md', '$ echo draft'];
    expect(draftText(marks, columns(screen), 2)).toBeNull();
    marks.handle('A'); pos.x = 2; marks.handle('B'); pos.line = 1; pos.x = 0; marks.handle('C'); pos.line = 2; marks.handle('D;0');
    marks.handle('A'); pos.x = 2; marks.handle('B');
    expect(draftText(marks, columns(screen), 2)).toBe('echo draft');
    expect(draftText(marks, columns(['$ ls', 'README.md', '$ ']), 2)).toBe('');
    // A command runs: the prompt is not being typed in.
    pos.line = 3; pos.x = 0; marks.handle('C');
    expect(draftText(marks, columns(screen), 3)).toBeNull();
  });

  it('D without C (bash with its own DEBUG trap): the command ends, its output starts under it, its duration is unknown', () => {
    const { pos, marks } = fakeTerm();
    marks.handle('A'); pos.x = 2; marks.handle('B');
    pos.line = 3; pos.x = 0; marks.handle('D;1');
    const c = marks.commands()[0]!;
    expect(statusOf(c, true)).toBe('failed');
    expect(c.output!.line).toBe(1);
    expect(c.startedAt).toBeNull();
    expect(commandRows(c, 3)).toEqual({ from: 0, to: 2 });
  });

  it('a prompt drawn again (A and B again, fish as one types): the last pair is the prompt', () => {
    const { pos, marks } = fakeTerm();
    marks.handle('A'); pos.x = 2; marks.handle('B');
    pos.x = 0; marks.handle('A'); pos.x = 2; marks.handle('B');
    pos.x = 0; marks.handle('A'); pos.x = 2; marks.handle('B');
    expect(marks.commands()).toHaveLength(1);
    pos.line = 1; marks.handle('C'); pos.line = 2; marks.handle('D;0');
    pos.x = 0; marks.handle('A');
    expect(marks.commands()).toHaveLength(2);
  });

  it('C without D (a pause #297 dropped it): the next prompt ends it as unknown, never red', () => {
    const { pos, marks } = fakeTerm();
    marks.handle('A'); marks.handle('B'); pos.line = 1; marks.handle('C');
    pos.line = 5; marks.handle('A');
    expect(statusOf(marks.commands()[0]!, false)).toBe('unknown');
  });
});

describe('dirLabel (design-ux, qitem-20261113103231)', () => {
  const start = '/home/u/Workspace/ledge', home = '/home/u';
  it('from the start folder, prefixed with its name', () => {
    expect(dirLabel(start, start, home)).toBe('ledge');
    expect(dirLabel(`${start}/packages/ledge`, start, home)).toBe('ledge/packages/ledge');
  });
  it('outside it: the last two segments, ~ for the home', () => {
    expect(dirLabel('/home/u/Workspace', start, home)).toBe('~/Workspace');
    expect(dirLabel('/tmp', start, home)).toBe('/tmp');
    expect(dirLabel('/home/u', start, home)).toBe('~');
    expect(dirLabel('/usr/local/bin', start, home)).toBe('local/bin');
  });
  it('past 28 characters, cut in the middle on the first and last segments', () => {
    expect(dirLabel(`${start}/packages/ledge/src/daemon/usage`, start, home)).toBe('ledge/…/usage');
  });
  it('a Windows path, cut on its backslashes', () => {
    expect(dirLabel('C:\\Users\\u\\proj', 'C:\\Users\\u', undefined)).toBe('u\\proj');
  });
});
