import { describe, it, expect } from 'vitest';
import { cells, cut, row, wrapSegs } from '../src/tui/model/cells.js';

const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join(''));

describe('tui cells', () => {
  it('counts an emoji and a wide character as two cells, an accent as none', () => {
    expect(cells('abc')).toBe(3);
    expect(cells('✅')).toBe(2);
    expect(cells('日本語')).toBe(6);
    expect(cells('é')).toBe(1);
    expect(cells('é')).toBe(1);
    expect(cells('👍🏽')).toBe(2);
  });

  it('wraps at spaces by cells, never past the width, its own newlines kept', () => {
    // By code points « Tests verts ✅ » is 13 long and fits in 13; by cells it is 14.
    expect(text(wrapSegs([{ text: 'Tests verts ✅' }], 13))).toEqual(['Tests verts', '✅']);
    expect(text(wrapSegs([{ text: '日本語のテキスト' }], 7))).toEqual(['日本語', 'のテキ', 'スト']);
    expect(text(wrapSegs([{ text: 'un\ndeux trois' }], 20))).toEqual(['un', 'deux trois']);
    for (const l of wrapSegs([{ text: 'Garde un test avec des caractères larges (日本語) en fin de ligne 🎯 ✅ 🚀' }], 17)) expect(cells(l.map(s => s.text).join(''))).toBeLessThanOrEqual(17);
  });

  it('keeps an emoji with its modifier whole', () => {
    expect(text(wrapSegs([{ text: 'ok 👍🏽 oui' }], 4))).toEqual(['ok', '👍🏽', 'oui']);
  });

  it('keeps each piece its colour across a wrap', () => {
    const lines = wrapSegs([{ text: 'rouge', color: 'r' }, { text: ' vert vert', color: 'g' }], 10);
    expect(lines).toEqual([[{ text: 'rouge', color: 'r' }, { text: ' vert', color: 'g' }], [{ text: 'vert', color: 'g' }]]);
  });

  it('cuts to a width with an ellipsis, by cells', () => {
    expect(text([cut([{ text: 'abcdef' }], 4)])).toEqual(['abc…']);
    expect(text([cut([{ text: 'ab✅cd' }], 4)])).toEqual(['ab…']);
    expect(text([cut([{ text: 'abc' }], 4)])).toEqual(['abc']);
  });

  it('a row: prefix, the body under a hanging indent, the meta right of the first line, at most max lines then « … +n »', () => {
    const lines = text(row([{ text: '  ✓ Bash   ' }], [{ text: 'pnpm --filter @ledge/ledge exec vitest run test/tui-model.test.ts --reporter=dot' }], [{ text: '8,4 s' }], 40, { max: 2 }));
    expect(lines).toEqual([
      '  ✓ Bash   pnpm --filter           8,4 s',
      '           @ledge/ledge exec … +4'
    ]);
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(40);
    expect(text(row([{ text: '  ✉ ' }], [{ text: 'un deux trois quatre' }], null, 14, { indent: 4 }))).toEqual(['  ✉ un deux', '    trois', '    quatre']);
  });
});
