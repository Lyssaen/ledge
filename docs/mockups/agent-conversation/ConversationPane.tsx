// The side pane with the new « Conversation » tab (apps/desktop/src/session/SidePane.tsx's markup and classes: handle, tab bar,
// head with « Agrandir » / « Fermer »), and a document tab beside it to show the tab bar. Only ConversationTab is new.
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { SentItem, Session } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../../../apps/desktop/src/i18n/lang';
import { cls } from '../../../apps/desktop/src/shell/cls';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';
import { SessionBot } from '../../../apps/desktop/src/shell/SessionBot';
import { isLong } from '../../../apps/desktop/src/session/MessageCard';
import { atEnd, clock } from '../../../apps/desktop/src/session/exchanges';
import { clampSplit } from '../../../apps/desktop/src/session/prefs';
import { conversationCopy } from './copy';
import type { Bubble } from './conversation';

/** Two arrows, one each way: the pair in the head (SHELL_ICONS.exchange in the app). */
export const EXCHANGE = ['M4 8h14', 'm15 5 3 3-3 3', 'M20 16H6', 'm9 13-3 3 3 3'];
const STATUS_MARK: Record<SentItem['status'], string> = { delivered: '✓', read: '✓✓', sending: '…', failed: '✕' };
const GROWN = 0.65, DEFAULT_SPLIT = 0.5, SPLIT_STEP = 0.03;

export type PaneTabId = 'doc' | 'conv';

export interface ConversationPaneProps {
  tabs: readonly PaneTabId[]; active: PaneTabId; onActive(id: PaneTabId): void; onClose(id: PaneTabId): void;
  split: number; onSplit(v: number): void;
  self: Session;
  /** The peer's session; null: not one Ledge knows here (its raw name, one side only). */
  peer: Session | null; peerName: string;
  bubbles: readonly Bubble[];
  /** Messages the reader has not seen while the tab was not the active one (the tab's dot). */
  unseen: number;
  /** « dans le fil »: the message lit in this page's thread; `covered`: the pane lies over the thread (narrow). */
  onLight(id: string, covered: boolean): void;
  /** « voir son fil » on a message only the peer's thread holds yet, or in the head: the peer's page. */
  onOpenPeer(item?: string): void;
}

export function ConversationPane(p: ConversationPaneProps): JSX.Element {
  const { t, lang } = useI18n();
  const tp = t.session.pane;
  const tc = conversationCopy(lang);
  const pane = useRef<HTMLElement>(null);
  const { split, onSplit } = p;
  const set = (v: number) => { const x = clampSplit(v); if (x !== null && x !== split) onSplit(x); };
  // As SidePane: the pane takes what is right of the pointer.
  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const box = el.parentElement?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => set((box.right - ev.clientX) / box.width);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); set(split + SPLIT_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); set(split - SPLIT_STEP); }
  };
  const grown = split >= 0.6;
  const buttons = (
    <>
      <Button variant="ghost" size="sm" className="side-grow" onClick={() => onSplit(grown ? DEFAULT_SPLIT : GROWN)} title={grown ? tp.shrinkTitle : tp.growTitle}>
        <Icon d={SHELL_ICONS.split} size={13} />{grown ? tp.shrink : tp.grow}
      </Button>
      <Button variant="ghost" size="sm" className="side-close" onClick={() => p.onClose(p.active)} aria-label={tp.closeTitle} title={tp.closeShort}>
        <Icon d={ICONS.close.d} size={14} /><span>{tp.close}</span>
      </Button>
    </>
  );
  const labelOf = (id: PaneTabId) => (id === 'doc' ? 'read-at.md' : tc.tab(p.peerName));
  // In the narrow layout the pane is laid over the thread (session.css @container session ≤ 860 px).
  const covered = () => pane.current !== null && getComputedStyle(pane.current).position === 'absolute';

  return (
    <>
      <div className="split-handle" role="separator" aria-orientation="vertical" aria-label={tp.resize} tabIndex={0}
        onPointerDown={drag} onDoubleClick={() => onSplit(DEFAULT_SPLIT)} onKeyDown={onHandleKey} />
      <aside ref={pane} className="side-pane" aria-label={tp.label} tabIndex={-1}>
        {p.tabs.length > 1 && (
          <div className="pane-tabs" role="tablist" aria-label={tp.tabs}>
            {p.tabs.map(id => {
              const label = labelOf(id);
              const fresh = id === 'conv' && p.active !== 'conv' && p.unseen > 0;
              return (
                <div key={id} className={cls('pane-tab', id === p.active && 'current')}>
                  <button type="button" role="tab" aria-selected={id === p.active} onClick={() => p.onActive(id)}
                    aria-label={fresh ? tc.tabNew(p.peerName, p.unseen) : undefined}>
                    <Icon d={id === 'doc' ? SHELL_ICONS.file : SHELL_ICONS.mail} size={12} /><span>{label}</span>
                    {fresh && <i className="conv-tab-dot" aria-hidden="true" />}
                  </button>
                  <button type="button" className="tab-close" aria-label={tp.closeTab(label)} onClick={() => p.onClose(id)}><Icon d={ICONS.close.d} size={11} /></button>
                </div>
              );
            })}
          </div>
        )}
        {p.active === 'conv'
          ? <ConversationTab {...p} buttons={buttons} onLight={id => p.onLight(id, covered())} />
          : <DocTab buttons={buttons} />}
      </aside>
    </>
  );
}

/** The conversation: its head (the pair, the count, the peer's thread), then the messages of both agents, one bubble each,
 *  in the order they were sent; live, following the end while the reader is there. */
function ConversationTab({ self, peer, peerName, bubbles, buttons, onLight, onOpenPeer }: ConversationPaneProps & { buttons: ReactNode; onLight(id: string): void }): JSX.Element {
  const { t, lang } = useI18n();
  const tm = t.session.message;
  const tc = conversationCopy(lang);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const count = useRef(bubbles.length);
  const [fresh, setFresh] = useState(0);
  // Opened at the end (the latest message is what one comes for); a message that comes keeps the end in view while the
  // reader is there, else it is counted on the « n nouveaux messages » pill.
  useLayoutEffect(() => {
    const el = scroller.current;
    const added = bubbles.length - count.current;
    count.current = bubbles.length;
    if (!el) return;
    if (follow.current) el.scrollTop = el.scrollHeight;
    else if (added > 0) setFresh(f => f + added);
  }, [bubbles]);
  // The pane or a bubble changed size without a scroll (the pane resized, « Lire tout le message », the narrow pane fitting
  // above the reply): a reader at the end stays there, as in the thread.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (follow.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    follow.current = atEnd(el);
    if (follow.current) setFresh(0);
  };
  const toLatest = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  const name = (from: Bubble['from']) => (from === 'a' ? self.name : peerName);
  const bot = (from: Bubble['from']) => (from === 'a' ? <SessionBot session={self} size={14} /> : peer ? <SessionBot session={peer} size={14} /> : null);

  return (
    <>
      <div className="side-head conv-head">
        <span className="side-title conv-title">
          <span className="conv-pair">
            <SessionBot session={self} size={18} /><strong>{self.name}</strong>
            <Icon d={EXCHANGE} size={13} />
            {peer && <SessionBot session={peer} size={18} />}<strong title={peerName}>{peerName}</strong>
          </span>
          {bubbles.length > 0 && <span className="conv-count">{tc.count(bubbles.length)}</span>}
        </span>
        {peer && <button type="button" className="lnk message-link conv-peer" title={tm.seeIn(peerName)} onClick={() => onOpenPeer()}>{tm.seeTheirs}</button>}
        {buttons}
      </div>
      {/* Said once and kept in view, above the messages: the reader comes in at the end. */}
      {!peer && (
        <div className="conv-note" role="note">
          <Icon d={SHELL_ICONS.offline} size={15} />
          <span><strong>{tc.oneSidedLead}</strong> · {tc.oneSided(peerName, self.name)}</span>
        </div>
      )}
      <div className="conv-wrap">
        <div className="side-body conv-body" ref={scroller} onScroll={onScroll}>
          {/* The log stays mounted when empty, so the first message that comes is announced. */}
          {bubbles.length === 0 && <div className="changes-empty conv-empty"><Icon d={SHELL_ICONS.mail} size={22} /><strong>{tc.empty(self.name, peerName)}</strong><p>{tc.emptyHint}</p></div>}
          <ol className="conv-log" role="log" aria-label={tc.log(self.name, peerName)}>
            {bubbles.map((b, i) => (
              <BubbleRow key={b.key} b={b} first={bubbles[i - 1]?.from !== b.from} name={name(b.from)} to={name(b.from === 'a' ? 'b' : 'a')} bot={bot(b.from)}
                peerKnown={peer !== null} peerName={peerName} selfName={self.name} onLight={onLight} onOpenPeer={onOpenPeer} />
            ))}
          </ol>
        </div>
        {fresh > 0 && <button type="button" className="to-latest" onClick={toLatest}><Icon d={SHELL_ICONS.arrowDown} size={13} />{tc.fresh(fresh)}</button>}
      </div>
    </>
  );
}

/** One message: who wrote it (on the first of a run), its summary and body (clamped when long, as the thread's card), then
 *  its time, its delivery and where to find it. A's on the right, filled, as « sent » in the thread; B's on the left. */
function BubbleRow({ b, first, name, to, bot, peerKnown, peerName, selfName, onLight, onOpenPeer }: {
  b: Bubble; first: boolean; name: string; to: string; bot: ReactNode; peerKnown: boolean; peerName: string; selfName: string;
  onLight(id: string): void; onOpenPeer(item?: string): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const tm = t.session.message;
  const tc = conversationCopy(lang);
  const [more, setMore] = useState(false);
  const long = isLong(b.text);
  const mine = b.from === 'a';
  const status = b.status === 'read' ? tc.readBy(to) : b.status === 'delivered' ? tc.deliveredTo(to) : tm[b.status];
  // A click on the bubble (not on its links, not a selection) does what « dans le fil » does.
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (b.inA === undefined || (e.target as Element).closest('button, a') || String(window.getSelection() ?? '') !== '') return;
    onLight(b.inA);
  };
  return (
    <li className={cls('conv-row', mine ? 'mine' : 'theirs', first && 'first')}>
      <div className={cls('message-card conv-bubble', mine ? 'sent' : 'received', b.inA !== undefined && 'can-light')} role="article" data-bubble={b.key} onClick={click}>
        <span className="visually-hidden">{tc.kicker(name, to)}</span>
        {first && <span className="who conv-who" aria-hidden="true">{bot}<strong>{name}</strong></span>}
        {b.summary && <p className="message-summary">{b.summary}</p>}
        <div className={cls('message-body', long && !more && 'clamped')}><ThreadMarkdown text={b.text} /></div>
        {long && <button type="button" className="lnk message-link" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? tm.showLess : tm.readAll}<Icon d={ICONS.chevronRight.d} size={12} /></button>}
        <span className="who conv-meta">
          <time dateTime={b.at}>{clock(b.at)}</time>
          {' · '}
          <span className={cls('message-read', b.status === 'read' && 'is-read')} title={status}>
            <i aria-hidden="true">{STATUS_MARK[b.status]}</i>{b.status === 'read' ? tm.seen : b.status === 'delivered' ? tm.delivered : status}
          </span>
          {b.inA !== undefined
            ? <>{' · '}<button type="button" className="lnk message-link" title={tc.inThreadTitle(selfName)} onClick={() => onLight(b.inA!)}>{tc.inThread}</button></>
            : peerKnown && b.inB !== undefined && <>{' · '}<button type="button" className="lnk message-link" title={tm.seeIn(peerName)} onClick={() => onOpenPeer(b.inB)}>{tm.seeTheirs}</button></>}
        </span>
      </div>
    </li>
  );
}

/** The other tab: a document, as the app shows one (unchanged; only here for the tab bar). */
function DocTab({ buttons }: { buttons: ReactNode }): JSX.Element {
  return (
    <>
      <div className="side-head">
        <span className="side-title"><strong>Heure de lecture</strong><code>docs/notes/read-at.md</code></span>
        {buttons}
      </div>
      <div className="side-body">
        <div className="ledge-document conv-doc">
          <ThreadMarkdown text={'# Heure de lecture\n\nLa carte d’un message envoyé dit **quand** il a été lu : « lu à 14:05 ». Sans heure connue (un fil enregistré avant `readAt`), elle garde « lu ».\n\n- `sent.readAt` est posé par le daemon en même temps que `status: \'read\'`.\n- Le libellé anglais suit : « read at 14:05 ».'} />
        </div>
      </div>
    </>
  );
}
