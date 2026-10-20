import { useMemo, type ReactNode } from 'react';
import { parseReply } from '@ledge/ui/reply/parse';
import { copy } from '../../copy';
import { href } from '../../router';
import { ReplyView, type Plain } from '../ReplyView';

const LINK = 'text-info underline underline-offset-2';

/** The sessions of the snapshot by name: the only names an answer may link. */
export type SessionNames = ReadonlyMap<string, string>;

export const threadLink = (sessionId: string, children: ReactNode) => <a href={href({ name: 'thread', sessionId })} className={LINK}>{children}</a>;

/** Splits a plain text on the names of the sessions: each one present becomes a link to its thread, the rest stays text. */
export function linker(names: SessionNames): Plain {
  const list = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (list.length === 0) return t => t;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(${list.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text => {
    const out: ReactNode[] = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(<span key={m.index}>{threadLink(names.get(m[1]!)!, m[1])}</span>);
      last = m.index + m[0].length;
    }
    if (last === 0) return text;
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
}

/** What Ledge answered, read like an agent's reply (Markdown), with the sessions it names linked to their thread. */
export function Answer({ text, names }: { text: string; names: SessionNames }) {
  const doc = useMemo(() => parseReply(text), [text]);
  const plain = useMemo(() => linker(names), [names]);
  return <div className="px-1 break-words [overflow-wrap:anywhere]"><ReplyView doc={doc} plain={plain} /></div>;
}

/** « Sources : » with the names of the sessions looked at, linked like the answer's. */
export function Sources({ names, ids }: { names: string[]; ids: SessionNames }) {
  if (names.length === 0) return null;
  return (
    <span className="px-1 text-xs text-muted">
      {copy.chat.sources}
      {names.map((n, i) => <span key={n}>{i > 0 && ', '}{ids.has(n) ? threadLink(ids.get(n)!, n) : n}</span>)}
    </span>
  );
}
