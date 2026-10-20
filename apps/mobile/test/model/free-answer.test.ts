import { describe, expect, it } from 'vitest';
import { checkFreeAnswer, OTHER_MAX } from '../../src/model/freeAnswer';

describe('checkFreeAnswer', () => {
  it('trims and accepts one plain line', () => expect(checkFreeAnswer('  Thème sombre 👩‍💻  ')).toEqual({ text: 'Thème sombre 👩‍💻', problem: null }));
  it('refuses empty, too long, line breaks, control characters and bidi overrides', () => {
    expect(checkFreeAnswer('   ').problem).toBe('empty');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX + 1)).problem).toBe('long');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX)).problem).toBeNull();
    for (const bad of ['a\nb', 'a\r', 'a\tb', 'a\u001b[31m', 'a\u0085', 'a‮b', 'a​b', 'ok\n']) expect(checkFreeAnswer(bad).problem).toBe('untypable');
  });
});
