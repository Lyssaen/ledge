// The row of special keys above the phone's keyboard, and the sticky Ctrl and Alt.

/** « Lisible »: the default font size of the terminal. Zoom stays within the two others. */
export const READABLE_PX = 11;
export const MIN_PX = 6;
export const MAX_PX = 16;

/** A hold ends this long after the last key (the PC's own rule, shown as a countdown). */
export const HOLD_IDLE_MS = 5 * 60_000;

export type Mod = 'ctrl' | 'alt';
export type SpecialKey = 'esc' | 'tab' | 'ctrl' | 'alt' | 'left' | 'up' | 'down' | 'right' | 'enter' | 'interrupt' | 'paste' | 'line';

const ARROWS = { up: 'A', down: 'B', right: 'C', left: 'D' } as const;

/** What a key of the row types; an arrow follows the pane's cursor mode (`ESC O` in application mode). */
export function keyBytes(k: Exclude<SpecialKey, 'ctrl' | 'alt' | 'paste' | 'line'>, appCursor: boolean): string {
  switch (k) {
    case 'esc': return '\x1b';
    case 'tab': return '\t';
    case 'enter': return '\r';
    case 'interrupt': return '\x03';
    default: return `${appCursor ? '\x1bO' : '\x1b['}${ARROWS[k]}`;
  }
}

/**
 * The armed modifiers on one key: Ctrl makes a letter (and `@[\]^_`, space, `?`) its control byte, Alt puts ESC before it.
 * A sequence (an arrow, a paste) gets Alt only: xterm's own modified arrows are not what a phone user means.
 */
export function withModifiers(data: string, m: { ctrl: boolean; alt: boolean }): string {
  let out = data;
  if (m.ctrl && [...data].length === 1) {
    const c = data.toUpperCase().charCodeAt(0);
    if (c >= 0x40 && c <= 0x5f) out = String.fromCharCode(c - 0x40);
    else if (data === ' ') out = '\x00';
    else if (data === '?') out = '\x7f';
  }
  return m.alt ? `\x1b${out}` : out;
}
