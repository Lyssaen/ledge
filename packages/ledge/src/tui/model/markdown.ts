import { parseMarkdown, type Root } from '@ledge/ui/documents/mdast';
import type { Glyphs } from '../glyphs.js';
import { C } from '../theme.js';
import { cut, lineCells, pad, wrapSegs, type Line, type Seg } from './cells.js';

/** What a piece of text inherits from around it: a quote's dim italics, a heading's bold… */
type Style = Omit<Seg, 'text' | 'live'>;
interface Ctx { src: string; g: Glyphs; base: Style; depth: number }

type Point = { line: number; offset?: number };
type Node = { type: string; value?: string; children?: Node[] } & Partial<{ url: string; alt: string | null; label: string | null; position: { start: Point; end: Point } }>;

/** The text of a link (an address as it was typed: its own text). */
const plain = (n: Node): string => n.value ?? n.children?.map(plain).join('') ?? '';

function inline(nodes: readonly Node[], s: Style, ctx: Ctx): Seg[] {
  const out: Seg[] = [];
  for (const n of nodes) {
    switch (n.type) {
      // A soft break is a space: the paragraph wraps at the box's width, not at the source's.
      case 'text': out.push({ ...s, text: n.value!.replace(/\n/g, ' ') }); break;
      case 'break': out.push({ text: '\n' }); break;
      case 'strong': out.push(...inline(n.children!, { ...s, bold: true }, ctx)); break;
      case 'emphasis': out.push(...inline(n.children!, { ...s, italic: true }, ctx)); break;
      case 'delete': out.push(...inline(n.children!, { ...s, strike: true }, ctx)); break;
      case 'highlight': out.push(...inline(n.children!, { ...s, color: C.yellow }, ctx)); break;
      case 'inlineCode': out.push({ ...s, text: n.value!, color: C.fg, bg: C.code, italic: false }); break;
      case 'link': {
        const text = inline(n.children!, { ...s, color: C.blue, underline: true, ...(ctx.g.links ? { link: n.url! } : {}) }, ctx);
        out.push(...text);
        if (ctx.g.links) out.push({ text: ` ${ctx.g.link}`, color: C.faint });
        else if (plain(n) !== n.url && `mailto:${plain(n)}` !== n.url) out.push({ text: ` (${n.url})`, color: C.faint });
        break;
      }
      case 'linkReference': out.push(...inline(n.children!, s, ctx)); break;
      // An image is never fetched: its text stands for it.
      case 'image': case 'imageReference': if (n.alt) out.push({ ...s, text: n.alt, color: C.dim }); break;
      case 'footnoteReference': out.push({ ...s, text: `[^${n.label}]`, color: C.faint }); break;
      default: out.push({ ...s, text: n.value ?? plain(n) });
    }
  }
  return out;
}

/** The source of a node, as it was written. */
const source = (n: Node, ctx: Ctx): string => n.position ? ctx.src.slice(n.position.start.offset, n.position.end.offset) : plain(n);

/** The nodes one under the other, with an empty line where the source had one. */
function blocks(nodes: readonly Node[], width: number, ctx: Ctx): Line[] {
  const out: Line[] = [];
  nodes.forEach((n, i) => {
    const before = nodes[i - 1];
    if (before?.position && n.position && n.position.start.line > before.position.end.line + 1) out.push([]);
    out.push(...block(n, width, ctx));
  });
  return out;
}

/** Lines under a mark: the first after `first`, the others under it, as wide. */
const hang = (first: Line, lines: Line[]): Line[] => {
  const w = lineCells(first);
  return lines.map((l, k) => (k ? [pad(w), ...l] : [...first, ...l]));
};

function block(n: Node, width: number, ctx: Ctx): Line[] {
  const { g } = ctx;
  switch (n.type) {
    case 'paragraph': return wrapSegs(inline(n.children!, ctx.base, ctx), width);
    case 'heading': {
      const depth = (n as { depth?: number }).depth ?? 1;
      return wrapSegs(inline(n.children!, { ...ctx.base, color: depth <= 2 ? C.coral : C.fg, bold: true }, ctx), width);
    }
    case 'code': {
      // No colouring; a long line wrapped, what goes on marked « ↪ ». A block still open while it streams is a block already.
      const lang = (n as { lang?: string | null }).lang;
      const out: Line[] = [[{ text: `${g.codeTop} `, color: C.faint }, { text: lang || 'code', color: C.faint }]];
      for (const l of n.value!.split('\n')) wrapSegs([{ text: l, color: C.fg }], width - 4, width - 2)
        .forEach((x, k) => out.push([{ text: `${g.bar} `, color: C.faint }, ...(k ? [{ text: `${g.cont} `, color: C.faint }] : []), ...x]));
      out.push([{ text: g.codeEnd, color: C.faint }]);
      return out;
    }
    case 'blockquote':
      return blocks(n.children!, width - 2, { ...ctx, base: { ...ctx.base, color: C.dim, italic: true } }).map(l => [{ text: `${g.quote} `, color: C.violet }, ...l]);
    case 'thematicBreak': return [[{ text: g.rule.repeat(Math.max(1, Math.min(40, width))), color: C.faint }]];
    case 'list': {
      const list = n as Node & { ordered?: boolean | null; start?: number | null };
      const start = list.start ?? 1;
      return listItems(list, width, ctx, start, String(start + n.children!.length - 1).length);
    }
    // Out of the subset: a table stays as it was written, cut, not wrapped; HTML and footnotes as they were written.
    case 'table': return source(n, ctx).split('\n').map(l => cut([{ ...ctx.base, text: l, italic: false }], width));
    default: return wrapSegs([{ ...ctx.base, text: source(n, ctx) }], width);
  }
}

/** Each item after its mark (• ◦, 1., ☐ ✓), its lines under its text. */
function listItems(list: Node & { ordered?: boolean | null }, width: number, ctx: Ctx, start: number, wide: number): Line[] {
  const { g } = ctx, out: Line[] = [];
  list.children!.forEach((item, i) => {
    const before = list.children![i - 1];
    if (before?.position && item.position && item.position.start.line > before.position.end.line + 1) out.push([]);
    const checked = (item as { checked?: boolean | null }).checked;
    const mark: Seg = typeof checked === 'boolean' ? { text: `${checked ? g.boxOn : g.boxOff} `, color: checked ? C.green : C.faint }
      : list.ordered ? { text: `${String(start + i).padStart(wide)}. `, color: C.faint }
      : { text: `${ctx.depth ? g.subBullet : g.bullet} `, color: C.faint };
    const body = blocks(item.children!, width - lineCells([mark]), { ...ctx, depth: ctx.depth + 1 });
    out.push(...hang([mark], body.length ? body : [[]]));
  });
  return out;
}

/** The trees of the texts seen lately: a thread draws its texts again at each change, a streamed answer each 100 ms. */
const trees = new Map<string, Root>();
function tree(text: string): Root {
  let t = trees.get(text);
  if (!t) {
    if (trees.size >= 500) trees.delete(trees.keys().next().value!);
    t = parseMarkdown(text);
    trees.set(text, t);
  }
  return t;
}

/** A Markdown text as lines of at most `width` cells, in `color`: the subset the TUI draws (titles, bold, italics, code,
 *  lists, links, quotes, rules); a table, HTML and footnotes as they were written. The parser is packages/ui's. */
export function markdownLines(text: string, o: { width: number; g: Glyphs; color: string }): Line[] {
  const src = text.replace(/\r/g, '');
  return blocks(tree(src).children as Node[], Math.max(10, o.width), { src, g: o.g, base: { color: o.color }, depth: 0 });
}
