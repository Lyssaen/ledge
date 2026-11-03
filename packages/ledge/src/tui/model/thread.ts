import type { AttachmentRef, RigRow, ThreadItem, ToolItem } from '@ledge/protocol';
import { OPEN_TURNS, turns, type Turn } from '@ledge/ui/thread/turns';
import { rawTarget, SPINNER } from '@ledge/ui/thread/tools';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C, tone, type Tone } from '../theme.js';
import { cut, pad, row, wrapSegs, type Line, type Seg } from './cells.js';
import { markdownLines } from './markdown.js';
import { clock, oneLine, took } from './time.js';
import { foldedNotices, foldsAway, rawBox, replyOf, rigLines, rigOf, type Peer, type RigItem } from './rigLines.js';

export type { Seg, Line } from './cells.js';

/** One line for an attached image, to open with `key` (« o », « alt+o »): `  ▣ capture 1440×900 · 212 Ko · o ouvrir dans la visionneuse`. */
export function imageLine(ref: AttachmentRef, t: Messages, key: string): Line {
  return [{ text: `  ▣ ${t.images.capture} ${ref.width}×${ref.height} · ${t.images.size(ref.bytes)} · ${t.images.open(key)}`, color: C.faint }];
}

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
  const out = row([pad(2), status, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }], [{ text: rawTarget(it), color: C.fg }], meta, width, { max: o.cap(CAP.tool), more: more() });
  if (it.status === 'failed' && it.error) out.push(...row([pad(6)], [{ text: oneLine(it.error), color: C.red }], null, width, { max: o.cap(CAP.error), more: more() }));
  if (o.diffs) for (const f of it.files) {
    const lines = (f.diff ?? '').split('\n').filter(l => l && !l.startsWith('+++') && !l.startsWith('---'));
    // Each diff line wrapped; what goes on below it marked « ↪ ».
    for (const l of lines.slice(0, DIFF_MAX)) wrapSegs([{ text: l, color: l.startsWith('+') ? C.green : l.startsWith('-') ? C.red : C.faint }], width - 10, width - 8)
      .forEach((x, k) => out.push([{ text: `      ${g.bar} `, color: C.faint }, ...(k ? [{ text: `${g.cont} `, color: C.faint }] : []), ...x]));
    if (lines.length > DIFF_MAX) out.push([{ text: `      ${g.bar} ${g.ellipsis} ${lines.length - DIFF_MAX}`, color: C.faint }]);
  }
  for (const r of it.images ?? []) out.push(imageLine(r, t, 'o'));
  return out;
}

/** Read at each call: the palette changes with the theme. */
const more = (): Seg => ({ text: ' …', color: C.faint });

/** `now` only for the line's first value: a running action's spinner and time then tick in `ui/Lines.tsx`. */
/** `peer`: the Ledge session of a thread item's `peer` (an OpenRig sender's name, the reply `r` gives); `raws`: the OpenRig
 *  elements whose raw is open (key b). */
interface Opts { t: Messages; g: Glyphs; now?: number; width: number; diffs: boolean; ascii?: boolean; cap(n: number): number;
  peer?(id: string): Peer | undefined; raws?: ReadonlySet<string>;
  /** A queue row's state as last read, and a seat's Ledge name (OpenRig's task cards). */
  row?(qitem: string): RigRow | undefined; seat?(address: string): string | undefined }

/** Each text's lines, by item: the thread is drawn again at each change, and the store keeps the items that did not change.
 *  Past 500 texts the parser's own cache goes round and would parse them all again. */
const bodies = new WeakMap<ThreadItem, { width: number; g: Glyphs; tone: Tone; lines: Line[] }>();

function itemLines(it: ThreadItem, o: Opts): Line[] {
  const { t, g, width } = o;
  const body = (text: string, color: string) => {
    const was = bodies.get(it);
    if (was && was.width === width && was.g === g && was.tone === tone()) return was.lines;
    const lines = markdownLines(text, { width: width - 2, g, color }).map(l => [pad(2), ...l]);
    bodies.set(it, { width, g, tone: tone(), lines });
    return lines;
  };
  const rig = rigOf(it);
  if (rig) return rigLines(rig, o);
  const message = (head: Line, text: string, meta: Line | null) => row([pad(2), { text: `${g.message} `, color: C.violet }, ...head, pad(2)], [{ text: `« ${oneLine(text)} »`, color: C.dim }], meta, width, { indent: 4, max: o.cap(CAP.message), more: more() });
  switch (it.kind) {
    case 'prompt': return [[{ text: t.session.you, color: C.coral, bold: true }, { text: `  ${clock(it.at)}`, color: C.faint }], ...body(it.text, C.fg), ...(it.images ?? []).map(r => imageLine(r, t, 'o'))];
    case 'message': return body(it.text, C.dim);
    case 'reply': return body(it.text, C.fg);
    case 'tool': return toolLines(it, o);
    case 'permission':
      return row([pad(2), { text: g.approval, color: C.red }, { text: ` ${it.tool.padEnd(6)} `, color: C.dim }], [{ text: oneLine(it.text), color: C.fg }],
        it.decision ? [{ text: `${g.arrow} ${t.session.decision[it.decision]}`, color: C.faint }] : null, width, { max: o.cap(CAP.permission), more: more() });
    case 'helper':
      return row([{ text: `  ${g.helper} `, color: C.violet }], [{ text: it.agentType ? `${it.agentType} ` : '', color: C.dim }, { text: oneLine(it.task), color: C.violet }],
        [{ text: it.state === 'working' ? t.state.working : t.session.helperDone, color: C.faint }], width, { indent: 4, max: o.cap(CAP.helper), more: more() });
    case 'sent': {
      const status = it.status === 'read' ? `${g.ok}${g.ok} ` : it.status === 'delivered' ? `${g.ok} ` : '';
      return message([{ text: `${t.session.sentTo} `, color: C.dim }, { text: it.to, color: C.fg, bold: true }], it.summary ?? it.text,
        [{ text: `${status}${t.session.sent[it.status]}`, color: it.status === 'failed' ? C.red : it.status === 'sending' ? C.faint : C.green }]);
    }
    case 'received': return message([{ text: `${t.session.receivedFrom} `, color: C.dim }, { text: it.from, color: C.fg, bold: true }], it.text, null);
    // A task the session handed over (#92): its plain line says to whom; the summary alone is the title.
    case 'notice': return row([{ text: '  · ', color: C.faint }], [{ text: oneLine(it.outgoing ? it.text : it.summary ?? it.text), color: C.faint }], null, width, { max: o.cap(CAP.notice), more: more() });
  }
}

/** One folded turn: when it started, what was asked, how many actions and files, how it ended. */
export function foldedLine(turn: Turn, o: Pick<Opts, 't' | 'g'>): Line {
  const tools = turn.items.filter((i): i is ToolItem => i.kind === 'tool');
  const files = new Set(tools.flatMap(i => i.status === 'success' ? i.files.map(f => f.path) : []));
  const parts = [turn.prompt ? oneLine(turn.prompt.text) : '', o.t.session.actions(tools.length), ...(files.size ? [o.t.session.files(files.size)] : []), ...(turn.reply ? [oneLine(turn.reply.text)] : [])].filter(Boolean);
  return [{ text: `${o.g.folded} ${clock(turn.prompt?.at ?? turn.items[0]?.at ?? new Date(0).toISOString())}  `, color: C.faint }, { text: parts.join(' · '), color: C.faint }];
}

/** An OpenRig element of the thread (docs/mockups/openrig-messages): what key b shows (its raw, or its packet's), and the reply
 *  key r gives on a received message whose sender has a Ledge session. */
export type RigElement = { raw: string; title: string; reply?: { peer: Peer; text: string } };
/** `heads`: each OpenRig element's first line, where its selection mark goes (`markRig`). */
/** `cards`: the row each OpenRig task card is about, by its key (the rows to read while the card is in view). */
export type ThreadView = { lines: Line[]; keys: string[]; turns: Map<string, string>; rig: Map<string, RigElement>; heads: Map<string, number>; cards: Map<string, string> };

/** The rows of the task cards with a line between `top` and `bottom` (line indexes), once each. */
export function cardsInView(v: Pick<ThreadView, 'keys' | 'cards'>, top: number, bottom: number): string[] {
  const out = new Set<string>();
  for (let i = Math.max(0, top); i <= Math.min(bottom, v.keys.length - 1); i++) { const q = v.cards.get(v.keys[i]!); if (q) out.add(q); }
  return [...out];
}

/** The cells OpenRig's elements keep at their left for the selection mark, so that nothing moves when it moves. */
export const GUTTER = 2;
const gutter = (l: Line[]): Line[] => l.map(x => [pad(GUTTER), ...x]);

/** The thread's lines with the selected OpenRig element marked: ▸ in coral, in its reserved cells, on its first line. */
export function markRig(v: Pick<ThreadView, 'lines' | 'heads'>, key: string | undefined, g: Glyphs): Line[] {
  const at = key === undefined ? undefined : v.heads.get(key);
  if (at === undefined) return v.lines;
  const lines = v.lines.slice();
  lines[at] = [{ text: `${g.next} `, color: C.coral }, ...lines[at]!.slice(1)];
  return lines;
}

/** The raw b shows for an item: its own, or the joined raws of the blocks pasted with it (`rig.packet`), in their order. */
function rawOf(it: RigItem, packets: Map<string, RigItem[]>, t: Messages): { raw: string; title: string } {
  const p = it.rig.packet ? packets.get(it.rig.packet.id) : undefined;
  if (!p || p.length < 2) return { raw: it.rig.raw, title: t.session.raw };
  return { raw: p.map(x => x.rig.raw).join('\n\n'), title: t.session.rawMany(p.length) };
}

/** The session's main thread as lines, each with the item it shows (what a scroll stays on), and each item's turn (its first
 *  item's key: the folded turn's line). Past turns folded unless unfolded, the last OPEN_TURNS in full. Each element wraps at the
 *  real width, up to its ceiling unless unfolded. OpenRig's cards stand apart by a blank line; its notices in a row fold on
 *  one line (unless unfolded), a stuck sweep left out. */
export function threadView(items: ThreadItem[], o: Omit<Opts, 'cap'> & { unfolded: boolean }): ThreadView {
  const all = turns(items);
  const lines: Line[] = [], keys: string[] = [], turnOf = new Map<string, string>(), rig = new Map<string, RigElement>(), heads = new Map<string, number>(), cards = new Map<string, string>();
  const opts: Opts = { ...o, cap: n => (o.unfolded ? Infinity : n) };
  // OpenRig's elements drawn in the width less their gutter.
  const inner: Opts = { ...opts, width: o.width - GUTTER };
  const push = (key: string, l: Line[]) => { for (const x of l) { lines.push(x); keys.push(key); } };
  const packets = new Map<string, RigItem[]>();
  for (const it of items) { const r = rigOf(it); if (r?.rig.packet) packets.set(r.rig.packet.id, [...(packets.get(r.rig.packet.id) ?? []), r]); }
  for (const p of packets.values()) p.sort((a, b) => a.rig.packet!.index - b.rig.packet!.index);
  const blank = (l: Line | undefined) => !l || l.every(x => !x.text.trim());
  all.forEach((turn, i) => {
    const recent = i >= all.length - OPEN_TURNS;
    const first = turn.prompt?.id ?? turn.items[0]?.id ?? String(i);
    for (const it of turn.items) turnOf.set(it.id, first);
    if (!recent && !o.unfolded) { push(first, [cut(foldedLine(turn, o), o.width)]); return; }
    if (lines.length) push(first, [[{ text: '' }]]);
    let gap = false;
    for (let k = 0; k < turn.items.length; k++) {
      const it = turn.items[k]!, r = rigOf(it);
      const card = !!r && (r.kind !== 'notice' || r.rig.kind === 'handoff' || r.rig.kind === 'unreadable');
      // A card, and what follows one, stand apart by a blank line (never two, never at the turn's top).
      if ((card || gap) && lines.length && !blank(lines[lines.length - 1])) push(it.id, [[{ text: '' }]]);
      gap = card;
      if (r && foldsAway(it) && !o.unfolded) {
        let end = k;
        while (end + 1 < turn.items.length && foldsAway(turn.items[end + 1]!)) end++;
        if (end > k) {
          const run = turn.items.slice(k, end + 1).map(x => rigOf(x)!);
          heads.set(it.id, lines.length);
          push(it.id, gutter([foldedNotices(run, inner)]));
          const raw = run.map(x => x.rig.raw).join('\n\n');
          rig.set(it.id, { raw, title: o.t.session.rawMany(run.length) });
          if (o.raws?.has(it.id)) push(it.id, gutter(rawBox(raw, o.t.session.rawMany(run.length), inner)));
          k = end;
          continue;
        }
      }
      if (!r) { push(it.id, itemLines(it, opts)); continue; }
      heads.set(it.id, lines.length);
      if (r.kind === 'notice' && r.rig.kind === 'handoff' && r.rig.qitem && r.status !== 'refused') cards.set(it.id, r.rig.qitem);
      push(it.id, gutter(rigLines(r, inner)));
      const { raw, title } = rawOf(r, packets, o.t);
      const reply = replyOf(it, opts);
      rig.set(it.id, { raw, title, ...(reply ? { reply } : {}) });
      if (o.raws?.has(it.id)) push(it.id, gutter(rawBox(raw, title, inner)));
    }
  });
  return { lines, keys, turns: turnOf, rig, heads, cards };
}

/** The OpenRig element key b and r act on: the lowest one with a line in the view (`top`…`bottom`, line indexes). */
export function selectedRig(v: Pick<ThreadView, 'keys' | 'rig'>, top: number, bottom: number): string | undefined {
  for (let i = Math.min(bottom, v.keys.length - 1); i >= Math.max(0, top); i--) { const k = v.keys[i]!; if (v.rig.has(k)) return k; }
  return undefined;
}

/** The line at the top of a scrolled view: its item's, `offset` lines in; the item folded away, its turn's line. -1: gone. */
export function anchorLine(v: Pick<ThreadView, 'keys' | 'turns'>, anchor: { key: string; offset: number }): number {
  const at = v.keys.indexOf(anchor.key);
  if (at >= 0) return at + anchor.offset;
  const turn = v.turns.get(anchor.key);
  return turn === undefined ? -1 : v.keys.indexOf(turn);
}

export const threadLines = (items: ThreadItem[], o: Omit<Opts, 'cap'> & { unfolded: boolean }): Line[] => threadView(items, o).lines;
/** The images of the prompts and tool rows of the turns shown in full (the last OPEN_TURNS, or all unfolded), oldest first. */
export function threadImages(items: ThreadItem[], unfolded: boolean): AttachmentRef[] {
  const all = turns(items);
  return (unfolded ? all : all.slice(-OPEN_TURNS)).flatMap(turn => turn.items.flatMap(it => (it.kind === 'prompt' || it.kind === 'tool' ? it.images ?? [] : [])));
}
