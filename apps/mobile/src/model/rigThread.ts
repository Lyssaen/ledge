import type { PhoneRigRow, PhoneSession, RigInfo, ThreadItem as PcItem } from '@ledge/protocol';
import { copy, locale } from '../copy';

/**
 * OpenRig's blocks in a seat's thread, as the phone shows them (docs/mockups/openrig-messages, section « Téléphone »). The
 * daemon read the envelope once and put it on the item (`rig`): nothing here reads the block's text again.
 */

const R = copy.thread.rig;

/** Who an OpenRig block is from or to: the name of the seat's Ledge session when the phone knows it, else the seat
 *  itself; `seat` the mono word after it (the seat under a known name, the rig under a bare seat). */
export interface RigWho { name: string; seat?: string; session?: Pick<PhoneSession, 'id' | 'tool' | 'state'> }

/** A raw that unfolds under its element: what its toggle says, and the text. */
export interface RigRaw { label: string; text: string }

export type RigElement =
  | { key: string; kind: 'rig-message'; at: string; dir: 'in' | 'out'; who: RigWho; text: string; count?: number;
      delivery?: 'sending' | 'delivered' | 'read' | 'failed';
      /** « Répondre »: the sender's session, and what its composer is prefilled with. */ reply?: { sessionId: string; draft: string };
      raw?: RigRaw; cut?: true }
  | { key: string; kind: 'rig-task'; at: string; outgoing: boolean; who: RigWho; title: string; raw?: RigRaw; cut?: true;
      /** The seat's own handoff OpenRig did not take (`status: 'refused'`): the card's short log line. */ refused?: { log: string };
      /** The row whose live state the card shows while it is visible; absent when there is none to ask (refused, no id). */ qitem?: string }
  | { key: string; kind: 'rig-notice'; at: string; tone: 'plain' | 'task' | 'warn'; title: string; raw?: RigRaw; cut?: true }
  | { key: string; kind: 'rig-fold'; at: string; notices: Extract<RigElement, { kind: 'rig-notice' }>[] }
  /** The one raw of blocks pasted together, its own row after the packet. */
  | { key: string; kind: 'rig-raw'; at: string; raw: RigRaw }
  | { key: string; kind: 'rig-unreadable'; at: string; text: string; raw?: RigRaw; cut?: true };

/** A queue row's short id, as the mockup writes it: `…ffc1`. */
export const shortRow = (qitem: string | undefined): string => (qitem ? `…${qitem.slice(-4)}` : '…');

/** `pilot-lead@ledge-dev-2` → its seat and rig; an address without `@` (`<unknown sender>`) is all seat. */
function address(a: string): { seat: string; rig?: string } {
  const at = a.indexOf('@');
  return at > 0 ? { seat: a.slice(0, at), rig: a.slice(at + 1) } : { seat: a };
}

export function rigWho(addr: string | undefined, peer: string | undefined, sessions: ReadonlyMap<string, PhoneSession>): RigWho {
  const known = peer ? sessions.get(peer) : undefined;
  const { seat, rig } = address(addr ?? '');
  if (known) return { name: known.name, ...(seat ? { seat } : {}), session: { id: known.id, tool: known.tool, state: known.state } };
  return { name: seat || (addr ?? ''), ...(rig ? { seat: rig } : {}) };
}

/** The composer's prefix for « Répondre »: the body's first non-empty line, 80 characters at most (… included), as the desktop's. The phone types an
 *  instruction on one line (`UNTYPABLE` refuses a line break), so the prefix ends with a space, not a blank line. */
export function replyDraft(body: string): string {
  const line = body.split('\n').map(l => l.trim()).find(l => l !== '') ?? '';
  return `${R.about(cut80(line))} `;
}

/** A line cut to 80 characters at most, « … » included. */
const cut80 = (line: string): string => (line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line);

/** What OpenRig said to a handoff it refused: the first non-empty line of its output (the raw is the command, then what it printed). */
export function refusalLog(raw: string, passedAt: string): string {
  const said = raw.split('\n').slice(1).map(l => l.trim()).find(l => l !== '');
  return said ? R.refusedSaid(clock(passedAt), cut80(said)) : R.refusedSilent(clock(passedAt));
}

/** A time as the phone says it (local, `19:01`). */
export const clock = (iso: string): string => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

/** An item's OpenRig element, or undefined when it has no `rig` (it stays as the phone showed it before). */
export function rigElement(i: PcItem, sessions: ReadonlyMap<string, PhoneSession>, cut: boolean): RigElement | undefined {
  if ((i.kind !== 'received' && i.kind !== 'sent' && i.kind !== 'notice') || !i.rig) return undefined;
  const rig: RigInfo = i.rig;
  const at = rig.sentAt ?? i.at;
  const mark = cut ? { cut: true as const } : {};
  const raw = (label: string = R.raw): RigRaw => ({ label, text: rig.raw });
  if (rig.kind === 'unreadable') return { key: i.id, kind: 'rig-unreadable', at, text: rig.raw || ('text' in i ? i.text : ''), ...mark };
  if (i.kind === 'received') {
    const who = rigWho(rig.from ?? i.from, i.peer, sessions);
    return {
      key: i.id, kind: 'rig-message', at, dir: 'in', who, text: i.text, ...(rig.count ? { count: rig.count } : {}),
      ...(who.session ? { reply: { sessionId: who.session.id, draft: replyDraft(i.text) } } : {}),
      raw: raw(), ...mark
    };
  }
  if (i.kind === 'sent') {
    return { key: i.id, kind: 'rig-message', at, dir: 'out', who: rigWho(rig.to ?? i.to, i.peer, sessions), text: i.text, delivery: i.status, raw: raw(R.command), ...mark };
  }
  // A notice: a row handed or passed, a row unblocked, OpenRig's own word.
  if (rig.kind === 'handoff') {
    const outgoing = !!i.outgoing;
    const who = rigWho(outgoing ? rig.to : rig.from ?? i.name, i.peer, sessions);
    const refused = outgoing && i.status === 'refused' ? { refused: { log: refusalLog(rig.raw, i.at) } } : {};
    const ask = !('refused' in refused) && rig.qitem ? { qitem: rig.qitem } : {};
    return { key: i.id, kind: 'rig-task', at, outgoing, who, title: rig.summary ?? i.summary ?? i.text, raw: raw(outgoing ? R.command : R.raw), ...refused, ...ask, ...mark };
  }
  if (rig.kind === 'unblocked') return { key: i.id, kind: 'rig-notice', at, tone: 'task', title: R.unblocked(shortRow(rig.qitem)), raw: raw(), ...mark };
  if (rig.kind === 'openrig' && rig.alert === 'stalled') return { key: i.id, kind: 'rig-notice', at, tone: 'warn', title: R.stalled(shortRow(rig.qitem), rig.minutes ?? 0), raw: raw(), ...mark };
  // `openrig` (a custody check or any other word of OpenRig's), or a `message` that came as a notice: its first line.
  const first = i.text.split('\n').map(l => l.trim()).find(l => l !== '') ?? '';
  return { key: i.id, kind: 'rig-notice', at, tone: 'plain', title: first, raw: raw(), ...mark };
}

/** The packet an item belongs to, when OpenRig pasted several blocks in one prompt. */
const packetOf = (i: PcItem): RigInfo['packet'] => ((i.kind === 'received' || i.kind === 'sent' || i.kind === 'notice') ? i.rig?.packet : undefined);

/**
 * The raws of pasted blocks: their elements keep none of their own; one raw for the packet comes as its own row after the
 * packet's last element shown (« k messages collés ensemble · brut », the raws of its items joined in `packet.index` order).
 * `inPacket`: the ids that give up their raw; `after`: by the id of a packet's last element, the row that follows it.
 */
export function packetRaws(items: PcItem[]): { inPacket: Set<string>; after: Map<string, Extract<RigElement, { kind: 'rig-raw' }>> } {
  const groups = new Map<string, { id: string; items: { id: string; index: number; raw: string; at: string }[]; count: number }>();
  for (const i of items) {
    const p = packetOf(i);
    if (!p || !('rig' in i) || !i.rig) continue;
    const g = groups.get(p.id) ?? { id: p.id, items: [], count: p.count };
    g.items.push({ id: i.id, index: p.index, raw: i.rig.raw, at: i.at });
    groups.set(p.id, g);
  }
  const inPacket = new Set<string>();
  const after = new Map<string, Extract<RigElement, { kind: 'rig-raw' }>>();
  for (const g of groups.values()) {
    if (g.items.length < 2) continue; // the others fell off the phone's window: its own raw, as any block
    for (const x of g.items) inPacket.add(x.id);
    const last = g.items.at(-1)!;
    const text = [...g.items].sort((a, b) => a.index - b.index).map(x => x.raw).join('\n');
    after.set(last.id, { key: `packet-${g.id}`, kind: 'rig-raw', at: last.at, raw: { label: R.rawMany(g.count), text } });
  }
  return { inPacket, after };
}

/** Consecutive plain OpenRig notices fold into one line (« k avis OpenRig »); a stalled one never folds. */
export function foldNotices<T extends { key: string; kind: string }>(list: (T | RigElement)[]): (T | RigElement)[] {
  const out: (T | RigElement)[] = [];
  let run: Extract<RigElement, { kind: 'rig-notice' }>[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]!);
    else if (run.length > 1) out.push({ key: `fold-${run[0]!.key}`, kind: 'rig-fold', at: run[0]!.at, notices: run });
    run = [];
  };
  for (const e of list) {
    if (e.kind === 'rig-notice' && (e as Extract<RigElement, { kind: 'rig-notice' }>).tone === 'plain') { run.push(e as Extract<RigElement, { kind: 'rig-notice' }>); continue; }
    flush();
    out.push(e);
  }
  flush();
  return out;
}

/** A row's state as the card's pill says it (the mockup's `.st` variants), as on the desktop. */
export type RowStateKey = 'pending' | 'taken' | 'passed' | 'blocked' | 'done' | 'unknown';
const STATE_OF: Record<string, RowStateKey> = { pending: 'pending', 'in-progress': 'taken', 'handed-off': 'passed', blocked: 'blocked', done: 'done' };

/**
 * What a task card says of its row, read live: the pill (OpenRig's word as is when the phone does not know it) and the
 * short log (« confiée 19:02 · prise 19:02 · terminée 19:03 »; passed by this seat: « passée … »; pending: « pas encore prise »).
 * No row: « état non suivi », no log. `passée à` names the seat it went to (the phone does not map seats to sessions).
 */
export function rowView(row: PhoneRigRow | undefined, outgoing: boolean): { key: RowStateKey; text: string; log?: string } {
  if (!row) return { key: 'unknown', text: R.rowState.unknown };
  const key = STATE_OF[row.state] ?? 'unknown';
  const text = !STATE_OF[row.state] ? row.state : key === 'passed' ? R.rowState.passed(rigWho(row.handedOffTo, undefined, new Map()).name) : R.rowState[key as Exclude<RowStateKey, 'passed' | 'unknown'>];
  const log = [outgoing ? R.log.passed(clock(row.createdAt)) : R.log.handed(clock(row.createdAt)),
    row.claimedAt ? R.log.taken(clock(row.claimedAt)) : key === 'pending' ? R.log.notTaken : null,
    key === 'done' ? R.log.done(clock(row.updatedAt)) : null].filter(Boolean).join(' · ');
  return { key, text, log };
}
