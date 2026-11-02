import type { NoticeItem, ReceivedItem, RigInfo, SentItem, ThreadItem } from '@ledge/protocol';
import type { Glyphs } from '../glyphs.js';
import type { Messages } from '../i18n/lang.js';
import { C } from '../theme.js';
import { cells, cut, lineCells, pad, wrapSegs, type Line, type Seg } from './cells.js';
import { clock, oneLine } from './time.js';

/**
 * OpenRig's blocks in a seat's thread (docs/mockups/openrig-messages/page.html, section « TUI », validated 2026-11-02):
 * a received or sent `rig send` (✉), a queue row handed or passed (▤), OpenRig's own notices (·) and an unreadable block (?).
 * The daemon reads the prompt (`item.rig`); nothing here reads the text again.
 */

/** A Ledge session another seat is, when known: its id (to reply in it) and its name (Bix). */
export type Peer = { id: string; name: string };

export interface RigOpts {
  t: Messages; g: Glyphs; width: number; cap(n: number): number;
  /** The Ledge session of a thread item's `peer`. */
  peer?(id: string): Peer | undefined;
}

/** The OpenRig items of a thread: those with `rig`. */
export type RigItem = (ReceivedItem | SentItem | NoticeItem) & { rig: RigInfo };
export const rigOf = (it: ThreadItem): RigItem | undefined => ((it.kind === 'received' || it.kind === 'sent' || it.kind === 'notice') && it.rig ? (it as RigItem) : undefined);

/** A notice of OpenRig's that folds with the ones next to it: not a stuck sweep. */
export const foldsAway = (it: ThreadItem): boolean => { const r = rigOf(it); return !!r && r.kind === 'notice' && r.rig.kind === 'openrig' && r.rig.alert !== 'stalled'; };

/** `pilot-lead@ledge-dev-2`: its seat and its rig; anything else (a list, `broadcast to …`, `<unknown sender>`) is only a name. */
export function address(addr: string): { seat: string; rig?: string } {
  const m = /^([^@\s,]+)@([^@\s,]+)$/.exec(addr.trim());
  return m ? { seat: m[1]!, rig: m[2]! } : { seat: addr.trim() };
}

/** Who the other side is: its Ledge session's name when known (then its seat and rig faint), else its seat (then its rig). */
function who(addr: string, peer: Peer | undefined): { name: string; faint: string[]; peer?: Peer } {
  const a = address(addr);
  if (peer) return { name: peer.name, faint: [a.seat, ...(a.rig ? [a.rig] : [])], peer };
  return { name: a.seat, faint: a.rig ? [a.rig] : [] };
}

/** `…c07046`: the end of a row's id. */
export const shortId = (qitem: string | undefined, n: number, g: Glyphs): string => (qitem ? `${g.ellipsis}${qitem.slice(-n)}` : '');

/** The block's time: its `Sent:` stamp when it has one, in local time, else when it was received. */
export const rigClock = (it: RigItem): string => clock(it.rig.sentAt ?? it.at);

/** `head`, cut to leave room for `time` right-aligned at `width`. */
function headed(head: Line, time: string, width: number): Line {
  const left = cut(head, width - cells(time) - 2);
  return [...left, pad(width - lineCells(left) - cells(time)), { text: time, color: C.faint }];
}

/** The body quoted under the header, « … » on at most `max` lines; cut, it ends « …» inside the quote: `… »`. */
function quote(text: string, width: number, max: number, g: Glyphs): Line[] {
  const w = width - 4;
  const lines = wrapSegs([{ text: `« ${oneLine(text)} »`, color: C.dim }], w);
  if (lines.length <= max) return lines.map(l => [pad(4), ...l]);
  const kept = lines.slice(0, max);
  const last = kept[max - 1]!;
  kept[max - 1] = [...cut(last, w - 2 - cells(g.ellipsis), ''), { text: `${g.ellipsis} »`, color: C.dim }];
  return kept.map(l => [pad(4), ...l]);
}

const keysLine = (parts: string[]): Line => [pad(4), { text: parts.join(' · '), color: C.faint }];

/** The first non-empty line of a text. */
export const firstLine = (s: string): string => s.split('\n').map(l => l.trim()).find(Boolean) ?? '';

/** What `r` puts in the sender's composer: `À propos de : « <first line, 80 characters at most> »`, a blank line. */
export function aboutDraft(body: string, t: Messages, g: Glyphs): string {
  const line = firstLine(body);
  const chars = Array.from(line);
  const short = chars.length > 80 ? `${chars.slice(0, 80 - Array.from(g.ellipsis).length).join('')}${g.ellipsis}` : line;
  return `${t.session.about(short)}\n\n`;
}

/** The reply `r` gives on a received message: to its sender's Ledge session; none without one. */
export function replyOf(it: ThreadItem, o: Pick<RigOpts, 'peer'>): { peer: Peer; text: string } | undefined {
  const r = rigOf(it);
  if (!r || r.kind !== 'received' || r.rig.kind !== 'message' || !r.peer) return undefined;
  const peer = o.peer?.(r.peer);
  return peer ? { peer, text: r.text } : undefined;
}

/** An OpenRig notice's one line: the row's summary OpenRig carried, else its first line. */
const noticeText = (it: RigItem): string => oneLine(it.rig.summary ?? firstLine(it.text));

/** The lines of one OpenRig item. */
export function rigLines(it: RigItem, o: RigOpts): Line[] {
  const { t, g, width } = o, time = rigClock(it), r = it.rig;
  const bold = (text: string): Seg => ({ text, color: C.fg, bold: true });
  if (it.kind === 'received' && r.kind === 'message') {
    const w = who(r.from ?? it.from, it.peer ? o.peer?.(it.peer) : undefined);
    const count: Line = r.count ? [pad(2), { text: t.session.times(r.count), color: C.yellow }] : [];
    const seat = w.faint.length ? [{ text: ` ${w.faint[0]}`, color: C.faint }] : [];
    const rig = w.faint.length > 1 ? [{ text: ` · ${w.faint[1]}`, color: C.faint }] : [];
    const head: Line = [{ text: g.rigMessage, color: C.violet }, { text: ` ${t.session.receivedFrom} `, color: C.dim }, bold(w.name), ...seat];
    // The rig goes first when the line is short: the seat, then the count, stay.
    const full = [...head, ...rig, ...count];
    const first = headed(lineCells(full) + cells(time) + 2 <= width ? full : [...head, ...count], time, width);
    return [first, ...quote(it.text, width, o.cap(3), g), keysLine([...(w.peer ? [`r ${t.session.reply}`] : []), `b ${t.session.raw}`])];
  }
  if (it.kind === 'sent') {
    const to = r.to ?? it.to, w = who(to, it.peer ? o.peer?.(it.peer) : undefined);
    const status: Seg = it.status === 'delivered' ? { text: `${g.ok} ${t.session.sent.delivered}`, color: C.green }
      : it.status === 'read' ? { text: `${g.ok}${g.ok} ${t.session.sent.read}`, color: C.green }
      : it.status === 'failed' ? { text: `${g.fail} ${t.session.sent.failed}`, color: C.red } : { text: t.session.sent.sending, color: C.faint };
    // The seat alone: the rig is the seat's own, most of the time.
    const head: Line = [{ text: g.rigMessage, color: C.violet }, { text: ` ${t.session.sentTo} `, color: C.dim }, bold(w.name),
      ...(w.peer ? [{ text: ` ${w.faint[0]}`, color: C.faint }] : []), pad(2), status];
    const body = it.text.trim() ? quote(it.text, width, o.cap(1), g) : [];
    return [headed(head, time, width), ...body];
  }
  if (it.kind !== 'notice') return [];
  if (r.kind === 'handoff') {
    const out = it.outgoing === true;
    const w = who(out ? r.to ?? it.name ?? '' : it.name ?? r.from ?? '', it.peer ? o.peer?.(it.peer) : undefined);
    const id = shortId(r.qitem, 6, g);
    // The seat's own handoff OpenRig did not take: said so in red, with the first line of what OpenRig printed (the raw is
    // the command, then its output; all of it under b).
    const refused = out && it.status === 'refused';
    const state: Seg = refused ? { text: t.session.notHanded, color: C.red } : { text: t.session.untracked, color: C.faint };
    const head: Line = [{ text: `${g.rigRow} ${out ? t.session.rowOut : t.session.rowIn} `, color: C.violet }, bold(w.name),
      pad(2), state, ...(id ? [pad(2), { text: id, color: C.faint }] : [])];
    const summary = r.summary ?? it.summary;
    const log = out ? t.session.passedAt(time) : t.session.handedAt(time), keys = `b ${t.session.raw}`;
    let journal = keysLine([log, keys]);
    if (refused) {
      const said = r.raw.replace(/\r/g, '').split('\n').slice(1).map(l => l.trim()).find(Boolean);
      const why = said ? t.session.openrigSaid(said) : t.session.notHandedBy;
      // The output cut to leave the keys in sight.
      const room = width - 4 - cells(`${log} · `) - cells(` · ${keys}`);
      journal = [pad(4), { text: `${log} · `, color: C.faint }, ...cut([{ text: why, color: C.red }], Math.max(8, room), g.ellipsis), { text: ` · ${keys}`, color: C.faint }];
    }
    return [headed(head, time, width),
      ...(summary ? [[pad(4), ...cut([bold(oneLine(summary))], width - 4, g.ellipsis)]] : []),
      journal];
  }
  if (r.kind === 'unblocked') {
    return [headed([{ text: `${g.rigNotice} ${t.session.openrig} `, color: C.violet }, { text: t.session.unblocked(shortId(r.qitem, 4, g)), color: C.dim }], time, width)];
  }
  if (r.kind === 'openrig') {
    if (r.alert === 'stalled' && r.minutes !== undefined) {
      return [headed([{ text: `${g.rigNotice} ${t.session.openrig} `, color: C.yellow }, { text: t.session.stalled(shortId(r.qitem, 4, g), t.time.min(r.minutes)), color: C.yellow }], time, width)];
    }
    const kick = r.alert === 'stalled' ? C.yellow : C.violet;
    return [headed([{ text: `${g.rigNotice} ${t.session.openrig} `, color: kick }, { text: noticeText(it), color: r.alert === 'stalled' ? C.yellow : C.dim }], time, width)];
  }
  if (r.kind === 'unreadable') return unreadableLines(it, o);
  return [];
}

/** An unreadable block: said so, faint, then the block as is: its header up to its first `---` on one line (` / `), the rest
 *  line by line, at most 3 lines. */
function unreadableLines(it: RigItem, o: RigOpts): Line[] {
  const { t, width } = o;
  const raw = (it.rig.raw || it.text).replace(/\r/g, '').split('\n');
  const sep = raw.findIndex(l => l.trim() === '---');
  const head = sep < 0 ? raw : raw.slice(0, sep + 1), rest = sep < 0 ? [] : raw.slice(sep + 1);
  const shown = [head.map(l => l.trim()).filter(Boolean).join(' / '), ...rest.filter(l => l.trim())].filter(Boolean);
  const lines = shown.flatMap(l => wrapSegs([{ text: l, color: C.faint }], width - 4));
  const max = o.cap(3);
  const body = lines.length > max ? [...lines.slice(0, max - 1), [...cut(lines[max - 1]!, width - 4 - 6), { text: ` … +${lines.length - max + 1}`, color: C.faint }]] : lines;
  return [headed([{ text: `? ${t.session.unreadable}`, color: C.faint }], rigClock(it), width), ...body.map(l => [pad(4), ...l])];
}

/** Several of OpenRig's notices in a row, on one faint line: `· k avis OpenRig repliés · <their first lines>`. */
export function foldedNotices(items: RigItem[], o: RigOpts): Line {
  const { t, g, width } = o;
  const text = `${g.rigNotice} ${t.session.folded(items.length)} · ${items.map(noticeText).join(', ')}`;
  return headed([{ text, color: C.faint }], rigClock(items[items.length - 1]!), width);
}

/** The raw in its faint box, wrapped to the width: `┌ brut ──┐`, its lines, `└── b fermer ┘`. */
export function rawBox(raw: string, title: string, o: Pick<RigOpts, 't' | 'g' | 'width'>): Line[] {
  const { t, g } = o;
  const w = Math.max(16, o.width - 4), inner = w - 4;
  const f = (text: string): Seg => ({ text, color: C.faint });
  const top = `${g.boxTL} ${title} `, foot = ` b ${t.session.close} ${g.boxBR}`;
  const lines = raw.replace(/\r/g, '').split('\n').flatMap(l => wrapSegs([{ text: l }], inner).map(x => x.map(s => s.text).join('')));
  return [
    [pad(4), f(`${top}${g.boxH.repeat(Math.max(1, w - cells(top) - 1))}${g.boxTR}`)],
    ...lines.map(l => [pad(4), f(`${g.boxV} ${l}${' '.repeat(Math.max(0, inner - cells(l)))} ${g.boxV}`)]),
    [pad(4), f(`${g.boxBL}${g.boxH.repeat(Math.max(1, w - 1 - cells(foot)))}${foot}`)]
  ];
}
