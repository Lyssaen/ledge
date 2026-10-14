import { useState, type ReactNode } from 'react';
import type { Block, Item, ReplyDoc, Section } from '@ledge/client';
import { Button } from '../ui/Button';
import { Icon, ICONS } from '../ui/icons';
import { transition } from '../motion';
import type { Messages } from '../i18n/lang';
import { openUrl } from '../tauri/bridge';
import { findDocumentReferences, parseDocumentReference, type DocumentReference } from '../documents/references';

const mono = "'Geist Mono', ui-monospace, monospace";
const card: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', minWidth: 0 };
const marker: React.CSSProperties = { width: 22, height: 22, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--secondary-foreground)', fontFamily: mono, fontSize: 11, fontWeight: 500, lineHeight: 1 };
const kickerStyle: React.CSSProperties = { fontFamily: mono, fontSize: 11, lineHeight: '16px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted-foreground)' };
const chipStyle: React.CSSProperties = { height: 28, padding: '0 10px', borderRadius: 9999, fontSize: 12, fontWeight: 500 };

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
 *  browser, **bold**, *italic*, ~~struck~~; anything else stays text. */
export function inline(text: string, depth = 0, onLink?: (url: string) => boolean, onDocument?: (ref: DocumentReference) => void): ReactNode[] {
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
      else if (/^(?:https?|ledge):\/\//.test(url)) out.push(<a key={key} href={url} title={url} onClick={e => { e.preventDefault(); if (!onLink?.(url)) openUrl(url); }} style={linkStyle}>{inline(g.ltext!, depth + 1, onLink, onDocument)}</a>);
      else out.push(m[0]);
    }
    else if (g.url) {
      const url = bareUrl(g.url);
      out.push(<a key={key} href={url} onClick={e => { e.preventDefault(); openUrl(url); }} style={{ ...linkStyle, overflowWrap: 'anywhere' }}>{url}</a>);
      last = m.index + url.length; re.lastIndex = last; continue;
    }
    else if (g.b1 ?? g.b2) out.push(<strong key={key} style={{ fontWeight: 600 }}>{inline((g.b1 ?? g.b2)!, depth + 1, onLink, onDocument)}</strong>);
    else if (g.s) out.push(<s key={key}>{inline(g.s, depth + 1, onLink, onDocument)}</s>);
    else out.push(<em key={key}>{inline((g.i1 ?? g.i2)!, depth + 1, onLink, onDocument)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) plain(text.slice(last), last);
  return out;
}

function Check() {
  return <span style={{ ...marker, background: 'var(--status-success-soft)', color: 'var(--success)' }}><Icon {...ICONS.check} size={12} /></span>;
}

function Row({ item, kind, n, onDocument }: { item: Item; kind: Section['kind']; n: number; onDocument?: (ref: DocumentReference) => void }) {
  const done = kind === 'done' || item.checked === true;
  const verified = kind === 'verified';
  const lead = done ? <Check /> : verified ? <Check /> : <span style={marker}>{n}</span>;
  return (
    <li data-item={done ? 'done' : verified ? 'verified' : 'item'} style={card}>
      {lead}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
        <span style={{ fontSize: verified ? 12.5 : 13.5, lineHeight: verified ? '18px' : '19px', fontWeight: verified ? 400 : 500, fontFamily: verified ? mono : undefined, overflowWrap: 'anywhere' }}>{inline(item.text, 0, undefined, onDocument)}</span>
        {item.sub.length > 0 && <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5, lineHeight: '18px', color: 'var(--muted-foreground)' }}>{item.sub.map((s, i) => <span key={i}>{inline(s, 0, undefined, onDocument)}</span>)}</span>}
      </span>
    </li>
  );
}

function QuestionCard({ text, options, n, total, answer, onAnswer, onFree, t, onDocument }: { text: string; options: string[]; n: number; total: number; answer?: string; onAnswer: (opt: string) => void; onFree: () => void; t: Messages; onDocument?: (ref: DocumentReference) => void }) {
  return (
    <div data-question={n} role="group" aria-label={`${t.reply.question} ${n + 1}`} style={{ ...card, borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)' }}>
      <span style={{ ...marker, background: 'var(--status-warning-soft)', color: 'var(--warning)' }}>{total > 1 ? n + 1 : '?'}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flexGrow: 1 }}>
        <span style={{ fontSize: 13.5, lineHeight: '19px', fontWeight: 500, overflowWrap: 'anywhere' }}>{inline(text, 0, undefined, onDocument)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {options.map(o => {
            const on = answer === o;
            return <Button key={o} variant={on ? 'primary' : 'secondary'} size="sm" aria-pressed={on} data-chip onClick={() => onAnswer(o)} style={chipStyle}>{o}</Button>;
          })}
          <Button variant="ghost" size="sm" data-chip-free onClick={onFree} style={{ ...chipStyle, border: '1px solid var(--border)' }}>{t.reply.typeAnswer}</Button>
        </span>
      </span>
    </div>
  );
}

export interface ReplyCardProps {
  doc: ReplyDoc; raw: string; t: Messages;
  onDocument?: (ref: DocumentReference) => void;
  /** The reply field's draft and how to change it: a chip writes the answer there, one line per question. */
  onDraft: (text: string) => void; onFocusReply: () => void;
}

/** The agent's last message, read like a plan: sections with their markers, questions with their option chips. */
export function ReplyCard({ doc, raw, t, onDraft, onFocusReply, onDocument }: ReplyCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answer = (q: number, opt: string) => {
    const next = { ...answers, [q]: opt };
    setAnswers(next);
    const text = doc.questions.length === 1 ? opt : doc.questions.map((_, i) => (next[i] ? `${i + 1}. ${next[i]}` : null)).filter(Boolean).join('\n');
    onDraft(text); onFocusReply();
  };
  const renderBlock = (b: Block, kind: Section['kind'], key: number): ReactNode => {
    if (b.type === 'code') return <pre key={key} className="mono ledge-scroll" style={{ margin: 0, padding: '10px 12px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto' }}>{b.text}</pre>;
    if (b.type === 'quote') {
      return <blockquote key={key} data-quote style={{ margin: 0, padding: '2px 0 2px 10px', borderLeft: '2px solid var(--border)', color: 'var(--muted-foreground)', display: 'flex', flexDirection: 'column', gap: 6 }}>{b.blocks.map((x, i) => renderBlock(x, kind, i))}</blockquote>;
    }
    if (b.type === 'table') {
      const cell = (j: number): React.CSSProperties => ({ padding: '7px 10px', textAlign: b.align[j] ?? 'left', verticalAlign: 'top', overflowWrap: 'anywhere' });
      return (
        <div key={key} className="ledge-scroll" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <table data-table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, lineHeight: '18px' }}>
            <thead><tr>{b.header.map((h, i) => <th key={i} scope="col" style={{ ...cell(i), fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', background: 'var(--well)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{inline(h, 0, undefined, onDocument)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ ...cell(j), borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>{inline(c, 0, undefined, onDocument)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    if (b.type === 'p') {
      if (b.q !== undefined) { const q = doc.questions[b.q]!; return <QuestionCard key={key} text={q.text} options={q.options} n={b.q} total={doc.questions.length} answer={answers[b.q]} onAnswer={o => answer(b.q!, o)} onFree={onFocusReply} t={t} onDocument={onDocument} />; }
      return <p key={key} style={{ margin: 0, fontSize: 14, lineHeight: '21px', overflowWrap: 'anywhere' }}>{inline(b.text, 0, undefined, onDocument)}</p>;
    }
    if (kind === 'next') {
      return (
        <div key={key} data-next style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', border: '1px dashed var(--input)', borderRadius: 'var(--radius-lg)', fontSize: 12.5, lineHeight: '18px', color: 'var(--muted-foreground)' }}>
          {b.items.map((it, i) => <span key={i} style={{ display: 'flex', gap: 8 }}><span style={{ fontFamily: mono, flexShrink: 0 }}>{b.ordered ? `${i + 1}.` : '·'}</span><span style={{ minWidth: 0 }}>{inline(it.text, 0, undefined, onDocument)}{it.sub.length > 0 && <> {it.sub.map((s, j) => <span key={j}>{inline(s, 0, undefined, onDocument)} </span>)}</>}</span></span>)}
        </div>
      );
    }
    if (kind === 'done' || kind === 'verified') {
      return (
        <ol key={key} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {b.items.map((it, i) => <Row key={i} item={it} kind={kind} n={i + 1} onDocument={onDocument} />)}
        </ol>
      );
    }
    const Tag = b.ordered ? 'ol' : 'ul';
    return (
      <Tag key={key} data-list={b.ordered ? 'ordered' : 'bullet'} style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {b.items.map((it, i) => it.q !== undefined
          ? <li key={i}><QuestionCard text={doc.questions[it.q]!.text} options={doc.questions[it.q]!.options} n={it.q} total={doc.questions.length} answer={answers[it.q]} onAnswer={o => answer(it.q!, o)} onFree={onFocusReply} t={t} onDocument={onDocument} /></li>
          : it.checked === true
            ? <Row key={i} item={it} kind={kind} n={i + 1} onDocument={onDocument} />
            : <li key={i} data-item="item" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
              <span style={{ fontFamily: mono, flexShrink: 0 }}>{b.ordered ? `${i + 1}.` : '·'}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 14, lineHeight: '21px', overflowWrap: 'anywhere' }}>{inline(it.text, 0, undefined, onDocument)}</span>
                {it.sub.length > 0 && <span style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--muted-foreground)' }}>{it.sub.map((s, j) => <span key={j}>{inline(s, 0, undefined, onDocument)}</span>)}</span>}
              </span>
            </li>)}
      </Tag>
    );
  };
  const count = (s: Section) => s.blocks.reduce((n, b) => n + (b.type === 'list' ? b.items.length : 0), 0);
  return (
    <div data-reply-card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {showRaw
        ? <pre data-reply-raw className="ledge-scroll" style={{ margin: 0, padding: '12px 14px', background: 'var(--well)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{raw}</pre>
        : doc.sections.map((s, i) => (
          <section key={i} data-section={s.kind} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {s.title && <span data-kicker style={kickerStyle}>{s.title}{count(s) > 1 ? ` · ${count(s)}` : ''}</span>}
            {s.blocks.map((b, j) => renderBlock(b, s.kind, j))}
          </section>
        ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" size="sm" aria-pressed={showRaw} onClick={() => setShowRaw(r => !r)} style={{ height: 26, padding: '0 6px', fontSize: 12, gap: 6, transition: transition([['color', 'hover']]) }}>
          <Icon {...ICONS.text} size={13} />{showRaw ? t.reply.showStructured : t.reply.showRaw}
        </Button>
      </div>
    </div>
  );
}
