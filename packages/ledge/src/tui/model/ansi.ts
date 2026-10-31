import { cells } from './cells.js';

const RESET = '\x1b[0m';
// One escape sequence, or nothing: a CSI (with its final byte), an OSC (to BEL or ST), or an ESC and the one character after it.
const ESC = /\x1b(?:\[([0-?]*[ -/]*)([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\s\S]?)/g;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Keeps the colours (`ESC [ … m`) and removes every other escape: a CSI that is not SGR, an OSC, a lone ESC. */
export function sgrOnly(line: string): string {
  return line.replace(ESC, (all, params: string | undefined, final: string | undefined) => (final === 'm' && /^[0-9;:]*$/.test(params ?? '') ? all : ''));
}

/** `line` (SGR only, see `sgrOnly`) cut to `width` visible cells, never inside a sequence; it ends with a reset so the colours
 *  do not run on into the next row. The sequences that follow the last cell kept are kept too (a closing `ESC [ 39 m`). */
export function cutAnsi(line: string, width: number): string {
  let out = '', used = 0, at = 0;
  const sgr = /\x1b\[[0-9;:]*m/y;
  while (at < line.length) {
    sgr.lastIndex = at;
    const m = sgr.exec(line);
    if (m) { out += m[0]; at += m[0].length; continue; }
    let next = line.indexOf('\x1b', at + 1); if (next < 0) next = line.length;
    let stop = false;
    for (const { segment } of graphemes.segment(line.slice(at, next))) {
      const w = cells(segment);
      if (used + w > width) { stop = true; break; }
      out += segment; used += w; at += segment.length;
    }
    if (stop) break;
  }
  return out + RESET;
}
