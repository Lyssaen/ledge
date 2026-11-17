// The wheel over a program that tracks the mouse (spec 2026-11-17-terminal-wheel): xterm.js sends one report per wheel event,
// however far it goes, so Desktop writes one per line instead.

/** How the program asked mouse reports to be written: `other` is one Desktop does not write (SGR pixels), left to xterm. */
export type WheelEncoding = 'default' | 'sgr' | 'other';

export interface WheelMods { shift: boolean; alt: boolean; ctrl: boolean }

const PIXEL = 0, PAGE = 2;

/**
 * The lines a wheel event is worth, counted as xterm counts them for its own scrollback: pixels over a row's height, the
 * remainder (`partial`) carried to the next event; lines as they are; a page as the screen. Never more than a screen.
 * Negative is up.
 */
export function wheelLines(ev: { deltaY: number; deltaMode: number }, rowPx: number, rows: number, partial: number): { lines: number; partial: number } {
  if (ev.deltaY === 0) return { lines: 0, partial };
  let lines: number;
  if (ev.deltaMode === PIXEL) {
    partial += ev.deltaY / rowPx;
    lines = Math.trunc(partial);
    partial -= lines;
  } else {
    lines = Math.trunc(ev.deltaMode === PAGE ? ev.deltaY * rows : ev.deltaY);
  }
  return { lines: Math.max(-rows, Math.min(rows, lines)), partial };
}

/** One wheel report at a cell (from 1), `dir` -1 up and 1 down; null when the encoding cannot hold it. */
export function wheelReport(dir: -1 | 1, col: number, row: number, mods: WheelMods, enc: WheelEncoding): string | null {
  const button = (dir < 0 ? 64 : 65) | (mods.shift ? 4 : 0) | (mods.alt ? 8 : 0) | (mods.ctrl ? 16 : 0);
  if (enc === 'sgr') return `\x1b[<${button};${col};${row}M`;
  // The default encoding puts each number in one byte, offset by 32. The input travels as text and reaches tmux as UTF-8, where
  // a byte past 127 would become two: past 95 the report is not written (xterm itself sends none here, its binary reports are
  // not wired).
  if (enc === 'default' && col <= 95 && row <= 95) return '\x1b[M' + String.fromCharCode(32 + button, 32 + col, 32 + row);
  return null;
}
