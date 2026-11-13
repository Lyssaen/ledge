// #298: a first screen with the pane's history above the visible lines. Painted into a real xterm: the history goes to the
// scrollback, the visible lines fill the grid, the cursor lands where the pane has it on the visible screen, and a second screen
// replaces the history instead of piling a copy on it.
import { describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import type { TermModes } from '@ledge/protocol';
import { paintScreen } from '../src/term/paint';

const MAIN: TermModes = { alt: false, cursor: true, appCursor: false, appKeypad: false, mouse: 'none', sgr: false, wrap: true, insert: false };

function term(rows: number) {
  const t = new Terminal({ cols: 20, rows, scrollback: 5000, allowProposedApi: true });
  const write = (s: string) => new Promise<void>(r => t.write(s, r));
  const lines = () => { const b = t.buffer.active; const out: string[] = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)!.translateToString(true)); return out; };
  return { t, write, lines };
}

describe('#298: paint with history', () => {
  it('history in the scrollback, the visible lines on the grid, the cursor on the visible screen', async () => {
    const { t, write, lines } = term(4);
    // 6 history lines, then the 4 visible ones; the pane's cursor is after « $ » on the visible line 3 (y 2).
    const screen = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'v1', 'v2', '$ ', ''].join('\n');
    await write(paintScreen(screen, { x: 2, y: 2 }, MAIN));
    const b = t.buffer.active;
    expect(lines()).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'v1', 'v2', '$ ', '']);
    expect(b.baseY).toBe(6);
    expect({ x: b.cursorX, y: b.cursorY }).toEqual({ x: 2, y: 2 });
    await write('ls');
    expect(lines()[8]).toBe('$ ls');
    t.dispose();
  });

  it('a second screen replaces the history: no copy piled on it', async () => {
    const { t, write, lines } = term(2);
    await write(paintScreen(['a', 'b', 'c', 'd'].join('\n'), { x: 0, y: 1 }, MAIN));
    await write(paintScreen(['a', 'b', 'c', 'd', 'e'].join('\n'), { x: 0, y: 1 }, MAIN));
    expect(lines()).toEqual(['a', 'b', 'c', 'd', 'e']);
    t.dispose();
  });

  it('the alternate screen keeps the scrollback as it was (no history comes with it)', () => {
    expect(paintScreen('x', { x: 0, y: 0 }, { ...MAIN, alt: true })).not.toContain('\x1b[3J');
    expect(paintScreen('x', { x: 0, y: 0 }, MAIN)).toContain('\x1b[H\x1b[2J\x1b[3Jx');
  });
});
