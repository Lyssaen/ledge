/**
 * Reads the agent's last message (markdown as Claude Code reports it) into the shape the "your turn" view shows:
 * a title, a lead, sections classified by their heading (done, verified, questions, next, other) and the questions
 * the agent asks, each with the options it proposes (a label, and the description that follows it, if any). Anything the parser does not recognise stays a paragraph, so a
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
/**
 * `details`, by option index ('' for none), only when one of the options carries a description; `recommended`, the
 * option the agent marks (★, or named by its recommendation); `ref`, the question's short name (its bold opening),
 * used to answer several questions at once ("Framework: Express").
 */
export type Question = { text: string; options: string[]; details?: string[]; recommended?: number; ref?: string };
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
/**
 * "A or B?", "A, B or C?" (from the start or after a colon): the agent offers a choice between short options. A side
 * that runs over a sentence or is wordy is not an option, so a long question with an "or" in it gives none.
 */
function eitherOr(q: string): string[] {
  const m = q.replace(/\s*[?？]\s*$/, '').match(/(?:^|[:;]\s*)([^:;?]*?)\s+(?:or|ou)\s+([^,:;?]{2,60})$/i);
  if (!m) return [];
  const parts = [...m[1]!.split(/\s*,\s*/), m[2]!].map(x => x.trim()).filter(Boolean); // "A, ou B": the comma is no option
  // A side cut through a parenthesis or a code span ("the base (`add`", "`list`") is a clause, not an option.
  const whole = (x: string) => (x.match(/\(/g)?.length ?? 0) === (x.match(/\)/g)?.length ?? 0) && (x.match(/`/g)?.length ?? 0) % 2 === 0;
  const short = (x: string) => x.length >= 2 && x.length <= 60 && x.split(/\s+/).length <= 8 && !/[.!]\s/.test(x) && whole(x);
  return parts.length >= 2 && parts.length <= 6 && parts.every(short) ? parts : [];
}

type Option = { label: string; detail: string; star?: boolean };
/** Text without its inline markdown (code, bold, italic, links): what an option button shows. */
const plain = (x: string) => x.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1').trim();
/** A label marked ★ (or ⭐) is the one the agent recommends; the mark is not part of the label. */
const STAR = /\s*[★⭐]\s*/g;
/** `Label (what it is)`: the parenthesis at the end is the description. */
const PAREN = /^(.+?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/;
const option = (label: string, detail: string): Option => {
  const star = STAR.test(label) || STAR.test(detail);
  return { label: plain(label.replace(STAR, ' ')), detail: plain(detail.replace(STAR, ' ')), ...(star ? { star } : {}) };
};
/** `**Label** desc`, `**Label** — desc`, `**Label**: desc`: a bold opening is the label, whatever follows. */
const BOLD_LEAD = /^(\*\*|__)(\S(?:.*?\S)?)\1\s*(?:[—–:-]\s*)?(.*)$/;
/** `Label — desc`, `Label - desc`, `Label: desc`: the first separator, a dash with spaces around it or a colon. */
const SEPARATOR = /^(.+?)(\s+[—–-]\s+|:\s+)(.+)$/;
/** Short labels that ask nothing; a description may ask only as an aside in parentheses ("an existing one (shared dev?)"). */
const fits = (options: Option[], asides = false) => options.every(o => o.label.length > 0 && o.label.length <= OPTION_MAX && !isQuestion(o.label) && (asides || !isQuestion(o.detail)));
/**
 * The options of a list, each split into its label and description. A bold opening always marks the label; a plain
 * separator splits only when every item of the list has one of the same kind, so "Option: keep the cache" alone
 * stays whole. A list is options when it has 2 to 6 short labels and none of them is a question.
 */
function readOptions(items: string[]): Option[] | null {
  if (items.length < 2 || items.length > 6) return null;
  const seps = items.map(i => BOLD_LEAD.test(i) ? null : i.match(SEPARATOR)?.[2]!.trim()[0] ?? null);
  const split = seps.every(c => c !== null && c === seps[0]);
  const options = items.map((i): Option => {
    const b = i.match(BOLD_LEAD);
    if (b) return option(b[2]!, b[3]!);
    const m = split ? i.match(SEPARATOR) : null;
    return m ? option(m[1]!, m[3]!) : option(i, '');
  });
  return fits(options) ? options : null;
}

/** A lettered choice mark, `a) `, after a space, an opening parenthesis or punctuation. */
const LETTER = /(^|[\s(:,;])([a-h])\)\s+/g;
/**
 * `Stem : a) X ★ (why), b) Y, c) Z.`: lettered choices inline. The marks must come in order, so an `a)` inside option
 * b is text; the last option stops at the end of its sentence; a parenthesis is the description.
 */
function lettered(text: string): { stem: string; options: Option[] } | null {
  const marks: Array<{ at: number; end: number }> = [];
  for (const m of text.matchAll(LETTER)) {
    if (m[2]!.charCodeAt(0) - 97 !== marks.length) continue;
    marks.push({ at: m.index! + m[1]!.length, end: m.index! + m[0].length });
  }
  if (marks.length < 2 || marks.length > 8) return null;
  const stem = text.slice(0, marks[0]!.at).trim().replace(/\s*[:—–-]\s*$/, '').trim();
  if (!stem) return null;
  const raw = marks.map((k, i) => text.slice(k.end, marks[i + 1]?.at));
  raw[raw.length - 1] = raw[raw.length - 1]!.split(/(?<=[.!?？])\s+(?=\p{Lu})/u)[0]!;
  const options = raw.map(r => {
    const x = r.trim().replace(/[\s,;.?？]+$/, '');
    const star = /[★⭐]/.test(x);
    const p = x.replace(STAR, ' ').trim().match(PAREN);
    const o = p ? option(p[1]!, p[2]!) : option(x, '');
    return star ? { ...o, star } : o;
  });
  return fits(options, true) ? { stem, options } : null;
}

/** `**Which one do you prefer?** Tell me also…`: a paragraph that opens on a bold question asks it. */
const BOLD_QUESTION = /^(\*\*|__)(.+?[?？])\s*\1/;
/** The question a line asks, or null: it ends with "?", or it opens on a bold question. */
const asks = (text: string): string | null => (isQuestion(text) ? text : text.match(BOLD_QUESTION)?.[2] ?? null);
/** A question that asks to pick among options given earlier in the reply ("Which one…", "Laquelle…"). */
const PICKS = /(^|[^\p{L}])(laquelle|lequel|lesquel|quelle (option|approche|solution)|quel choix|which|pr[ée]f[ée]r|prefer|choisi|choos|pick|reten|retien)/iu;
/** `### 1. PostgreSQL (relational)` or a line `**1. API key** (header)`: an option numbered by the agent. */
const NUMBERED_TITLE = /^(\d+)[.)]\s+(.+)$/;
const NUMBERED_BOLD = /^(\*\*|__)(\d+)[.)]\s+(.+?)\1\s*(.*)$/;
/** The first sentence of a long text: the description an option row shows, the rest stays in the reply. */
const firstSentence = (x: string) => (x.length > 160 ? x.split(/(?<=[.!])\s+(?=\p{Lu}|\()/u)[0]! : x);
/** A proposed option: its label, the description after it (parenthesis or text), else the first line of its body. */
function proposed(head: string, rest: string, body: Block | undefined): Option {
  head = head.trim().replace(/\.$/, '');
  const p = head.match(PAREN);
  let detail = firstSentence(rest.trim()).replace(/^\((.*)\)\.?$/, '$1').replace(/^[—–:-]\s*/, '') || (p ? p[2]! : '');
  if (!detail && body) detail = body.type === 'p' ? body.text : body.type === 'list' ? body.items[0]?.text ?? '' : '';
  return option(p ? p[1]! : head, detail);
}

/** "**Recommendation:** option 2", "Ma recommandation : YAML": a line that recommends. */
const RECOMMENDS = /recommand|recommend/i;
/**
 * The option a recommendation names: the label it mentions first, else "option N", else the letter of "A. Label" ("B.").
 */
function recommendedIn(advice: string, set: Option[], keys: string[] = []): number {
  const lower = advice.toLowerCase();
  const first = (hits: number[]) => { const best = Math.min(...hits); return best < Infinity ? hits.indexOf(best) : -1; };
  const at = (needle: string) => { const i = needle.length >= 2 ? lower.search(new RegExp(`(^|[^\\p{L}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u')) : -1; return i < 0 ? Infinity : i; };
  // A label, or the first word of a label no other option starts with ("stdlib si…" for "Stdlib flag + parser").
  const firsts = set.map(o => o.label.toLowerCase().split(/\s+/)[0]!);
  const byLabel = first(set.map((o, i) => Math.min(at(o.label.toLowerCase()), firsts[i]!.length >= 4 && firsts.filter(w => w === firsts[i]).length === 1 ? at(firsts[i]!) : Infinity)));
  if (byLabel >= 0) return byLabel;
  const n = lower.match(/\boption\s+(\d+)/);
  if (n && Number(n[1]) >= 1 && Number(n[1]) <= set.length) return Number(n[1]) - 1;
  const key = keys.findIndex(k => k && new RegExp(`(^|[\\s:])${k}([.\\s,]|$)`).test(advice));
  return key;
}
const starred = (set: Option[], i: number): Option[] => (i < 0 || set.some(o => o.star) ? set : set.map((o, j) => (j === i ? { ...o, star: true } : o)));
/**
 * `1. **File format**` whose sub-items are options and one recommends: a decision axis. Bold-led sub-items are the
 * options when there are some (a plain one is a remark: "In every case a --config flag"), else every plain one is.
 */
function axis(it: { text: string; sub: string[] }): { options: Option[]; notes: string[] } | null {
  if (!/^(\*\*|__)[^*_]+\1:?$/.test(it.text.trim())) return null;
  const advice = it.sub.find(x => RECOMMENDS.test(x.slice(0, 40)));
  if (!advice) return null;
  const rest = it.sub.filter(x => x !== advice);
  const bold = rest.filter(x => BOLD_LEAD.test(x));
  const items = bold.length >= 2 ? bold : rest;
  if (items.length < 2 || items.length > 6) return null;
  const keys = items.map(x => x.replace(/^(\*\*|__)/, '').match(/^([A-Z])\.\s/)?.[1] ?? '');
  const options = items.map(x => { const b = x.match(BOLD_LEAD); return b ? option(b[2]!.replace(/^[A-Z]\.\s+/, '').replace(/\.$/, ''), b[3]!.replace(/^[,;]\s*/, '')) : option(x.replace(/\.$/, ''), ''); });
  // What is not an option (the recommendation, a remark) stays under the question.
  return fits(options) ? { options: starred(options, recommendedIn(advice, options, keys)), notes: it.sub.filter(x => !items.includes(x)) } : null;
}

const question = (text: string, options: Option[] | null, core = text, ref?: string): Question => {
  const opts: Option[] = options ?? eitherOr(core).map(label => ({ label, detail: '' }));
  const details = opts.map(o => o.detail);
  const recommended = opts.findIndex(o => o.star);
  return {
    text, options: opts.map(o => o.label),
    ...(details.some(Boolean) ? { details } : {}), ...(recommended >= 0 ? { recommended } : {}), ...(ref ? { ref } : {})
  };
};

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

  // Questions, in reading order. A paragraph that asks (ends with "?", or opens on a bold question) takes as options
  // the list right under it, else lettered choices in it, else "A or B", else, when it asks to pick, the options the
  // agent numbered above it (headings or bold lines). A list item that asks takes its sub-items, else its lettered
  // choices, else "A or B", else the options numbered above it; an item with lettered choices asks even without a "?"
  // ("**Framework**: a) X, b) Y"), and so does a decision axis (a bold item whose sub-items are options, one recommended).
  // Nothing in a "done" or "verified" section is read as a choice.
  const questions: Question[] = [];
  let run: Option[] | null = null; // the options the agent is numbering, 1, 2, 3…
  let advice = ''; // the latest "**My recommendation:** …" line
  const numbered = (n: number, o: Option) => {
    if (n === 1) run = [o];
    else if (run && n === run.length + 1) run.push(o);
  };
  const ref = (stem: string) => stem.match(BOLD_LEAD)?.[2]?.replace(/\s*:$/, '');
  const fromRun = (): Option[] | null => {
    const set = run && run.length >= 2 && run.length <= 8 ? run : null;
    run = null;
    if (!set) return null;
    return starred(set, recommendedIn(advice, set));
  };
  for (const s of sections) {
    const settled = s.kind === 'done' || s.kind === 'verified';
    const t = s.title?.match(NUMBERED_TITLE);
    if (t) numbered(Number(t[1]), proposed(t[2]!, '', s.blocks[0]));
    for (let i = 0; i < s.blocks.length; i++) {
      const b = s.blocks[i]!;
      if (b.type === 'p') {
        const nb = b.text.match(NUMBERED_BOLD);
        if (nb) { numbered(Number(nb[2]), proposed(nb[3]!, nb[4]!, s.blocks[i + 1])); continue; }
        if (/^(\*\*|__)[^*_]*(recommand|recommend)/i.test(b.text)) advice = b.text;
        if (settled) continue;
        const core = asks(b.text);
        const letters = lettered(b.text);
        if (!core && !letters) continue;
        const next = s.blocks[i + 1];
        let options = next?.type === 'list' && !next.ordered ? readOptions(next.items.map(x => x.text)) : null;
        if (options) s.blocks.splice(i + 1, 1);
        else if (letters) options = letters.options;
        else if (!eitherOr(core!).length && PICKS.test(core!)) options = fromRun();
        b.q = questions.length; questions.push(question(b.text, options, letters && !core ? letters.stem : core!));
      } else if (b.type === 'list' && !settled) {
        b.items.forEach((it, k) => {
          // A list item that asks; a bold-led one may go on after its "?" ("**Deploy**: one or many? It decides…").
          const mid = BOLD_LEAD.test(it.text) ? it.text.lastIndexOf('?') : -1;
          const core = asks(it.text) ?? (mid > 0 ? it.text.slice(0, mid + 1) : null);
          const letters = lettered(it.text);
          const decision = core || letters ? null : axis(it);
          if (!core && !letters && !decision) {
            // `1. **In-memory cache** (Map with a TTL). No infra…`: an option the agent numbers, for a "which one" later.
            const o = b.ordered ? it.text.match(BOLD_LEAD) : null;
            if (o) numbered(k + 1, proposed(o[2]!, o[3]!, undefined));
            return;
          }
          it.q = questions.length;
          const subs = readOptions(it.sub);
          // Lettered choices make the question their stem: the line reads "**Framework HTTP**", its options below.
          if (decision) { questions.push(question(it.text, decision.options, it.text, ref(it.text))); it.sub = decision.notes; }
          else if (!subs && letters) questions.push(question(letters.stem, letters.options, letters.stem, ref(letters.stem)));
          else questions.push(question(it.text, subs ?? (!eitherOr(core!).length && PICKS.test(core!) ? fromRun() : null), core ?? it.text));
          if (subs && !decision) it.sub = []; // its sub-items are its options; any other sub-item stays under the question
        });
      }
    }
  }
  const structured = !!title && first?.type === 'h' || questions.length > 0 || sections.some(s => !!s.title || s.blocks.some(b => b.type !== 'p'));
  return { title, lead, sections, questions, structured };
}
