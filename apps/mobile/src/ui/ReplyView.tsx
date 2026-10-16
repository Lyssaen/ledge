import type { ReactNode } from 'react';
import type { Block, ReplyDoc, Section } from '@ledge/client';
import { copy } from '../copy';

/** `code`, **bold** and *italic* in a line; anything else (links included) stays text: nothing in a reply is actionable here. */
const TOKEN = /(?<code>`[^`\n]+`)|\*\*(?<b>\S(?:.*?\S)?)\*\*(?!\*)|(?<![\w*])\*(?<i>[^\s*](?:[^*\n]*?[^\s*])?)\*(?![\w*])/g;
export function inline(text: string, depth = 0): ReactNode[] {
  if (depth > 2) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const g = m.groups!;
    if (g.code) out.push(<code key={at} className="rounded-md bg-white/[0.06] px-[5px] py-px font-mono text-[.92em] [overflow-wrap:anywhere]">{g.code.slice(1, -1)}</code>);
    else if (g.b) out.push(<strong key={at} className="font-semibold">{inline(g.b, depth + 1)}</strong>);
    else out.push(<em key={at}>{inline(g.i!, depth + 1)}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case 'p': return <p className="[&+*]:mt-2.5">{inline(b.text)}</p>;
    case 'code': return <pre className="my-2.5 overflow-x-auto rounded-lg bg-black/30 p-2.5 font-mono text-xs leading-[1.6] whitespace-pre">{b.text}</pre>;
    case 'list': {
      const L = b.ordered ? 'ol' : 'ul';
      return (
        <L className={`my-2.5 flex flex-col gap-1 pl-[18px] text-[#c8cbce] ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((it, i) => (
            <li key={i}>
              {it.checked !== undefined && <span aria-hidden="true">{it.checked ? '☑ ' : '☐ '}</span>}{inline(it.text)}
              {it.sub.length > 0 && <ul className="mt-1 flex list-[circle] flex-col gap-1 pl-4">{it.sub.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>}
            </li>
          ))}
        </L>
      );
    }
    case 'table': return (
      <div className="my-2.5 overflow-x-auto" tabIndex={0}>
        <table className="w-full border-collapse text-xs">
          <thead><tr>{b.header.map((h, i) => <th key={i} className="border-b border-line px-2 py-1.5 font-semibold" style={{ textAlign: b.align[i] ?? 'left' }}>{inline(h)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border-b border-line px-2 py-1.5 align-top" style={{ textAlign: b.align[j] ?? 'left' }}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    case 'quote': return <blockquote className="my-2.5 border-l-2 border-line pl-3 text-muted">{b.blocks.map((x, i) => <BlockView key={i} b={x} />)}</blockquote>;
  }
}

/** The « suite » section is a suggestion to read, never a button: it sends nothing. */
function SectionView({ s }: { s: Section }) {
  const body = s.blocks.map((b, i) => <BlockView key={i} b={b} />);
  if (s.kind === 'next') {
    return (
      <div className="mt-3 rounded-[10px] border border-info/[0.13] bg-info/[0.03] p-3">
        <div className="mb-1.5 text-[10px] font-medium tracking-[.5px] text-info uppercase">{copy.thread.suggestion}</div>
        {body}
      </div>
    );
  }
  return (
    <section className="mt-2.5">
      {s.title && <h3 className="mb-1 text-[13px] font-semibold">{inline(s.title)}</h3>}
      {body}
    </section>
  );
}

/** What the agent said, read the way the PC reads it: a title, a lead, then its sections. */
export function ReplyView({ doc }: { doc: ReplyDoc }) {
  return (
    <>
      {doc.title && <strong className="block text-[13px] font-semibold">{inline(doc.title)}</strong>}
      {doc.lead && <p className="mt-1.5">{inline(doc.lead)}</p>}
      {doc.sections.map((s, i) => <SectionView key={i} s={s} />)}
    </>
  );
}
