import { describe, expect, it } from 'vitest';
import { keyBytes } from '../src/panes/keys.js';

describe('keyBytes', () => {
  it.each([['Enter', '\r'], ['Escape', '\x1b'], ['C-c', '\x03'], ['C-u', '\x15'], ['Up', '\x1b[A'], ['Down', '\x1b[B'],
    ['Right', '\x1b[C'], ['Left', '\x1b[D'], ['Tab', '\t'], ['BTab', '\x1b[Z'], ['BSpace', '\x7f'], ['Space', ' '], ['1', '1'], ['y', 'y']])
  ('%s', (k, b) => expect(keyBytes(k)).toBe(b));
  it('refuses an unknown name', () => expect(() => keyBytes('F13')).toThrow('unknown key: F13'));
});
