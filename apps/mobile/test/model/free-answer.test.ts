import { describe, expect, it } from 'vitest';
import { checkFreeAnswer, OTHER_MAX } from '../../src/model/freeAnswer';

describe('checkFreeAnswer', () => {
  it('trims and accepts one plain line', () => expect(checkFreeAnswer('  Thème sombre 👩‍💻  ')).toEqual({ text: 'Thème sombre 👩‍💻', problem: null }));
  it('refuses empty, too long, line breaks, control characters and bidi overrides', () => {
    expect(checkFreeAnswer('   ').problem).toBe('empty');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX + 1)).problem).toBe('long');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX)).problem).toBeNull();
    for (const bad of ['a\nb', 'a\r\nb', 'a\tb', 'a\u001b[31m', 'a\u0085', 'a‮b', 'a​b']) expect(checkFreeAnswer(bad).problem).toBe('untypable');
  });
  it('checks the text as it will be sent: a trailing line break goes with the trim, as on the PC', () => {
    expect(checkFreeAnswer('Bleu\n')).toEqual({ text: 'Bleu', problem: null });
  });
  it('refuses a lone digit, which the PC would read as the number of an option', () => {
    for (const d of ['1', ' 2 ', '9']) expect(checkFreeAnswer(d).problem).toBe('digit');
    for (const ok of ['0', '10', '2 fois']) expect(checkFreeAnswer(ok).problem).toBeNull();
  });
});
