import { createContext, useContext, useEffect, useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseDocumentReference, type DocumentReference } from './references';
import './markdown.css';

/** Opens a web address (the overlay and Desktop put their openUrl here); by default, nothing. */
export const MarkdownLinks = createContext<(url: string) => void>(() => {});

export interface DocumentHeading { id: string; depth: number; text: string }
export function splitMarkdownFrontmatter(text: string): { title?: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { body: text };
  const titleLine = /^title:[ \t]*(.+)$/m.exec(match[1]!);
  const value = titleLine?.[1]?.trim();
  const title = value?.replace(/^(["'])(.*)\1$/, '$2').trim();
  return { body: text.slice(match[0].length), ...(title ? { title } : {}) };
}
type Node = { type: string; value?: string; depth?: number; children?: Node[]; data?: { hProperties?: Record<string, string> } };
const plain = (n: Node): string => n.value ?? n.children?.map(plain).join('') ?? '';
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
export function documentHeadings(root: Node): DocumentHeading[] {
  const headings: DocumentHeading[] = [], counts = new Map<string, number>(), used = new Set<string>();
  const visit = (n: Node) => {
    if (n.type === 'heading') {
      const text = plain(n), base = slug(text);
      let count = counts.get(base) ?? 0;
      let id = count ? `${base}-${count}` : base;
      while (used.has(id)) { count++; id = `${base}-${count}`; }
      counts.set(base, count + 1); used.add(id);
      n.data = { ...n.data, hProperties: { ...n.data?.hProperties, id } };
      headings.push({ id, depth: n.depth ?? 1, text });
    }
    n.children?.forEach(visit);
  };
  visit(root); return headings;
}

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
        out.push({ type: 'highlight', data: { hName: 'mark' }, children: [{ type: 'text', value: m[1]! }] } as Node);
        last = m.index + m[0].length;
      }
      if (last === 0) return [c];
      if (last < c.value.length) out.push({ type: 'text', value: c.value.slice(last) });
      return out;
    });
  };
  return (tree: Node) => visit(tree);
}

/** Links open where Ledge can: a Markdown document in the reader, a web address in the browser, an anchor in place.
 *  Without a reader, a document link stays text. Images are rendered as text, so their URLs are never fetched. */
export function markdownComponents(onDocument?: (ref: DocumentReference) => void, openUrl: (url: string) => void = () => {}): Components {
  return {
    a({ href, children }) {
      if (!href) return <span>{children}</span>;
      if (href.startsWith('#')) return <a href={href} onClick={e => { e.preventDefault(); document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); }}>{children}</a>;
      const ref = parseDocumentReference(href);
      if (ref) return onDocument ? <a href={href} onClick={e => { e.preventDefault(); onDocument(ref); }}>{children}</a> : <span>{children}</span>;
      if (/^https?:\/\//i.test(href)) return <a href={href} onClick={e => { e.preventDefault(); openUrl(href); }}>{children}</a>;
      return <span>{children}</span>;
    },
    img({ alt, src }) { return <span className="ledge-document-image">{alt || 'Image'}{src ? ` (${src})` : ''}</span>; },
    input({ type, checked }) { return type === 'checkbox' ? <input type="checkbox" checked={checked} readOnly disabled /> : null; }
  };
}

/** HTML is never parsed. */
export function MarkdownDocument({ text, onDocument, onHeadings }: { text: string; onDocument: (ref: DocumentReference) => void; onHeadings: (headings: DocumentHeading[]) => void }) {
  const { source, headings, plugin } = useMemo(() => {
    const heads: DocumentHeading[] = [];
    const plugin = () => (tree: Node) => { heads.splice(0, heads.length, ...documentHeadings(tree)); };
    const source = splitMarkdownFrontmatter(text).body;
    return { source, headings: heads, plugin };
  }, [text]);
  useEffect(() => { onHeadings(headings); }, [headings, onHeadings]);
  const openUrl = useContext(MarkdownLinks);
  const components = useMemo(() => markdownComponents(onDocument, openUrl), [onDocument, openUrl]);
  return <div className="ledge-document" data-document-body>
    <Markdown remarkPlugins={[remarkGfm, remarkHighlight, plugin]} components={components}>{source}</Markdown>
  </div>;
}

/** An agent's message inside a session's thread: the same Markdown as a document, set at the thread's size. */
export function ThreadMarkdown({ text, onDocument }: { text: string; onDocument?: (ref: DocumentReference) => void }) {
  const openUrl = useContext(MarkdownLinks);
  const components = useMemo(() => markdownComponents(onDocument, openUrl), [onDocument, openUrl]);
  return <div className="ledge-thread-md" data-markdown>
    <Markdown remarkPlugins={[remarkGfm, remarkHighlight]} components={components}>{text}</Markdown>
  </div>;
}
