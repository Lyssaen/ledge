import type { ReactNode } from 'react';
import { findDocumentReferences, parseDocumentReference, type DocumentReference } from '../documents/references';

const mono = "'Geist Mono', ui-monospace, monospace";
/** One inline token, first match wins: a code span (nothing is read inside it), a web link, a bare web address, bold,
 *  struck, italic. Bold and struck spans may hold other tokens; a star or underscore glued to a word (`2*3`,
 *  `snake_case`) is text. A bare address stops before whitespace and gives back the punctuation that closes the
 *  sentence around it (`.`, `,`, a `)` it did not open). */
const TOKEN = /(?<code>`[^`\n]+`)|\[(?<ltext>[^\]\n]+)\]\((?<lurl>(?:[^()\n]|\([^()\n]*\))+)\)|(?<url>https?:\/\/[^\s<>]+)|\*\*(?<b1>\S(?:.*?\S)?)\*\*(?!\*)|__(?<b2>\S(?:.*?\S)?)__(?!_)|~~(?<s>\S(?:.*?\S)?)~~|(?<![\w*])\*(?<i1>[^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])|(?<![\w_])_(?<i2>[^\s_](?:[^_\n]*?[^\s_])?)_(?![\w_])/g;
const codeStyle: React.CSSProperties = { fontFamily: mono, fontSize: '0.92em', background: 'var(--muted)', padding: '1px 5px', borderRadius: 6, overflowWrap: 'anywhere' };
const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--muted-foreground)', textUnderlineOffset: 2 };

/** The address without the sentence punctuation glued to its end; a closing parenthesis is kept only when the address opened one. */
function bareUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, '');
  while (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  return url;
}

/** Inline markdown the agent uses in a line: `code`, [links](https://…) and bare https://… addresses that open in the
 *  browser through `openUrl` (the app's, read from `MarkdownLinks` by the caller), **bold**, *italic*, ~~struck~~; anything
 *  else stays text. */
export function inline(text: string, depth = 0, onLink?: (url: string) => boolean, onDocument?: (ref: DocumentReference) => void, openUrl: (url: string) => void = () => {}): ReactNode[] {
  if (depth > 3) return [text];
  const re = new RegExp(TOKEN.source, 'g');
  const out: ReactNode[] = [];
  const plain = (part: string, offset: number) => {
    if (!onDocument) { out.push(part); return; }
    let from = 0;
    for (const hit of findDocumentReferences(part)) {
      if (hit.start > from) out.push(part.slice(from, hit.start));
      out.push(<a key={`doc-${offset + hit.start}`} href={hit.reference.path} onClick={e => { e.preventDefault(); onDocument(hit.reference); }} style={linkStyle}>{part.slice(hit.start, hit.end)}</a>);
      from = hit.end;
    }
    if (from < part.length) out.push(part.slice(from));
  };
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) plain(text.slice(last, m.index), last);
    const g = m.groups!; const key = m.index;
    if (g.code) {
      const content = g.code.slice(1, -1);
      const document = onDocument ? parseDocumentReference(content) : null;
      out.push(document ? <a key={key} href={document.path} onClick={e => { e.preventDefault(); onDocument?.(document); }} style={linkStyle}><code style={codeStyle}>{content}</code></a> : <code key={key} style={codeStyle}>{content}</code>);
    }
    else if (g.lurl) {
      const url = g.lurl; const doc = onDocument ? parseDocumentReference(url) : null;
      if (doc) out.push(<a key={key} href={doc.path} onClick={e => { e.preventDefault(); onDocument?.(doc); }} style={linkStyle}>{g.ltext}</a>);
      else if (/^(?:https?|ledge):\/\//.test(url)) out.push(<a key={key} href={url} title={url} onClick={e => { e.preventDefault(); if (!onLink?.(url)) openUrl(url); }} style={linkStyle}>{inline(g.ltext!, depth + 1, onLink, onDocument, openUrl)}</a>);
      else out.push(m[0]);
    }
    else if (g.url) {
      const url = bareUrl(g.url);
      out.push(<a key={key} href={url} onClick={e => { e.preventDefault(); openUrl(url); }} style={{ ...linkStyle, overflowWrap: 'anywhere' }}>{url}</a>);
      last = m.index + url.length; re.lastIndex = last; continue;
    }
    else if (g.b1 ?? g.b2) out.push(<strong key={key} style={{ fontWeight: 600 }}>{inline((g.b1 ?? g.b2)!, depth + 1, onLink, onDocument, openUrl)}</strong>);
    else if (g.s) out.push(<s key={key}>{inline(g.s, depth + 1, onLink, onDocument, openUrl)}</s>);
    else out.push(<em key={key}>{inline((g.i1 ?? g.i2)!, depth + 1, onLink, onDocument, openUrl)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) plain(text.slice(last), last);
  return out;
}
