import { cells, type Line, type Seg } from './cells.js';

/** What a field holds: its text and where the cursor is, as an offset in the text at a grapheme's start (or its end). */
export type Field = { text: string; cursor: number };

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Where each grapheme starts, then the text's end. */
const stops = (text: string): number[] => [...Array.from(graphemes.segment(text), g => g.index), text.length];

/** What a terminal sends for a newline, made one: a paste from Windows ends its lines in \r\n, an old Mac's in \r. */
export const newlines = (s: string): string => s.replace(/\r\n?/g, '\n');

export const insert = (f: Field, s: string): Field => {
  const add = newlines(s);
  return { text: f.text.slice(0, f.cursor) + add + f.text.slice(f.cursor), cursor: f.cursor + add.length };
};
const before = (f: Field): number => { const a = stops(f.text); let i = a.length - 1; while (i > 0 && a[i]! >= f.cursor) i--; return a[i]! < f.cursor ? a[i]! : 0; };
const after = (f: Field): number => stops(f.text).find(x => x > f.cursor) ?? f.text.length;
export const left = (f: Field): Field => ({ ...f, cursor: before(f) });
export const right = (f: Field): Field => ({ ...f, cursor: after(f) });
export const back = (f: Field): Field => { const to = before(f); return { text: f.text.slice(0, to) + f.text.slice(f.cursor), cursor: to }; };
export const del = (f: Field): Field => ({ text: f.text.slice(0, f.cursor) + f.text.slice(after(f)), cursor: f.cursor });

/** The start of the word before the cursor (spaces skipped first), as readline's alt+b. */
function wordStart(f: Field): number {
  let i = f.cursor;
  while (i > 0 && /\s/.test(f.text[i - 1]!)) i--;
  while (i > 0 && !/\s/.test(f.text[i - 1]!)) i--;
  return i;
}
export const wordLeft = (f: Field): Field => ({ ...f, cursor: wordStart(f) });
/** The end of the word after the cursor, as readline's alt+f. */
export function wordRight(f: Field): Field {
  let i = f.cursor;
  while (i < f.text.length && /\s/.test(f.text[i]!)) i++;
  while (i < f.text.length && !/\s/.test(f.text[i]!)) i++;
  return { ...f, cursor: i };
}
/** ctrl+w: the word before the cursor goes. */
export const killWord = (f: Field): Field => { const to = wordStart(f); return { text: f.text.slice(0, to) + f.text.slice(f.cursor), cursor: to }; };
/** home / end: the start or the end of the line the cursor is on (its own line, not the row it wraps to). */
export const home = (f: Field): Field => ({ ...f, cursor: f.text.lastIndexOf('\n', f.cursor - 1) + 1 });
export const end = (f: Field): Field => { const n = f.text.indexOf('\n', f.cursor); return { ...f, cursor: n < 0 ? f.text.length : n }; };

/** One row of the field on screen: the text from `a` to `b`; `last` when it ends its line (the cursor may then sit at `b`). */
export type Row = { a: number; b: number; last: boolean };

/** The text in rows of `width` cells: its own lines, each wrapped at spaces (the space staying at the end of its row, so that
 *  each place in the text has its cell for the cursor). A grapheme is never split. One cell is kept for the cursor at a
 *  line's end. */
export function layout(text: string, width: number): Row[] {
  const w = Math.max(2, width - 1);
  const a = stops(text), rows: Row[] = [];
  let start = 0;
  for (let i = 0; i < a.length; i++) {
    const at = a[i]!;
    if (at < text.length && text[at] !== '\n') continue;
    // Its own line: from the grapheme `start` to `i`, then the newline.
    if (start === i) rows.push({ a: at, b: at, last: true });
    for (let s = start; s < i;) {
      let n = 0, j = s, space = -1;
      while (j < i) { const c = cells(text.slice(a[j]!, a[j + 1]!)); if (n + c > w) break; if (text[a[j]!] === ' ') space = j; n += c; j++; }
      if (j === s) j = s + 1;
      const e = j < i && space > s ? space + 1 : j;
      rows.push({ a: a[s]!, b: a[e]!, last: e >= i });
      s = e;
    }
    start = i + 1;
  }
  return rows;
}

/** The row the cursor is on. */
export const rowOf = (rows: readonly Row[], cursor: number): number => {
  const k = rows.findIndex(r => cursor >= r.a && (cursor < r.b || (cursor === r.b && r.last)));
  return k < 0 ? rows.length - 1 : k;
};

/** ↑ / ↓: the cursor one row up or down, at the same column as near as the row allows; null on the first or last row. */
export function vertical(f: Field, width: number, by: -1 | 1): Field | null {
  const rows = layout(f.text, width), k = rowOf(rows, f.cursor), to = rows[k + by];
  if (!to) return null;
  const col = cells(f.text.slice(rows[k]!.a, f.cursor));
  // The last place on the row whose column is not past the cursor's; a row that wraps ends before its `b`.
  let cursor = to.a;
  for (const x of stops(f.text)) {
    if (x <= to.a) continue;
    if (x > to.b || (x === to.b && !to.last) || cells(f.text.slice(to.a, x)) > col) break;
    cursor = x;
  }
  return { ...f, cursor };
}

/** The field's rows drawn: `prefix` on the first, its width in spaces on the others; the cursor in inverse (a space after the
 *  text, or on a newline), none when `cursor` is null. Empty, the cursor then `placeholder`. */
export function fieldLines(text: string, cursor: number | null, width: number, o: { prefix: Seg; color: string; placeholder?: Seg }): Line[] {
  const indent: Seg = { text: ' '.repeat(cells(o.prefix.text)) };
  const inv = (t: string): Seg => ({ text: t, color: o.color, inverse: true });
  if (!text) return [[o.prefix, ...(cursor !== null ? [inv(' ')] : []), ...(o.placeholder ? [o.placeholder] : [])]];
  const rows = layout(text, width - cells(o.prefix.text));
  return rows.map((r, k) => {
    const line: Line = [k === 0 ? o.prefix : indent];
    const at = cursor !== null && cursor >= r.a && cursor < r.b ? cursor : -1;
    if (at < 0) line.push({ text: text.slice(r.a, r.b), color: o.color });
    else {
      const next = after({ text, cursor: at });
      if (at > r.a) line.push({ text: text.slice(r.a, at), color: o.color });
      line.push(inv(text.slice(at, Math.min(next, r.b))));
      if (next < r.b) line.push({ text: text.slice(next, r.b), color: o.color });
    }
    if (cursor === r.b && r.last) line.push(inv(' '));
    return line.filter(s => s.text !== '' || s === line[0]);
  });
}

/** The first row shown, `top` moved as little as it takes for the cursor's row to be in the `max` rows shown. */
export const scrollTop = (top: number, row: number, total: number, max: number): number =>
  Math.max(0, Math.min(Math.max(0, total - max), row < top ? row : row >= top + max ? row - max + 1 : top));

/** How many lines the text has, and the one the cursor is on (its own lines, counted from 1). */
export const lineAt = (f: Field): { line: number; lines: number } => ({
  line: f.text.slice(0, f.cursor).split('\n').length,
  lines: f.text.split('\n').length
});
