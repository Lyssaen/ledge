import stringWidth from 'string-width';

/** What a piece of a line shows that the clock changes: the spinner's frame, or the time since `since` padded to `pad` cells.
 *  Its `text` is only the value when the line was made; `ui/Lines.tsx` draws it again on each tick, alone. */
export type Live = { spin: true } | { since: number; pad: number };
/** A piece of a line, with its colour and attributes; `bg` a background, `link` the address it opens (OSC 8). */
export type Seg = {
  text: string; color?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; inverse?: boolean;
  link?: string; live?: Live;
};
export type Line = Seg[];

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** How many terminal cells `s` takes, as Ink measures it: an emoji or a character like 日 two, a combining accent none. */
export const cells = (s: string): number => stringWidth(s);
export const lineCells = (line: Line): number => line.reduce((n, s) => n + cells(s.text), 0);
export const pad = (n: number): Seg => ({ text: ' '.repeat(Math.max(0, n)) });

type Cell = { g: string; w: number; seg: number };
const split = (line: Line): Cell[] => line.flatMap((s, seg) => Array.from(graphemes.segment(s.text), x => ({ g: x.segment, w: cells(x.segment), seg })));
/** The cells back into pieces, each with its own piece's colour. */
function join(line: Line, a: Cell[]): Line {
  const out: Line = [];
  for (const c of a) {
    const last = out[out.length - 1];
    if (last && (last as { seg?: number }).seg === c.seg) last.text += c.g;
    else out.push(Object.assign({ ...line[c.seg]!, text: c.g }, { seg: c.seg }));
  }
  for (const s of out) delete (s as { seg?: number }).seg;
  return out;
}

/** `line` cut to `width` cells, ending with `ellipsis` when something was cut. */
export function cut(line: Line, width: number, ellipsis = '…'): Line {
  if (lineCells(line) <= width) return line;
  const a = split(line), room = width - cells(ellipsis);
  let n = 0, i = 0;
  while (i < a.length && n + a[i]!.w <= room) n += a[i++]!.w;
  const kept = join(line, a.slice(0, i));
  const color = line[a[Math.max(0, i - 1)]?.seg ?? 0]?.color;
  return [...kept, { text: ellipsis, ...(color ? { color } : {}) }];
}

/** The pieces wrapped into lines of at most `width` cells (`first` for the first one), at spaces when they can; their own
 *  newlines kept. A grapheme is never split, an emoji with its modifier or a ZWJ sequence included. */
export function wrapSegs(line: Line, width: number, first = width): Line[] {
  const a = split(line);
  if (a.length === 0) return [[]];
  const out: Line[] = [];
  let i = 0, w = Math.max(4, first);
  while (i < a.length) {
    let n = 0, j = i, space = -1;
    while (j < a.length && a[j]!.g !== '\n') { if (n + a[j]!.w > w) break; if (a[j]!.g === ' ') space = j; n += a[j]!.w; j++; }
    w = Math.max(4, width);
    if (j >= a.length || a[j]!.g === '\n') { out.push(join(line, a.slice(i, j))); i = j + 1; if (j >= a.length) break; if (i >= a.length) out.push([]); continue; }
    // A grapheme wider than the whole line still goes, alone.
    const end = a[j]!.g === ' ' ? j : space > i ? space : Math.max(j, i + 1);
    let k = end; while (k > i && a[k - 1]!.g === ' ') k--;
    out.push(join(line, a.slice(i, k)));
    i = end; while (i < a.length && a[i]!.g === ' ') i++;
    // The line ended at its spaces, then its newline: that newline is this line's end, not an empty line.
    if (a[i]?.g === '\n') { i++; if (i >= a.length) out.push([]); }
  }
  return out;
}

/** One element of the thread: `prefix`, then `body` wrapped under a hanging indent (`indent` cells, the prefix's width by
 *  default), `meta` right-aligned on the first line; at most `max` lines, the last one then saying how many are left. */
export function row(prefix: Line, body: Line, meta: Line | null, width: number, o: { indent?: number; max?: number; more?: Seg } = {}): Line[] {
  const pw = lineCells(prefix), mw = meta?.length ? lineCells(meta) + 2 : 0, ind = o.indent ?? pw, max = o.max ?? Infinity;
  let lines = wrapSegs(body, width - ind - mw, width - pw - mw);
  if (lines.length > max) {
    const tag = { ...(o.more ?? { text: '' }), text: `${o.more?.text ?? ' …'} +${lines.length - max + 1}` };
    lines = lines.slice(0, max);
    const last = max - 1, room = (last === 0 ? width - pw - mw : width - ind - mw) - cells(tag.text);
    lines[last] = [...cut(lines[last]!, room), tag];
  }
  return lines.map((l, k) => {
    if (k > 0) return [pad(ind), ...l];
    const left = [...prefix, ...l];
    return meta?.length ? [...left, pad(width - lineCells(left) - lineCells(meta)), ...meta] : left;
  });
}
