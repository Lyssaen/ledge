import { describe, expect, it } from 'vitest';
import { cutAnsi, sgrOnly } from '../src/tui/model/ansi.js';

describe('ansi', () => {
  it('sgrOnly keeps colors and drops other escapes', () => {
    expect(sgrOnly('\x1b[32m● ok\x1b[0m\x1b]0;title\x07\x1b[2K')).toBe('\x1b[32m● ok\x1b[0m');
    expect(sgrOnly('a\x1bb\x1b[?25lc\x1b]8;;http://x\x1b\\d')).toBe('acd');
  });
  it('cutAnsi counts visible cells and never cuts inside a sequence', () => {
    expect(cutAnsi('\x1b[38;5;77m● Bash\x1b[39m(pnpm dev)', 6)).toBe('\x1b[38;5;77m● Bash\x1b[39m\x1b[0m');
    expect(cutAnsi('\x1b[38;5;77mabcdef', 3)).toBe('\x1b[38;5;77mabc\x1b[0m');
    expect(cutAnsi('日本語', 5)).toBe('日本\x1b[0m');
  });
  it('cutAnsi resets at the end of every line', () => {
    expect(cutAnsi('\x1b[31mrouge', 20).endsWith('\x1b[0m')).toBe(true);
    expect(cutAnsi('plain', 20)).toBe('plain\x1b[0m');
  });
});
