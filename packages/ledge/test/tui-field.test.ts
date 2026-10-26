import { describe, it, expect } from 'vitest';
import { back, del, end, fieldLines, home, insert, killWord, layout, left, lineAt, right, rowOf, scrollTop, vertical, wordLeft, wordRight, type Field } from '../src/tui/model/field.js';
import { cells } from '../src/tui/model/cells.js';

/** The field written with | where the cursor is. */
const at = (s: string): Field => ({ text: s.replace('|', ''), cursor: s.indexOf('|') });
const show = (f: Field): string => f.text.slice(0, f.cursor) + '|' + f.text.slice(f.cursor);
const rows = (text: string, width: number) => layout(text, width).map(r => text.slice(r.a, r.b));

describe('tui field', () => {
  it('moves by grapheme: an emoji with its modifier, an accent, is one step', () => {
    expect(show(left(at('ok 👍🏽|')))).toBe('ok |👍🏽');
    expect(show(right(at('|é!')))).toBe('é|!');
    expect(show(back(at('a✅|b')))).toBe('a|b');
    expect(show(del(at('a|✅b')))).toBe('a|b');
    expect(show(left(at('|a')))).toBe('|a');
    expect(show(right(at('a|')))).toBe('a|');
  });

  it('moves and deletes by word, as readline', () => {
    expect(show(wordLeft(at('garde DIFF_MAX à 30|')))).toBe('garde DIFF_MAX à |30');
    expect(show(wordLeft(at('garde DIFF_MAX   |')))).toBe('garde |DIFF_MAX   ');
    expect(show(wordRight(at('|garde DIFF_MAX')))).toBe('garde| DIFF_MAX');
    expect(show(wordRight(at('garde| DIFF_MAX')))).toBe('garde DIFF_MAX|');
    expect(show(killWord(at('garde DIFF_MAX |à 30')))).toBe('garde |à 30');
  });

  it('home and end go to the start and end of the cursor’s own line', () => {
    expect(show(home(at('un\ndeux tr|ois\nquatre')))).toBe('un\n|deux trois\nquatre');
    expect(show(end(at('un\nde|ux trois\nquatre')))).toBe('un\ndeux trois|\nquatre');
    expect(show(end(at('un\ndeux tr|ois')))).toBe('un\ndeux trois|');
  });

  it('a newline typed or pasted is a newline; \\r\\n and \\r too', () => {
    expect(show(insert(at('a|b'), '\n'))).toBe('a\n|b');
    expect(show(insert(at('|'), 'un\r\ndeux\rtrois'))).toBe('un\ndeux\ntrois|');
  });

  it('lays the text out in rows: its own lines, wrapped at spaces by cells, one cell kept for the cursor', () => {
    // 10 cells, 9 for text: « Tests verts » wraps after the space, which stays at the end of its row.
    expect(rows('Tests verts ✅', 10)).toEqual(['Tests ', 'verts ✅']);
    expect(rows('un\n\ndeux', 20)).toEqual(['un', '', 'deux']);
    expect(rows('fin\n', 20)).toEqual(['fin', '']);
    expect(rows('', 20)).toEqual(['']);
    for (const r of rows('Garde un test avec des caractères larges (日本語) en fin de ligne 🎯 ✅ 🚀', 17)) expect(cells(r)).toBeLessThanOrEqual(16);
    // A word longer than the row is cut where it must.
    expect(rows('abcdefghij', 6)).toEqual(['abcde', 'fghij']);
  });

  it('finds the cursor’s row; at a wrap it is at the start of the next one', () => {
    const r = layout('Tests verts ✅', 10);
    expect(rowOf(r, 0)).toBe(0);
    expect(rowOf(r, 6)).toBe(1);
    expect(rowOf(r, 'Tests verts ✅'.length)).toBe(1);
  });

  it('↑ ↓ go from row to row at the same column; null on the first and the last', () => {
    expect(show(vertical(at('un\ndeux tr|ois'), 40, -1)!)).toBe('un|\ndeux trois');
    expect(show(vertical(at('u|n\ndeux trois'), 40, 1)!)).toBe('un\nd|eux trois');
    expect(vertical(at('u|n\ndeux'), 40, -1)).toBeNull();
    expect(vertical(at('un\nde|ux'), 40, 1)).toBeNull();
    // Over a wrap: the column kept, the cursor never past the wrapped row's end.
    expect(show(vertical(at('Tests verts ✅ fin|'), 10, -1)!)).toBe('Tests ver|ts ✅ fin');
    expect(show(vertical(at('ab cdefg|'), 6, -1)!)).toBe('ab| cdefg');
  });

  it('draws the rows with the prefix, the indent, and the cursor in inverse (a space at a line’s end)', () => {
    const o = { prefix: { text: '❯ ', color: 'coral' }, color: 'fg' };
    const text = (l: { text: string }[][]) => l.map(x => x.map(s => s.text).join(''));
    const lines = fieldLines('un\ndeux', 2, 20, o);
    expect(text(lines)).toEqual(['❯ un ', '  deux']);
    expect(lines[0]!.at(-1)).toEqual({ text: ' ', color: 'fg', inverse: true });
    const mid = fieldLines('un\ndeux', 4, 20, o);
    expect(mid[1]!.find(s => s.inverse)?.text).toBe('e');
    expect(text(fieldLines('', 0, 20, { ...o, placeholder: { text: 'Une question…', color: 'faint' } }))).toEqual(['❯  Une question…']);
    expect(fieldLines('ok', null, 20, o).flat().some(s => s.inverse)).toBe(false);
  });

  it('scrolls only as much as the cursor’s row needs; says which line it is on', () => {
    expect(scrollTop(0, 7, 14, 6)).toBe(2);
    expect(scrollTop(5, 3, 14, 6)).toBe(3);
    expect(scrollTop(4, 6, 14, 6)).toBe(4);
    expect(scrollTop(9, 13, 10, 6)).toBe(4);
    expect(lineAt(at('un\ndeux\ntr|ois'))).toEqual({ line: 3, lines: 3 });
  });
});
