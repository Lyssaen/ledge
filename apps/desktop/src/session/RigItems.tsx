/**
 * OpenRig's messages in a seat's thread (docs/mockups/ledge-openrig-messages.html, validated 2026-11-02, with its five
 * recommendations). The daemon reads the seat's prompt once and puts the result on the thread items (`rig`, see
 * packages/protocol/src/rigMessages.ts); these rows only render it, never reading the text again:
 *   a message      a received bubble (`received`), or the seat's own sent one (`sent`, its `rig send`);
 *   a handoff      the violet task card, « Ligne confiée par Bix » or « Ligne passée à Bix », its row's state read live;
 *   unblocked      a violet notice; OpenRig's own notice: a quiet line, amber for a stuck sweep, the others folded;
 *   unreadable     the block as is, in mono, never the user's words.
 * The raw text is one click away under each of them. No « Ouvrir la ligne » tonight: the row's detail is a new screen
 * (design-ux, 2026-11-02 21:23Z), its hook kept behind ROW_DETAIL.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { type NoticeItem, type ReceivedItem, type RigInfo, type RigRow, type SentItem, type Session } from '@ledge/protocol';
import { daemonStore, qualify, splitId, useMachines, type DaemonClient } from '@ledge/fleet';
import { useRigRow } from '@ledge/fleet/openrig';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { SessionBot } from '../shell/SessionBot';
import { STATUS_MARK } from './MessageCard';
import { clock } from './exchanges';

/** « Ouvrir la ligne » waits for its screen (a mockup and the user's validation): off until then. */
export const ROW_DETAIL = false;

type Rigged<T> = T & { rig: RigInfo };
export type RigReceived = Rigged<ReceivedItem>;
export type RigSent = Rigged<SentItem>;
export type RigNotice = Rigged<NoticeItem>;

/* ------------------------------------------------------------------ glyphs (the mockup's, 16 px grid) */

const G = {
  mail: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5 8 9l5.5-4.5" /></>,
  task: <><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></>,
  rig: <><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z" /><circle cx="8" cy="8" r="1.8" /></>,
  unlock: <><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" /></>,
  warn: <><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3" /><circle cx="8" cy="11.3" r=".4" fill="currentColor" /></>,
  reply: <><path d="M6.5 4 2.5 8l4 4" /><path d="M3 8h6.5a4 4 0 0 1 4 4v.5" /></>,
  chev: <path d="m6 3.5 4.5 4.5L6 12.5" />
};
function Glyph({ g, size = 13 }: { g: keyof typeof G; size?: number }): JSX.Element {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{G[g]}</svg>;
}

/* ------------------------------------------------------------------ names */

/** The seat part of an address (`pilot-lead@ledge-dev-2` → `pilot-lead`). */
export const seatOf = (address: string): string => address.split('@')[0] || address;
/** The rig part, when there is one. */
export const rigOf = (address: string): string | undefined => (address.includes('@') ? address.slice(address.indexOf('@') + 1) : undefined);
/** A queue row's short id: its last `n` characters after « … ». */
export const shortId = (qitem: string, n = 6): string => `…${qitem.slice(-n)}`;

/** The Ledge session of a seat (`Session.rig.seat`), on the thread's machine; null: none Ledge knows. */
export function seatSession(address: string | undefined, machine: string): Session | null {
  if (!address) return null;
  for (const s of daemonStore.getState().sessions) if (s.rig?.seat === address && (splitId(s.id)?.machine ?? 'local') === machine) return s;
  return null;
}
/** What a seat is called: its Ledge session's name, else its seat (`operator-agent`). */
export const nameOf = (address: string | undefined, session: Session | null): string => session?.name ?? (address ? seatOf(address) : '');

/** The reply's prefix in the sender's composer (design-ux, 21:23Z): the body's first non-empty line, cut at 80. */
export function aboutLine(text: string): string {
  const first = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  return first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
}

/* ------------------------------------------------------------------ pieces */

/** The raw text, folded under its element. */
export function RawDetails({ raw, label }: { raw: string; label: string }): JSX.Element {
  return (
    <details className="raw rig-raw">
      <summary><Glyph g="chev" size={11} /><span>{label}</span></summary>
      <pre>{raw}</pre>
    </details>
  );
}

/** Who wrote it: « De » / « À », the bot when Ledge knows the seat, its name, its seat in mono, its rig when it is not the thread's. */
function Who({ dir, address, session, selfRig, extra }: { dir: 'from' | 'to'; address: string | undefined; session: Session | null; selfRig?: string; extra?: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const r = t.session.rig;
  const rig = address ? rigOf(address) : undefined;
  return (
    <span className="who rig-who">
      <span>{dir === 'from' ? r.from : r.to}</span>
      {session && <SessionBot session={session} size={14} />}
      <strong>{nameOf(address, session)}</strong>
      {address && <span className="seat">{seatOf(address)}</span>}
      {rig && rig !== selfRig && <span className="rigtag">{rig}</span>}
      {extra}
    </span>
  );
}

export interface RigBubbleProps {
  item: RigReceived | RigSent;
  /** The session whose thread this is. */
  self: Session;
  /** The other seat's Ledge session (by `peer`, else by its address); null: none Ledge knows. */
  peer: Session | null;
  /** The raw to show under it: its own, a packet's joined raws on its last block, or none (an earlier block of a packet). */
  raw: { text: string; label: string } | null;
  /** « Répondre à Bix »: the sender's composer, prefixed. */
  onReply?(peer: Session, text: string): void;
  /** « voir son fil ». */
  onOpenPeer?(peer: Session): void;
}

/** A message between seats: received on the left (« De Bix pilot-lead »), the seat's own on the right (« À Ida · ✓ remis »). */
export function RigBubble({ item, self, peer, raw, onReply, onOpenPeer }: RigBubbleProps): JSX.Element {
  const { t } = useI18n();
  const r = t.session.rig, tm = t.session.message;
  const sent = item.kind === 'sent';
  const address = sent ? item.rig.to ?? item.to : item.rig.from ?? item.from;
  const name = nameOf(address, peer);
  const count = item.rig.count;
  const extra = <>
    {count && <span className="rig-dup">{r.twice(count)}</span>}
    {sent && <><span className="spacer" /><span className="message-read" title={item.status === 'read' ? tm.readBy(name) : tm[item.status]}><i aria-hidden="true">{STATUS_MARK[item.status]}</i>{item.status === 'read' ? tm.seen : item.status === 'delivered' ? r.delivered : tm[item.status]}</span></>}
  </>;
  return (
    <li className={cls('r message-row rig-row', item.kind)}>
      <span className="n node" aria-hidden="true"><Glyph g="mail" /></span>
      <div className={cls('message-card rig-card', item.kind)} data-message={item.id} data-rig="message" role="article">
        <span className="visually-hidden message-kicker">{sent ? tm.sent : tm.received}</span>
        <Who dir={sent ? 'to' : 'from'} address={address} session={peer} selfRig={self.rig?.name} extra={extra} />
        <div className="message-body"><ThreadMarkdown text={item.text} /></div>
        {(!sent && peer && (onReply || onOpenPeer)) || raw ? (
          <div className="rig-foot">
            {!sent && peer && onReply && <button type="button" className="lnk strong" onClick={() => onReply(peer, item.text)}><Glyph g="reply" size={12} />{r.replyTo(name)}</button>}
            {!sent && peer && onOpenPeer && <button type="button" className="lnk" onClick={() => onOpenPeer(peer)}>{r.seeTheirs}</button>}
            {raw && <RawDetails raw={raw.text} label={raw.label} />}
          </div>
        ) : null}
      </div>
      <span className="tm">{clock(item.at)}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ the row's state, read live */

/** The row's state while the card shows (decision 2: dev-back's useRigRow, asked again every 30 s while visible). Only a
 *  daemon that says it answers rows (`openrigRows`) is asked; `null`: not tracked. */
function useCardRow(client: DaemonClient, machine: string, qitem: string | undefined, el: React.RefObject<HTMLElement | null>): RigRow | null {
  const available = useMachines(client).find(m => m.id === machine)?.daemon?.openrigRows === true;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
  const { row } = useRigRow(client, available ? machine : null, qitem ?? null, visible && available);
  return available ? row : null;
}

type StateKey = 'pending' | 'taken' | 'passed' | 'blocked' | 'done' | 'unknown' | 'notHanded';
const STATE_OF: Record<string, StateKey> = { pending: 'pending', 'in-progress': 'taken', 'handed-off': 'passed', blocked: 'blocked', done: 'done' };

/** A queue row handed to this seat (« Ligne confiée par Bix ») or passed by it (« Ligne passée à Bix »): its summary, who
 *  holds it, its state and its short log (when Ledge reads the row back), its raw. */
export function RigTaskCard({ item, self, client, peer, raw }: { item: RigNotice; self: Session; client: DaemonClient; peer: Session | null; raw: { text: string; label: string } | null }): JSX.Element {
  const { t } = useI18n();
  const r = t.session.rig;
  const machine = splitId(self.id)?.machine ?? 'local';
  const card = useRef<HTMLDivElement>(null);
  const row = useCardRow(client, machine, item.rig.qitem, card);
  const out = item.outgoing === true;
  const other = out ? item.rig.to : item.rig.from ?? item.name;
  const otherSession = peer ?? seatSession(other, machine);
  const otherName = nameOf(other, otherSession);
  // The seat's own handoff that OpenRig did not take (design-ux, 21:37Z): « non transmise », OpenRig's reason in the log.
  const refused = out && item.status === 'refused';
  const key: StateKey = refused ? 'notHanded' : row ? STATE_OF[row.state] ?? 'unknown' : 'unknown';
  const passedTo = row?.handedOffTo ? nameOf(row.handedOffTo, seatSession(row.handedOffTo, machine)) : '';
  const stateText = row && !STATE_OF[row.state] ? row.state : key === 'passed' ? r.state.passed(passedTo) : r.state[key as Exclude<StateKey, 'passed'>];
  const tm = (iso: string | undefined) => (iso ? clock(iso) : '');
  const why = refused ? refusalOf(item.rig.raw) : null;
  const log = refused ? `${r.log.passed(tm(item.rig.sentAt ?? item.at))} · ${why ? r.refusedBy(why) : r.refusedPlain}` : row
    ? [out ? r.log.passed(tm(row.createdAt)) : r.log.handed(tm(row.createdAt)),
      row.claimedAt ? r.log.taken(tm(row.claimedAt)) : key === 'pending' ? r.log.notTaken : null,
      key === 'done' ? r.log.done(tm(row.updatedAt)) : null].filter(Boolean).join(' · ')
    : (out ? r.notTrackedOut : r.notTracked)(tm(item.rig.sentAt ?? item.at));
  const holder = row ? row.to : out ? item.rig.to : self.rig?.seat;
  const holderSession = holder ? seatSession(holder, machine) ?? (holder === self.rig?.seat ? self : null) : null;
  return (
    <li className="r rig-row rig-task-row">
      <span className="n node task" aria-hidden="true"><Glyph g="task" /></span>
      <div ref={card} className={cls('tcard', out && 'out')} data-notice={item.id} data-rig="handoff" role="article">
        <div className="k"><Glyph g="task" />
          <span>{out ? r.rowOut(otherName) : r.rowIn(otherName)}</span>
          {item.rig.qitem && <span className="id">{shortId(item.rig.qitem)}</span>}
          <span className="sp" />
          <span className={cls('st', key)} data-state={key}>{stateText}</span>
        </div>
        {item.rig.summary && <h4 title={item.rig.summary}>{item.rig.summary}</h4>}
        <div className="meta">
          {!out && other && <span>{r.rowFrom} <b>{otherName}</b> <span className="seat">{seatOf(other)}</span></span>}
          {out && other && <span>{r.rowTo} <b>{otherName}</b> <span className="seat">{seatOf(other)}</span></span>}
          {row && holder && !out && <span>{r.heldBy} <b>{nameOf(holder, holderSession)}</b> <span className="seat">{seatOf(holder)}</span></span>}
          {row?.state === 'blocked' && row.blockedOn && <span>{r.waitingOn(shortId(row.blockedOn))}</span>}
          <span>{log}</span>
        </div>
        {raw && <div className="row"><span className="sp" /><RawDetails raw={raw.text} label={raw.label} /></div>}
      </div>
      <span className="tm">{clock(item.at)}</span>
    </li>
  );
}

/** The first line OpenRig printed after the command (the raw: the command, then its output), cut at 120. */
export function refusalOf(raw: string): string | null {
  const line = raw.split('\n').slice(1).map(l => l.trim()).find(Boolean);
  if (!line) return null;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

/** A row unblocked, or OpenRig's own notice (a stuck sweep in amber; the rest is what OpenRig said, on one line). */
export function RigNoticeLine({ item, raw }: { item: RigNotice; raw: { text: string; label: string } | null }): JSX.Element {
  const { t } = useI18n();
  const r = t.session.rig;
  const unblocked = item.rig.kind === 'unblocked';
  const stalled = item.rig.alert === 'stalled';
  const id = item.rig.qitem ? shortId(item.rig.qitem, 4) : '';
  const title = unblocked ? r.unblocked(id) : stalled ? r.stalled(id, `${item.rig.minutes ?? 0} min`) : noticeText(item);
  const sub = unblocked ? (item.rig.blocker ? r.unblockedSub(shortId(item.rig.blocker, 4)) : null) : stalled ? r.fromDaemon : null;
  return (
    <li className="r rig-row notice-row">
      <span className={cls('n node', unblocked && 'task', stalled && 'warn')} aria-hidden="true"><Glyph g={unblocked ? 'unlock' : 'rig'} /></span>
      <div className={cls('notice-line', unblocked && 'task', stalled && 'warn')} data-notice={item.id} data-rig={item.rig.kind} role="note">
        <div className="notice-head"><span className="notice-kicker">{unblocked ? r.kicker : r.automatic}</span><span className="notice-title">{title}</span></div>
        {sub && <span className="notice-sub">{sub}</span>}
        {raw && <RawDetails raw={raw.text} label={raw.label} />}
      </div>
      <span className="tm">{clock(item.at)}</span>
    </li>
  );
}

/** What an OpenRig notice says, on one line: its body's first line. */
export const noticeText = (item: NoticeItem): string => (item.text.split('\n').map(l => l.trim()).find(Boolean) ?? '').replace(/^\[OpenRig\s*/, '').replace(/\]$/, '');

/** Quiet OpenRig notices in a row (no stuck sweep among them): one line, « 2 avis OpenRig · … », unfolded on a click. */
export function RigNoticeFold({ items, raws }: { items: RigNotice[]; raws: (item: RigNotice) => { text: string; label: string } | null }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (open) return <>{items.map(n => <RigNoticeLine key={n.id} item={n} raw={raws(n)} />)}</>;
  return (
    <li className="r rig-row notice-row">
      <span className="n node" aria-hidden="true"><Glyph g="rig" /></span>
      <div><button type="button" className="fold-row rig-fold" aria-expanded={false} onClick={() => setOpen(true)}>
        <Glyph g="chev" size={11} /><strong>{t.session.rig.folded(items.length)}</strong> · {items.map(noticeText).join(', ')}
      </button></div>
      <span className="tm">{clock(items[0]!.at)}</span>
    </li>
  );
}

/** A block that starts like an envelope but does not read to its end: shown as is, never as the user's words. */
export function RigUnreadable({ item }: { item: RigNotice }): JSX.Element {
  const { t } = useI18n();
  return (
    <li className="r rig-row">
      <span className="n node" aria-hidden="true"><Glyph g="warn" /></span>
      <div className="rig-bad" data-notice={item.id} data-rig="unreadable">
        <div className="who">{t.session.rig.unreadable}</div>
        <div className="rawbox">{item.rig.raw || item.text}</div>
      </div>
      <span className="tm">{clock(item.at)}</span>
    </li>
  );
}

/** Quiet notices fold; a stuck sweep, a handoff, a message or anything else stands alone. */
export const foldable = (i: ReceivedItem | NoticeItem): i is RigNotice => i.kind === 'notice' && i.rig?.kind === 'openrig' && i.rig.alert !== 'stalled';

/** The raw of an item, given the others in its exchange: an item of a packet shows none but the packet's last, which shows
 *  all of them joined; a repeated delivery says how many. */
export function rawOf(item: { rig: RigInfo }, all: ReadonlyArray<{ rig?: RigInfo }>, label: { one: string; many(k: number): string; deliveries(k: number): string }): { text: string; label: string } | null {
  // A packet's blocks show none: its one raw follows the group (packetRaw).
  if (item.rig.packet && all.filter(o => o.rig?.packet?.id === item.rig.packet!.id).length > 1) return null;
  return { text: item.rig.raw, label: item.rig.count ? label.deliveries(item.rig.count) : label.one };
}

/** After the last block of a packet the thread shows: the packet's one raw, its blocks' raws joined in order. */
export function packetRaw(item: { rig?: RigInfo }, all: ReadonlyArray<{ rig?: RigInfo }>, many: (k: number) => string): { text: string; label: string } | null {
  const p = item.rig?.packet;
  if (!p) return null;
  const same = all.filter(o => o.rig?.packet?.id === p.id).sort((a, b) => a.rig!.packet!.index - b.rig!.packet!.index);
  if (same.length < 2 || same.at(-1) !== item) return null;
  return { text: same.map(o => o.rig!.raw).join('\n'), label: many(p.count) };
}

/** The packet's raw as a row of its own, under the group (the mockup's « 2 messages collés ensemble · brut »). */
export function PacketRawRow({ raw }: { raw: { text: string; label: string } }): JSX.Element {
  return (
    <li className="r rig-row rig-packet-raw">
      <span className="n" />
      <div><RawDetails raw={raw.text} label={raw.label} /></div>
      <span className="tm" />
    </li>
  );
}

/** For tests and the page: the qualified id of a raw peer on the thread's machine. */
export const peerId = (machine: string, raw: string) => qualify(machine, raw);
