import { useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openUrl } from '../tauri/bridge';
import { parseDocumentReference, type DocumentReference } from './references';
import './markdown.css';

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

/** HTML is never parsed. Images are rendered as text, so their URLs are never fetched. */
export function MarkdownDocument({ text, onDocument, onHeadings }: { text: string; onDocument: (ref: DocumentReference) => void; onHeadings: (headings: DocumentHeading[]) => void }) {
  const { source, headings, plugin } = useMemo(() => {
    const heads: DocumentHeading[] = [];
    const plugin = () => (tree: Node) => { heads.splice(0, heads.length, ...documentHeadings(tree)); };
    const source = splitMarkdownFrontmatter(text).body;
    return { source, headings: heads, plugin };
  }, [text]);
  useEffect(() => { onHeadings(headings); }, [headings, onHeadings]);
  return <div className="ledge-document" data-document-body>
    <Markdown remarkPlugins={[remarkGfm, plugin]} components={{
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        if (href.startsWith('#')) return <a href={href} onClick={e => { e.preventDefault(); document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView(); }}>{children}</a>;
        const ref = parseDocumentReference(href);
        if (ref) return <a href={href} onClick={e => { e.preventDefault(); onDocument(ref); }}>{children}</a>;
        if (/^https?:\/\//i.test(href)) return <a href={href} onClick={e => { e.preventDefault(); void openUrl(href); }}>{children}</a>;
        return <span>{children}</span>;
      },
      img({ alt, src }) { return <span className="ledge-document-image">{alt || 'Image'}{src ? ` (${src})` : ''}</span>; },
      input({ type, checked }) { return type === 'checkbox' ? <input type="checkbox" checked={checked} readOnly disabled /> : null; }
    }}>{source}</Markdown>
  </div>;
}
