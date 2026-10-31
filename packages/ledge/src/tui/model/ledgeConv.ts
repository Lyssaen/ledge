import { MANDATE_CATEGORY_LABEL, type Escalation, type Exchange } from '@ledge/protocol';
import { hhmm, relativeAge, seatName, type ThreadRow } from '@ledge/ui/chat/ledge/threadModel';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cells, cut, lineCells, pad, wrapSegs, type Line } from './cells.js';
import { markdownLines } from './markdown.js';

/** Where an answer to an escalation stands (`useAnswerState` of `@ledge/fleet`, read for any id). */
export type AnswerView = { state: 'idle' | 'sending' | 'done' | 'refused'; code?: string; reason?: string };

export interface ConvOpts {
  t: Messages; g: Glyphs; width: number;
  /** The exchange groups z flipped from their default: the latest one open, the others folded. */
  open: ReadonlySet<string>;
  /** The thread item that has the focus (j k in the conversation): its head is drawn on the selection's background. */
  focused?: string;
  /** The escalation 1-9 answer: only its card draws its keys; another one waiting shows its options and how to choose it. */
  target?: string;
  answer(id: string): AnswerView;
  /** Now, for the escalations' age (« il y a 4 min »); the clock by default. */
  now?: string;
  /** A rig's name and colour for its exchange groups; its id and the dim colour otherwise. */
  rig?(machine: string, rigId: string): { name: string; color: string } | undefined;
  /** The answer Ledge is writing, drawn in its pending bubble. */
  live?: { qid: string; text: string } | null;
  /** The options picked so far in an escalation of several questions, by escalation id. */
  picks?: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** The language the categories are named in. */
  lang?: 'fr' | 'en';
}

export interface DecisionKey { key: string; questionId: string; optionId: string; label: string; recommended: boolean }

/** The keys that answer `e`: '1'…'9' through its questions' options, in order (an option past the ninth has none). */
export function decisionKeys(e: Escalation): DecisionKey[] {
  return e.questions.flatMap(q => q.options.map(o => ({ questionId: q.id, optionId: o.id, label: o.label, recommended: !!o.recommended })))
    .slice(0, 9).map((k, i) => ({ key: String(i + 1), ...k }));
}

/** Whether an escalation's keys still answer it: not settled, not lost to an answer given elsewhere, not already sent. */
export function answerable(e: Escalation, a: AnswerView): boolean {
  if (e.state === 'answered' || e.state === 'closed') return false;
  if (a.state === 'sending' || a.state === 'done') return false;
  return !(a.state === 'refused' && a.code === 'already_answered');
}

/** The answer's words: each question's option label, or the free value as is. */
function answerLabel(e: Escalation, answers: Record<string, string>): string {
  if (e.questions.length === 0) return answers.text ?? Object.values(answers).join(' · ');
  return e.questions.flatMap(q => { const v = answers[q.id]; return v === undefined ? [] : [q.options.find(o => o.id === v)?.label ?? v]; }).join(' · ');
}

const BOX = { round: { tl: '╭', h: '─', tr: '╮', v: '│', bl: '╰', br: '╯' }, double: { tl: '╔', h: '═', tr: '╗', v: '║', bl: '╚', br: '╝' } };
type Box = typeof BOX.round;

/** A box `width` cells wide around `body`, its title (upper case) in the top border, as `TitledBox` draws it. */
function boxed(body: Line[], width: number, o: { color: string; title?: string; titleColor?: string; double?: boolean }): Line[] {
  const b: Box = o.double ? BOX.double : BOX.round, inner = width - 4;
  const title = o.title ? cut([{ text: ` ${o.title.toUpperCase()} `, color: o.titleColor ?? o.color }], Math.max(0, width - 3)) : [];
  const top: Line = [{ text: `${b.tl}${b.h}`, color: o.color }, ...title, { text: `${b.h.repeat(Math.max(0, width - 3 - lineCells(title)))}${b.tr}`, color: o.color }];
  const rows = body.map(l => { const c = cut(l, inner); return [{ text: `${b.v} `, color: o.color }, ...c, pad(inner - lineCells(c)), { text: ` ${b.v}`, color: o.color }]; });
  return [top, ...rows, [{ text: `${b.bl}${b.h.repeat(Math.max(0, width - 2))}${b.br}`, color: o.color }]];
}

/** A button as `ui/SessionCard`'s `Button` draws it: « label », then its key, on the key's background (`off`: none, faded). */
function button(label: string, k: string, kind: 'primary' | 'key' | 'off'): Line {
  const bg = kind === 'off' ? undefined : kind === 'primary' ? C.primary : C.key;
  return [{ text: ` ${label} `, color: kind === 'off' ? C.faint : C.fg, ...(bg ? { bg } : {}) }, { text: `${k} `, color: C.dim, ...(bg ? { bg } : {}) }];
}

/** Buttons side by side, two cells apart, on as many lines as `width` asks. */
function buttonRows(buttons: Line[], width: number): Line[] {
  const out: Line[] = [];
  let cur: Line = [];
  for (const b of buttons) {
    if (cur.length && lineCells(cur) + 2 + lineCells(b) > width) { out.push(cur); cur = []; }
    cur = cur.length ? [...cur, pad(2), ...b] : [...b];
  }
  if (cur.length) out.push(cur);
  return out;
}

const wrapped = (segs: Line, width: number): Line[] => wrapSegs(segs, Math.max(4, width));

/** Ledge's head over its bubble: « ◖ Ledge · 16:44 ». */
function head(at: string, o: ConvOpts): Line {
  return [{ text: `${o.g.logo} `, color: C.coral }, { text: o.t.conv.ledge, color: C.fg, bold: true }, { text: ` · ${hhmm(at)}`, color: C.faint }];
}

/** The decision in message: a double box, yellow, its category, origin and age on top; the question, Ledge's advice, an option
 *  per button (the recommended one primary) with its key, and « En parler e »; once answered, by whom, the buttons out. */
function escalationBox(e: Escalation, width: number, o: ConvOpts): Line[] {
  const { t } = o, w = t.conv, inner = width - 4;
  const a = o.answer(e.id);
  const category = e.category ? MANDATE_CATEGORY_LABEL[e.category][o.lang ?? 'fr'] : undefined;
  const title = [category, e.from, relativeAge(e.createdAt, o.now ?? new Date().toISOString(), w.age)].filter(Boolean).join(' · ');
  const body: Line[] = [];
  body.push(...wrapped([{ text: e.summary || e.questions[0]?.question || '', color: C.fg, bold: true }], inner));
  if (e.advice) body.push(...wrapped([{ text: w.advice(e.advice), color: C.dim }], inner));
  const already = a.state === 'refused' && a.code === 'already_answered';
  const live = answerable(e, a);
  // Who settled it, « Déjà répondu » first when this answer lost the race (review focus 3).
  const notes: Line[] = [];
  if (already) notes.push([{ text: w.already, color: C.yellow }]);
  if (e.state === 'answered' && e.answer) notes.push([{ text: `${o.g.arrow} ${e.intent === 'update' ? w.seen : answerLabel(e, e.answer.answers)} · ${w.by[e.answer.by]}`, color: C.green }]);
  else if (!already && (e.state === 'answered' || e.state === 'closed')) notes.push([{ text: w.closed, color: C.dim }]);
  else if (a.state === 'refused' && !already) notes.push([{ text: w.refused(a.code ?? 'failed', a.reason), color: C.red }]);
  else if (a.state === 'sending') notes.push([{ text: w.sending, color: C.faint }]);
  else if (e.state === 'grace') notes.push([{ text: w.grace, color: C.dim }]);
  const picks = o.picks?.get(e.id) ?? {};
  const several = e.questions.length > 1;
  // The keys are the target's alone: a digit never answers a card the user is not on (two decisions waiting, the pin moved).
  if (e.id !== o.target) {
    const options = e.intent === 'update' ? [w.seen] : decisionKeys(e).map(k => k.label);
    body.push([], ...notes, ...(notes.length ? [[] as Line] : []), ...buttonRows(options.map(l => [{ text: ` ${l} `, color: live ? C.dim : C.faint }]), inner));
    if (live) body.push([{ text: w.choose, color: C.faint }]);
    return boxed(body, width, { color: C.yellow, title, double: true });
  }
  const buttons: Line[] = e.intent === 'update' ? [button(w.seen, '1', live ? 'primary' : 'off')]
    : decisionKeys(e).map(k => {
      const chosen = several && picks[k.questionId] === k.optionId;
      return button(`${chosen ? `${o.g.ok} ` : ''}${k.key} · ${k.label}`, k.key, !live ? 'off' : k.recommended || chosen ? 'primary' : 'key');
    });
  buttons.push(button(w.talk, 'e', 'key'));
  body.push([], ...notes, ...(notes.length ? [[] as Line] : []), ...buttonRows(buttons, inner));
  return boxed(body, width, { color: C.yellow, title, double: true });
}

/** The exchanges between agents of one rig, one line each: « │ 16:36  orch-lead → qa  ▤ texte ». */
function exchangeLine(x: Exchange, width: number, o: ConvOpts): Line {
  const toLedge = x.kind === 'ledge' || x.to === 'ledge';
  const [mark, color] = toLedge ? [o.g.approval, C.yellow] : x.kind === 'message' ? [o.g.message, C.violet] : [o.g.task, C.green];
  const from = seatName(x.from), to = seatName(x.to);
  const who = (n: string) => (n === 'ledge' ? C.coral : C.fg);
  return cut([{ text: `${o.g.bar} `, color: C.line }, { text: `${hhmm(x.at)}  `, color: C.faint }, { text: from, color: who(from) }, { text: ` ${o.g.arrow} `, color },
    { text: to.padEnd(Math.max(0, 22 - cells(from))), color: who(to) }, { text: ` ${mark} `, color }, { text: x.text.replace(/\s*\n\s*/g, ' '), color: C.dim }], width);
}

/** A line with `right` at the right edge of `width`. */
const spread = (left: Line, right: Line, width: number): Line => {
  const r = lineCells(right), l = cut(left, Math.max(1, width - r - 1));
  return [...l, pad(width - lineCells(l) - r), ...right];
};

/** The conversation's lines (the mockup's « Ledge en tête » screen), each with the id of the thread item it draws (what a scroll
 *  stays on, what j k focus): the day, the user on the right, Ledge's bubbles, the decisions in them, what Ledge settled, the
 *  exchange groups. An escalation or a decision the client does not know (yet) draws nothing. */
export function convLines(rows: readonly ThreadRow[], o: ConvOpts): { lines: Line[]; keys: string[] } {
  const { t, g, width } = o, w = t.conv;
  const bw = Math.min(width, Math.max(24, Math.min(width - 6, 70)));
  const lines: Line[] = [], keys: string[] = [];
  const latestGroup = rows.reduce<string | undefined>((at, r) => (r.kind === 'exchanges' ? r.item.id : at), undefined);
  const bubble = (key: string, at: string, body: Line[]) => {
    const focused = o.focused === key;
    const h = head(at, o);
    return [focused ? [...h, pad(width - lineCells(h))].map(s => ({ ...s, bg: C.sel })) : h, ...boxed(body, bw, { color: focused ? C.coral : C.line })];
  };
  rows.forEach((row, i) => {
    // An escalation right after Ledge's message goes inside that bubble, under its text (the mockup); it was drawn there.
    const prev = rows[i - 1];
    if (row.kind === 'escalation' && row.escalation && prev?.kind === 'ledge') return;
    let out: Line[] = [];
    let key: string;
    switch (row.kind) {
      case 'day': {
        key = `day:${row.day}`;
        const label = ` ${row.label.toUpperCase()} `, side = Math.max(1, Math.floor((width - cells(label)) / 2));
        out = [[{ text: g.rule.repeat(side), color: C.line }, { text: label, color: C.faint }, { text: g.rule.repeat(Math.max(1, width - side - cells(label))), color: C.line }]];
        break;
      }
      case 'user': {
        key = row.item.id;
        const label = `${w.you} · ${hhmm(row.item.at)}`;
        out.push([pad(width - cells(label)), { text: label, color: C.faint }]);
        const text = row.item.text;
        const to = row.to ?? row.item.to;
        const address = /^@\S+/.exec(text)?.[0] ?? (to ? (to.startsWith('@') ? to : `@${to}`) : undefined);
        const rest = address && text.startsWith(address) ? text.slice(address.length) : address ? ` ${text}` : text;
        const segs: Line = [...(address ? [{ text: address, color: C.violet, bold: true }] : []), { text: rest, color: C.fg }];
        const said = wrapped(segs, bw - 2);
        const wide = Math.max(...said.map(lineCells));
        for (const l of said) {
          const line: Line = [{ text: ' ' }, ...l, pad(wide - lineCells(l) + 1)].map(s => ({ ...s, bg: C.sel }));
          out.push([pad(width - lineCells(line)), ...line]);
        }
        break;
      }
      case 'ledge': {
        key = row.item.id;
        const live = row.item.pending && o.live && (o.live.qid === row.turn?.qid || o.live.qid === row.item.qid) ? o.live.text : '';
        const text = row.item.text || live;
        const body: Line[] = text ? markdownLines(text, { width: bw - 4, g, color: C.fg }) : row.item.pending ? [[{ text: t.ask.reading, color: C.faint }]] : [];
        if (row.item.pending && text) body.push([{ text: g.caret, color: C.coral }]);
        const next = rows[i + 1];
        // Its decision drawn inside: the whole bubble is the escalation's (what j k focus, what a scroll stays on).
        if (next?.kind === 'escalation' && next.escalation) { key = next.item.id; body.push(...(body.length ? [[] as Line] : []), ...escalationBox(next.escalation, bw - 4, o)); }
        out = bubble(key, row.item.at, body);
        break;
      }
      case 'card': {
        key = row.item.id;
        out = bubble(key, row.item.at, wrapped([{ text: row.item.action.summary, color: C.fg }], bw - 4));
        break;
      }
      case 'escalation': {
        key = row.item.id;
        if (!row.escalation) return;
        out = bubble(key, row.item.at, escalationBox(row.escalation, bw - 4, o));
        break;
      }
      case 'decided': {
        key = row.item.id;
        const d = row.decision;
        if (!d) return;
        const body: Line[] = [...wrapped([{ text: w.decided.before, color: C.fg }, { text: row.to ?? g.ellipsis, color: C.fg, bold: true }, { text: w.decided.after(d.summary), color: C.fg }], bw - 4)];
        if (d.rule) body.push(...wrapped([{ text: w.rule(d.rule), color: C.dim }], bw - 4));
        body.push([], button(w.revisit, 'u', 'key'));
        out = bubble(key, row.item.at, body);
        break;
      }
      case 'exchanges': {
        key = row.item.id;
        const open = (row.item.id === latestGroup) !== o.open.has(row.item.id);
        const rig = o.rig?.(row.item.machine, row.item.rigId) ?? { name: row.item.rigId, color: C.dim };
        const start = hhmm(row.item.from), end = hhmm(row.item.to);
        const left: Line = [{ text: `${open ? g.unfolded : g.folded} `, color: C.faint }, { text: `${g.rig} `, color: rig.color }, { text: rig.name, color: C.fg, bold: true },
          { text: ` · ${w.exchanges(row.exchanges.length + row.missing)} · ${start === end ? start : `${start} ${g.arrow} ${end}`}`, color: C.dim }];
        const h = spread(left, [{ text: open ? w.fold : w.unfold, color: C.faint }], width);
        out.push(o.focused === key ? h.map(s => ({ ...s, bg: C.sel })) : h);
        if (open) {
          for (const x of row.exchanges) out.push(exchangeLine(x, width, o));
          if (row.missing > 0) out.push([{ text: `${g.bar} `, color: C.line }, { text: w.missing(row.missing), color: C.faint }]);
        }
        break;
      }
    }
    if (lines.length) { lines.push([]); keys.push(key); }
    for (const l of out) { lines.push(l); keys.push(key); }
  });
  return { lines, keys };
}

/** Views of the conversation drawn apart (Ledge's thread; the chat turns no item of it names: asked from here or the docked
 *  chat) in one, each element at its time: `at(key)` is an element's time, none for one that goes with the next (a day). One
 *  empty line between elements. */
export function interleave(views: readonly { lines: readonly Line[]; keys: readonly string[]; at(key: string): string | undefined }[]): { lines: Line[]; keys: string[] } {
  type Block = { key: string; at: string; lines: Line[] };
  const blocks: Block[] = [];
  const blank = (l: Line) => l.every(s => s.text === '');
  for (const v of views) {
    const mine: Block[] = [];
    v.keys.forEach((key, i) => {
      const last = mine[mine.length - 1];
      if (last?.key === key) last.lines.push(v.lines[i]!);
      else mine.push({ key, at: v.at(key) ?? '', lines: [v.lines[i]!] });
    });
    // A day takes the time of what follows it, so that it stays just before it.
    for (let i = mine.length - 1; i >= 0; i--) if (!mine[i]!.at) mine[i]!.at = mine[i + 1]?.at ?? '\uffff';
    for (const b of mine) { while (b.lines.length && blank(b.lines[0]!)) b.lines.shift(); }
    blocks.push(...mine.filter(b => b.lines.length));
  }
  // Stable: two elements of one time keep their order, the thread's first.
  blocks.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lines: Line[] = [], keys: string[] = [];
  for (const b of blocks) {
    if (lines.length) { lines.push([{ text: '' }]); keys.push(b.key); }
    for (const l of b.lines) { lines.push(l); keys.push(b.key); }
  }
  return { lines, keys };
}

/** The items j k go through: a decision, what Ledge settled, an exchange group. */
export function actionable(rows: readonly ThreadRow[]): ThreadRow[] {
  return rows.filter(r => (r.kind === 'escalation' && r.escalation) || (r.kind === 'decided' && r.decision) || r.kind === 'exchanges');
}

