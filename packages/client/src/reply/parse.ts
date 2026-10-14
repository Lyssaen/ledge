/**
 * Reads the agent's last message (markdown as Claude Code reports it) into the shape the "your turn" view shows:
 * a title, a lead, sections classified by their heading (done, verified, questions, next, other) and the questions
 * the agent asks, each with the options it proposes. Anything the parser does not recognise stays a paragraph, so a
 * plain reply still reads as prose; nothing is ever dropped except horizontal rules.
 */
export type SectionKind = 'done' | 'verified' | 'questions' | 'next' | 'other';
export type Item = { text: string; sub: string[]; checked?: boolean; q?: number };
export type Block =
  | { type: 'p'; text: string; q?: number }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; items: Item[] }
  | { type: 'table'; header: string[]; rows: string[][]; align: Align[] }
  | { type: 'quote'; blocks: Block[] };
export type Align = 'left' | 'center' | 'right';
export type Section = { kind: SectionKind; title?: string; blocks: Block[] };
export type Question = { text: string; options: string[] };
export type ReplyDoc = { title?: string; lead?: string; sections: Section[]; questions: Question[]; structured: boolean };

type Raw = { type: 'h'; text: string } | Block;

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^(?:\*\*|__)([^*_].*?)(?:\*\*|__)\s*:?\s*$/;
const LIST = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s/;
const CHECK = /^\[([ xX])\]\s+/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
/** A GFM table opens on a row followed by its separator (`|---|:--:|`), with the same number of cells. */
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const UNESCAPED_PIPE = /(?<!\\)\|/;
const QUOTE = /^\s*>\s?(.*)$/;
const alignOf = (sep: string): Align => sep.startsWith(':') && sep.endsWith(':') ? 'center' : sep.endsWith(':') ? 'right' : 'left';
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(UNESCAPED_PIPE).map(c => c.trim().replace(/\\\|/g, '|'));
const TITLE_MAX = 110;
const OPTION_MAX = 80;

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const KINDS: Array<[SectionKind, RegExp]> = [
  ['questions', /\b(questions?|open|ouvert(e|es)?|decisions?|decider|decide|choix|choices?|a trancher|to settle|besoin de vous|need(s)? you)\b/],
  ['next', /\b(next|suite|reste|left|remaining|todo|to do|a faire|follow[- ]?ups?|prochaines?|later|ensuite|pending)\b/],
  ['verified', /\b(verif\w*|tests?|tested|checks?|checked|validations?|valide|results?|resultats?)\b/],
  ['done', /\b(done|faits?|realise|termine|completed?|changes?|changements?|modifications?|what i did|ce que j'?ai fait|implemented|implemente|delivered|livre)\b/]
];
/** The section a heading opens, from its words (either language, accents ignored). */
export function kindOf(title: string): SectionKind {
  const t = fold(title).replace(/[’']/g, "'");
  return KINDS.find(([, re]) => re.test(t))?.[0] ?? 'other';
}

/** Lines to raw blocks: headings, paragraphs, lists (one level of nesting), quotes, tables and fenced code. */
function tokenize(text: string): Raw[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: Raw[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Item[]; indent: number } | null = null;
  const flushPara = () => { if (para.length) { out.push({ type: 'p', text: para.join(' ').trim() }); para = []; } };
  const flushList = () => { if (list) { out.push({ type: 'list', ordered: list.ordered, items: list.items }); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(FENCE);
    if (fence) {
      flushPara(); flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) body.push(lines[i]!);
      out.push({ type: 'code', text: body.join('\n').replace(/\s+$/, '') });
      continue;
    }
    const sep = lines[i + 1];
    if (UNESCAPED_PIPE.test(line) && sep !== undefined && TABLE_SEP.test(sep)) {
      const header = cells(line);
      if (cells(sep).length === header.length) {
        flushPara(); flushList();
        const rows: string[][] = [];
        // Rows follow until a line without a pipe; each is squared to the header (short ones padded, long ones cut).
        for (i += 2; i < lines.length && lines[i]!.trim() !== '' && UNESCAPED_PIPE.test(lines[i]!); i++) rows.push(Array.from({ length: header.length }, (_, c) => cells(lines[i]!)[c] ?? ''));
        i--;
        out.push({ type: 'table', header, rows, align: cells(sep).map(alignOf) });
        continue;
      }
    }
    const q = line.match(QUOTE);
    if (q) {
      flushPara(); flushList();
      const inner = [q[1]!];
      for (; i + 1 < lines.length && QUOTE.test(lines[i + 1]!); i++) inner.push(lines[i + 1]!.match(QUOTE)![1]!);
      // The quoted lines are read again as blocks; a heading means nothing inside a quote, so it reads as a paragraph.
      out.push({ type: 'quote', blocks: tokenize(inner.join('\n')).map((b): Block => (b.type === 'h' ? { type: 'p', text: b.text } : b)) });
      continue;
    }
    if (line.trim() === '') { flushPara(); continue; } // a list survives blank lines between its items
    if (RULE.test(line)) { flushPara(); flushList(); continue; }
    const h = line.match(HEADING) ?? line.match(BOLD_LINE);
    if (h) { flushPara(); flushList(); out.push({ type: 'h', text: h[1]!.trim().replace(/\s*:\s*$/, '') }); continue; }
    const li = line.match(LIST);
    if (li) {
      flushPara();
      const indent = li[1]!.length;
      const body = li[2]!;
      if (list && indent > list.indent && list.items.length) { list.items[list.items.length - 1]!.sub.push(body.trim()); continue; }
      const ordered = ORDERED.test(line);
      if (!list || indent < list.indent || list.ordered !== ordered) { flushList(); list = { ordered, items: [], indent }; }
      const c = body.match(CHECK);
      list.items.push({ text: (c ? body.slice(c[0].length) : body).trim(), sub: [], ...(c ? { checked: c[1] !== ' ' } : {}) });
      continue;
    }
    // A plain line right under a list item continues that item (wrapped text); otherwise it is paragraph text.
    if (list && /^\s+\S/.test(line) && para.length === 0) { const last = list.items[list.items.length - 1]!; last.text = `${last.text} ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out;
}

const isQuestion = (s: string) => /[?？]\s*$/.test(s);
/** "A or B?" / "A ou B ?" with two short sides: the agent offers a choice. */
function eitherOr(q: string): string[] {
  const m = q.replace(/\s*[?？]\s*$/, '').match(/(?:^|[:,;]\s*)([^,:;?]{2,60}?)\s+(?:or|ou)\s+([^,:;?]{2,60})$/i);
  if (!m) return [];
  const a = m[1]!.trim(), b = m[2]!.trim();
  const wordy = (s: string) => s.split(/\s+/).length > 8;
  return wordy(a) || wordy(b) ? [] : [a, b];
}
const shortOptions = (items: string[]) => items.length >= 2 && items.length <= 6 && items.every(i => i.length <= OPTION_MAX && !isQuestion(i));

export function parseReply(text: string): ReplyDoc {
  const raw = tokenize(text);
  let title: string | undefined;
  let lead: string | undefined;
  const first = raw[0];
  if (first?.type === 'h') { title = first.text; raw.shift(); }
  else if (first?.type === 'p' && raw.length > 1 && first.text.length <= TITLE_MAX && !/[:?？]$/.test(first.text) && raw[1]!.type !== 'code') { title = first.text; raw.shift(); }
  if (title && raw[0]?.type === 'p' && !isQuestion(raw[0].text)) { lead = raw[0].text; raw.shift(); }

  const sections: Section[] = [];
  let cur: Section = { kind: 'other', blocks: [] };
  const push = () => { if (cur.blocks.length || cur.title) sections.push(cur); };
  for (const b of raw) {
    if (b.type === 'h') { push(); cur = { kind: kindOf(b.text), title: b.text, blocks: [] }; }
    else cur.blocks.push(b);
  }
  push();

  // Questions, in reading order: a paragraph ending with "?" (its options: the list right under it, else "A or B"),
  // a list item ending with "?" (its options: its sub-items).
  const questions: Question[] = [];
  for (const s of sections) {
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i]!;
      if (b.type === 'p' && isQuestion(b.text)) {
        const next = s.blocks[i + 1];
        let options: string[] = [];
        if (next?.type === 'list' && !next.ordered && shortOptions(next.items.map(x => x.text))) { options = next.items.map(x => x.text); s.blocks.splice(i + 1, 1); }
        else options = eitherOr(b.text);
        b.q = questions.length; questions.push({ text: b.text, options });
      } else if (b.type === 'list') {
        for (const it of b.items) {
          if (!isQuestion(it.text)) continue;
          it.q = questions.length;
          questions.push({ text: it.text, options: shortOptions(it.sub) ? it.sub : eitherOr(it.text) });
        }
      }
    }
  }
  const structured = !!title && first?.type === 'h' || questions.length > 0 || sections.some(s => !!s.title || s.blocks.some(b => b.type !== 'p'));
  return { title, lead, sections, questions, structured };
}
