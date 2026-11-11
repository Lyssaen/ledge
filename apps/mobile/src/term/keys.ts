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

/** A context key's word (m2-sessions.html §6): fixed, from how the option begins; null for an option it does not know. */
export type ContextWord = 'yes' | 'always' | 'no' | null;

/**
 * The numbered choice on screen (« ❯ 1. Oui », « 2. Oui, toujours… », « 3. Non… »), as context keys: each option's digit and
 * its word. « Oui, toujours » or « Yes, and don't ask » give Toujours; Oui / Yes give Oui; Non / No give Non; any other its
 * digit alone. Empty when no row shows « ❯ 1. » (QUESTIONS.md, « M2b · Le terminal » 3).
 */
export function contextKeys(rows: readonly string[]): { digit: string; word: ContextWord }[] {
  const start = rows.findIndex(r => /❯\s*1\.\s/.test(r));
  if (start < 0) return [];
  const keys: { digit: string; word: ContextWord }[] = [];
  // An option may wrap: rows without a digit are its continuation, up to a dozen rows below the first.
  for (const row of rows.slice(start, start + 12)) {
    const m = /^\s*(?:❯\s*)?(\d)\.\s+(.*)$/.exec(row);
    if (!m) continue;
    if (m[1] !== String(keys.length + 1)) break;
    const text = m[2]!.trim();
    const word: ContextWord = /^(oui,?\s+toujours|yes,?\s+and\s+don.t\s+ask)/i.test(text) ? 'always'
      : /^(oui|yes)\b/i.test(text) ? 'yes' : /^(non|no)\b/i.test(text) ? 'no' : null;
    keys.push({ digit: m[1]!, word });
  }
  return keys;
}
