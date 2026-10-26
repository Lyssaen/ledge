import type { ThreadItem, ToolItem } from '@ledge/protocol';
import { turns, type Turn } from '@ledge/ui/thread/turns';
import { rawTarget, SPINNER } from '@ledge/ui/thread/tools';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cut, pad, row, wrapSegs, type Line, type Seg } from './cells.js';
import { markdownLines } from './markdown.js';
import { clock, oneLine, took } from './time.js';

export type { Seg, Line } from './cells.js';

/** The most diff lines shown under one file. */
export const DIFF_MAX = 30;
/** The most lines an element of the thread takes, folded: then « … +n » (space unfolds them all). */
export const CAP = { tool: 3, error: 3, message: 3, notice: 2, permission: 3, helper: 2 } as const;
/** The cells a running action's time takes, « 10 min 00 » included, so that it ticking never moves the rest. */
const LIVE_PAD = 9;

/** `text` cut into lines of at most `width` cells, at spaces when it can; its own newlines kept. */
export function wrap(text: string, width: number): string[] {
  return wrapSegs([{ text: text.replace(/\r/g, '') }], Math.max(10, width)).map(l => l.map(s => s.text).join(''));
}

/** Lines added and removed by a unified diff (its headers left out). */
export function diffCount(diff: string | undefined): { add: number; del: number } {
  let add = 0, del = 0;
  for (const l of (diff ?? '').split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) add++; else if (l.startsWith('-')) del++;
  }
  return { add, del };
}

/** The spinner's frame at `now`: what `ui/Lines.tsx` draws again, alone, each second. */
export const spin = (now: number): string => SPINNER[Math.floor(now / 1000) % SPINNER.length]!;

function toolLines(it: ToolItem, o: Opts): Line[] {
  const { t, g, width } = o, now = o.now ?? Date.now();
  const status: Seg = it.status === 'success' ? { text: g.ok, color: C.green } : it.status === 'failed' ? { text: g.fail, color: C.red }
    : it.status === 'running' ? (o.ascii ? { text: g.live, color: C.blue } : { text: spin(now), color: C.blue, live: { spin: true } }) : { text: '·', color: C.faint };
  const counts = it.files.reduce((a, f) => { const n = diffCount(f.diff); return { add: a.add + n.add, del: a.del + n.del }; }, { add: 0, del: 0 });
  const meta: Line = [];
  if (counts.add || counts.del) meta.push({ text: `+${counts.add}`, color: C.green }, { text: ' ' }, { text: `−${counts.del}`, color: C.red });
  if (it.durationMs !== undefined) meta.push(...(meta.length ? [pad(2)] : []), { text: took(it.durationMs, t.time.decimal).padStart(5), color: C.faint });
  else if (it.status === 'running') {
    const since = Date.parse(it.at);
    meta.push(...(meta.length ? [pad(2)] : []), { text: took(Math.max(0, now - since), t.time.decimal).padStart(LIVE_PAD), color: C.blue, live: { since, pad: LIVE_PAD } });
  }
  const out = row([pad(2), status, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }], [{ text: rawTarget(it), color: C.fg }], meta, width, { max: o.cap(CAP.tool), more: MORE });
  if (it.status === 'failed' && it.error) out.push(...row([pad(6)], [{ text: oneLine(it.error), color: C.red }], null, width, { max: o.cap(CAP.error), more: MORE }));
  if (o.diffs) for (const f of it.files) {
    const lines = (f.diff ?? '').split('\n').filter(l => l && !l.startsWith('+++') && !l.startsWith('---'));
    // Each diff line wrapped; what goes on below it marked « ↪ ».
    for (const l of lines.slice(0, DIFF_MAX)) wrapSegs([{ text: l, color: l.startsWith('+') ? C.green : l.startsWith('-') ? C.red : C.faint }], width - 10, width - 8)
      .forEach((x, k) => out.push([{ text: `      ${g.bar} `, color: C.faint }, ...(k ? [{ text: `${g.cont} `, color: C.faint }] : []), ...x]));
    if (lines.length > DIFF_MAX) out.push([{ text: `      ${g.bar} ${g.ellipsis} ${lines.length - DIFF_MAX}`, color: C.faint }]);
  }
  return out;
}

const MORE: Seg = { text: ' …', color: C.faint };

/** `now` only for the line's first value: a running action's spinner and time then tick in `ui/Lines.tsx`. */
interface Opts { t: Messages; g: Glyphs; now?: number; width: number; diffs: boolean; ascii?: boolean; cap(n: number): number }

function itemLines(it: ThreadItem, o: Opts): Line[] {
  const { t, g, width } = o;
  const body = (text: string, color: string) => markdownLines(text, { width: width - 2, g, color }).map(l => [pad(2), ...l]);
  const message = (head: Line, text: string, meta: Line | null) => row([pad(2), { text: `${g.message} `, color: C.violet }, ...head, pad(2)], [{ text: `« ${oneLine(text)} »`, color: C.dim }], meta, width, { indent: 4, max: o.cap(CAP.message), more: MORE });
  switch (it.kind) {
    case 'prompt': return [[{ text: t.session.you, color: C.coral, bold: true }, { text: `  ${clock(it.at)}`, color: C.faint }], ...body(it.text, C.fg)];
    case 'message': return body(it.text, C.dim);
    case 'reply': return body(it.text, C.fg);
    case 'tool': return toolLines(it, o);
    case 'permission':
      return row([pad(2), { text: g.approval, color: C.red }, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }], [{ text: oneLine(it.text), color: C.fg }],
        it.decision ? [{ text: `${g.arrow} ${t.session.decision[it.decision]}`, color: C.faint }] : null, width, { max: o.cap(CAP.permission), more: MORE });
    case 'helper':
      return row([{ text: `  ${g.helper} `, color: C.violet }], [{ text: it.agentType ? `${it.agentType} ` : '', color: C.dim }, { text: oneLine(it.task), color: C.violet }],
        [{ text: it.state === 'working' ? t.state.working : t.session.helperDone, color: C.faint }], width, { indent: 4, max: o.cap(CAP.helper), more: MORE });
    case 'sent': {
      const status = it.status === 'read' ? `${g.ok}${g.ok} ` : it.status === 'delivered' ? `${g.ok} ` : '';
      return message([{ text: `${t.session.sentTo} `, color: C.dim }, { text: it.to, color: C.fg, bold: true }], it.summary ?? it.text,
        [{ text: `${status}${t.session.sent[it.status]}`, color: it.status === 'failed' ? C.red : it.status === 'sending' ? C.faint : C.green }]);
    }
    case 'received': return message([{ text: `${t.session.receivedFrom} `, color: C.dim }, { text: it.from, color: C.fg, bold: true }], it.text, null);
    case 'notice': return row([{ text: '  · ', color: C.faint }], [{ text: oneLine(it.summary ?? it.text), color: C.faint }], null, width, { max: o.cap(CAP.notice), more: MORE });
  }
}

/** One folded turn: when it started, what was asked, how many actions and files, how it ended. */
export function foldedLine(turn: Turn, o: Pick<Opts, 't' | 'g'>): Line {
  const tools = turn.items.filter((i): i is ToolItem => i.kind === 'tool');
  const files = new Set(tools.flatMap(i => i.status === 'success' ? i.files.map(f => f.path) : []));
  const parts = [turn.prompt ? oneLine(turn.prompt.text) : '', o.t.session.actions(tools.length), ...(files.size ? [o.t.session.files(files.size)] : []), ...(turn.reply ? [oneLine(turn.reply.text)] : [])].filter(Boolean);
  return [{ text: `${o.g.folded} ${clock(turn.prompt?.at ?? turn.items[0]?.at ?? new Date(0).toISOString())}  `, color: C.faint }, { text: parts.join(' · '), color: C.faint }];
}

export type ThreadView = { lines: Line[]; keys: string[]; turns: Map<string, string> };

/** The session's main thread as lines, each with the item it shows (what a scroll stays on), and each item's turn (its first
 *  item's key: the folded turn's line). Past turns folded unless unfolded, the last one in full. Each element wraps at the
 *  real width, up to its ceiling unless unfolded. */
export function threadView(items: ThreadItem[], o: Omit<Opts, 'cap'> & { unfolded: boolean }): ThreadView {
  const all = turns(items);
  const lines: Line[] = [], keys: string[] = [], turnOf = new Map<string, string>();
  const opts: Opts = { ...o, cap: n => (o.unfolded ? Infinity : n) };
  const push = (key: string, l: Line[]) => { for (const x of l) { lines.push(x); keys.push(key); } };
  all.forEach((turn, i) => {
    const last = i === all.length - 1;
    const first = turn.prompt?.id ?? turn.items[0]?.id ?? String(i);
    for (const it of turn.items) turnOf.set(it.id, first);
    if (!last && !o.unfolded) { push(first, [cut(foldedLine(turn, o), o.width)]); return; }
    if (lines.length) push(first, [[{ text: '' }]]);
    for (const it of turn.items) push(it.id, itemLines(it, opts));
  });
  return { lines, keys, turns: turnOf };
}

/** The line at the top of a scrolled view: its item's, `offset` lines in; the item folded away, its turn's line. -1: gone. */
export function anchorLine(v: Pick<ThreadView, 'keys' | 'turns'>, anchor: { key: string; offset: number }): number {
  const at = v.keys.indexOf(anchor.key);
  if (at >= 0) return at + anchor.offset;
  const turn = v.turns.get(anchor.key);
  return turn === undefined ? -1 : v.keys.indexOf(turn);
}

export const threadLines = (items: ThreadItem[], o: Omit<Opts, 'cap'> & { unfolded: boolean }): Line[] => threadView(items, o).lines;
