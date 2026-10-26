import type { Root } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export type { Root } from 'mdast';

type Node = { type: string; value?: string; children?: Node[]; data?: { hName?: string } };

/** `==text==` becomes a highlight (<mark>), as most Markdown editors read it; GFM has no such mark. Inline code and code
 *  blocks are left alone, and the mark does not span other inline marks. */
const HIGHLIGHT = /==(?=\S)([^=\n]*?\S)==/g;
export function remarkHighlight() {
  const visit = (n: Node) => {
    if (!n.children) return;
    n.children = n.children.flatMap(c => {
      if (c.type !== 'text' || !c.value?.includes('==')) { visit(c); return [c]; }
      const out: Node[] = []; let last = 0;
      for (const m of c.value.matchAll(HIGHLIGHT)) {
        if (m.index > last) out.push({ type: 'text', value: c.value.slice(last, m.index) });
        out.push({ type: 'highlight', data: { hName: 'mark' }, children: [{ type: 'text', value: m[1]! }] });
        last = m.index + m[0].length;
      }
      if (last === 0) return [c];
      if (last < c.value.length) out.push({ type: 'text', value: c.value.slice(last) });
      return out;
    });
  };
  return (tree: Node) => visit(tree);
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkHighlight);

/** The Markdown tree the reader and the threads render (remark, GFM, highlights), for a renderer without the DOM: the TUI.
 *  A highlight is a node of type `highlight`. */
export function parseMarkdown(text: string): Root {
  return processor.runSync(processor.parse(text)) as Root;
}
