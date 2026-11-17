// The terminal's wheel (spec 2026-11-17-terminal-wheel, docs/mockups/terminal-wheel): as many lines per notch as Settings say,
// in a terminal's history as in a program that tracks the mouse, where xterm.js would send one report per wheel event.

/** How the program asked mouse reports to be written: `other` is one Desktop does not write (SGR pixels), left to xterm. */
export type WheelEncoding = 'default' | 'sgr' | 'other';

export interface WheelMods { shift: boolean; alt: boolean; ctrl: boolean }

/** Settings › Workspace › Terminaux: like Windows, or `lines` per notch. `lines` is kept while Windows decides, for the stepper. */
export interface WheelPref { mode: 'system' | 'fixed'; lines: number }

const PIXEL = 0, PAGE = 2;
/** Chromium on Windows turns a notch into 100/3 px for each line Windows scrolls (Settings › Mouse, 3 by default). */
const PX_PER_WINDOWS_LINE = 100 / 3;
/** A notch in `wheelDeltaY`, whatever Windows makes of it in pixels; 100 px when the event has none. */
const NOTCH = 120, NOTCH_PX = 100;

/**
 * The lines a wheel event is worth, negative up. Like Windows: its pixels in Windows lines, a page (« one screen at a time ») as
 * the screen. A speed chosen: the notches times that speed. The fraction (a touchpad's small steps) is carried in `partial`;
 * never more than a screen per event.
 */
export function wheelLines(ev: { deltaY: number; deltaMode: number; wheelDeltaY?: number }, pref: WheelPref, rows: number, partial: number): { lines: number; partial: number } {
  if (ev.deltaY === 0) return { lines: 0, partial };
  if (ev.deltaMode === PAGE) return { lines: Math.sign(ev.deltaY) * rows, partial: 0 };
  let amount: number;
  if (pref.mode === 'system') amount = ev.deltaMode === PIXEL ? ev.deltaY / PX_PER_WINDOWS_LINE : ev.deltaY;
  else if (ev.wheelDeltaY) amount = (-ev.wheelDeltaY / NOTCH) * pref.lines;
  else amount = (ev.deltaMode === PIXEL ? ev.deltaY / NOTCH_PX : Math.sign(ev.deltaY)) * pref.lines;
  // A fraction left the other way would swallow the first step back.
  if (partial * amount < 0) partial = 0;
  partial += amount;
  // Chromium's pixels are rounded floats: a line may come as 0.99999996 of one, which must still be a line.
  const lines = Math.trunc(partial + Math.sign(partial) * 1e-3);
  partial -= lines;
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
