import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { ThreadMarkdown } from '../../../apps/overlay/src/documents/MarkdownDocument';
import { THREADS, type Item, type Thread } from './sessions-data';

/** Messages between agents (Claude Code's SendMessage and the `<cross-session-message>` it delivers): a card in each
 *  thread, a bubble and a line between the two seats in the atelier, a « ↔ » tag on the seats while the exchange is recent. */

type Who = { id: string; name: string };
type Sent = Extract<Item, { kind: 'sent' }>;
type Received = Extract<Item, { kind: 'received' }>;
export type Exchange = Sent | Received;

export const mailIcon = ['M3 6h18v12H3z', 'm3 7 9 6 9-6'];
const arrowRight = ['M5 12h14', 'm13 6 6 6-6 6'];
const peerOf = (it: Exchange) => it.kind === 'sent' ? it.to : it.from;
const exchangesOf = (t: Thread | undefined) => (t?.turns ?? []).flatMap(tu => tu.items).filter((i): i is Exchange => i.kind === 'sent' || i.kind === 'received');

/* A tiny shared store: the folded conversations and the message to bring into view once its thread opens. */
const folded = new Set<string>();
let focusMid: string | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useStore = () => useSyncExternalStore(subscribe, () => version);
/** Opens `agent`'s session on the message `mid` (it scrolls into view and lights up). */
export const openOn = (open: (id: string) => void, agent: string, mid: string) => { focusMid = mid; open(agent); };

/** One message in a thread. The first one with a given peer carries the conversation's header, which folds them all. */
export function ExchangeCard({ item, self, agents, thread, bot, open }: {
  item: Exchange; self: Who; agents: Who[]; thread: Thread;
  bot: (a: Who, size: number) => ReactNode; open: (id: string) => void;
}) {
  useStore();
  const peerId = peerOf(item);
  const peer = agents.find(a => a.id === peerId) ?? { id: peerId, name: peerId };
  const key = self.id + ':' + peerId;
  const all = exchangesOf(thread).filter(i => peerOf(i) === peerId);
  const first = all[0]?.id === item.id;
  const isFolded = folded.has(key);
  const [more, setMore] = useState(false);
  const [lit, setLit] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Opened from elsewhere (the atelier's bubble, « Voir dans le fil de… »): this message comes into view, lit.
  useEffect(() => {
    if (focusMid !== item.mid) return;
    focusMid = null;
    if (folded.delete(key)) emit();
    const t = setTimeout(() => { ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setLit(true); setTimeout(() => setLit(false), 1800); }, 160);
    return () => clearTimeout(t);
  }, [item.mid, key]);

  const sent = item.kind === 'sent';
  const from = sent ? self : peer, to = sent ? peer : self;
  const theirs = exchangesOf(THREADS[peerId]).some(i => i.mid === item.mid);
  const long = item.text.length > 200 || item.text.split('\n').length > 3;
  const toggleAll = () => { if (isFolded) folded.delete(key); else folded.add(key); emit(); };
  const header = first && all.length > 1 && <div className="exchange-head">
    <Icon d={mailIcon} size={12} /><span>Échange avec <strong>{peer.name}</strong> · {all.length} messages</span><span className="spacer" />
    <button type="button" className="exchange-fold" aria-expanded={!isFolded} onClick={toggleAll}>{isFolded ? 'Déplier' : 'Replier'}<Icon d={['m6 9 6 6 6-6']} size={12} /></button>
  </div>;

  if (isFolded) return <>{header}<button type="button" ref={ref as unknown as React.Ref<HTMLButtonElement>} className={`exchange-line ${item.kind}`} data-exchange={item.mid} onClick={toggleAll} aria-label={`${from.name} à ${to.name} : ${sent ? item.summary : firstLine(item.text)}. Déplier l’échange`}>
    <span className="exchange-route">{bot(from, 14)}<strong>{from.name}</strong><Icon d={arrowRight} size={11} /><strong>{to.name}</strong></span>
    <span className="exchange-line-text">{sent ? item.summary : firstLine(item.text)}</span>
    {sent && <ReadMark read={item.read} peer={peer.name} short />}
  </button></>;

  return <>{header}<div ref={ref} className={`exchange-card ${item.kind} ${lit ? 'lit' : ''}`} data-exchange={item.mid} role="article" aria-label={sent ? `Message de ${self.name} à ${peer.name}` : `Message de ${peer.name} à ${self.name}`}>
    <div className="exchange-card-head">
      <span className="exchange-kicker"><Icon d={mailIcon} size={12} />{sent ? 'Message envoyé' : 'Message reçu'}</span>
      <span className="exchange-route">
        {bot(from, 18)}<strong>{from.name}</strong><Icon d={arrowRight} size={12} />{bot(to, 18)}<strong>{to.name}</strong>
      </span>
      <span className="spacer" />
      {sent && <ReadMark read={item.read} peer={peer.name} />}
    </div>
    {sent && <p className="exchange-summary">{item.summary}</p>}
    <div className={`exchange-body ${long && !more ? 'clamped' : ''}`}><ThreadMarkdown text={item.text} /></div>
    <div className="exchange-foot">
      {long && <button type="button" className="exchange-link" onClick={() => setMore(!more)}>{more ? 'Réduire' : 'Lire tout le message'}</button>}
      <span className="spacer" />
      {theirs
        ? <button type="button" className="exchange-link" onClick={() => openOn(open, peerId, item.mid)}>Voir dans le fil de {peer.name}<Icon d={ICONS.chevronRight.d} size={12} /></button>
        : <span className="muted">Pas encore dans le fil de {peer.name}</span>}
    </div>
  </div></>;
}

const firstLine = (t: string) => t.split('\n')[0]!.replace(/[`*]/g, '');
function ReadMark({ read, peer, short }: { read: boolean; peer: string; short?: boolean }) {
  return <span className={`exchange-read ${read ? 'is-read' : ''}`} title={read ? `${peer} l’a lu` : `Remis à ${peer}, pas encore lu : il le lira à sa prochaine action`}>
    <i aria-hidden="true">{read ? '✓✓' : '✓'}</i>{short ? null : read ? `Lu par ${peer}` : 'Remis, pas encore lu'}
  </span>;
}

/* ---------- Atelier ---------- */

/** The sent messages the atelier replays, in this order (simulated: as if they were happening now). */
const REPLAY = ['x4', 'x1', 'x2', 'x3'];
const SENT: { from: string; item: Sent }[] = Object.entries(THREADS).flatMap(([from, t]) => exchangesOf(t).filter((i): i is Sent => i.kind === 'sent').map(item => ({ from, item })));
const SHOW_MS = 5000, EVERY_MS = 8000, TRAVEL_MS = 1300;

/** Who exchanged with whom recently: a seat's « ↔ » tag. */
export function PeerTag({ id, agents }: { id: string; agents: Who[] }) {
  const peers = [...new Set([...exchangesOf(THREADS[id]).map(peerOf), ...SENT.filter(s => s.item.to === id).map(s => s.from)])].map(p => agents.find(a => a.id === p)).filter(Boolean) as Who[];
  if (!peers.length) return null;
  return <span className="peer-tag" title={`Échange récent avec ${peers.map(p => p.name).join(', ')}`} aria-label={`Échange récent avec ${peers.map(p => p.name).join(', ')}`}>
    <Icon d={mailIcon} size={10} />{peers[0]!.name}{peers.length > 1 ? ` +${peers.length - 1}` : ''}
  </span>;
}

type Geo = { a: { x: number; y: number }; b: { x: number; y: number } | null; path: string };

/** A layer over the atelier: the sender's bubble (5 s), a dotted line to the receiver with a letter travelling along it. */
export function AtelierExchanges({ agents, paused, open }: { agents: Who[]; paused: boolean; open: (id: string) => void }) {
  const [step, setStep] = useState(-1);
  const [geo, setGeo] = useState<Geo | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const shown = step >= 0 ? SENT.find(s => s.item.mid === REPLAY[step % REPLAY.length]) : undefined;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => { setStep(s => s + 1); setVisible(true); }, step < 0 ? 1600 : EVERY_MS);
    return () => clearTimeout(t);
  }, [step, paused]);
  useEffect(() => { if (!visible || paused) return; const t = setTimeout(() => setVisible(false), SHOW_MS); return () => clearTimeout(t); }, [visible, step, paused]);

  // Follows the two seats while the bubble shows (zoom, pan and the table layout move them).
  useLayoutEffect(() => {
    if (!shown || !visible) { setGeo(null); return; }
    let raf = 0;
    const measure = () => {
      const shell = layer.current?.parentElement; if (!shell) return;
      const box = shell.getBoundingClientRect(); const z = box.width / (shell.offsetWidth || 1) || 1;
      const seat = (id: string) => shell.querySelector<HTMLElement>(`.agent-seat[data-agent="${id}"]`);
      const pt = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / z, y: (r.top + 6 - box.top) / z }; };
      const sa = seat(shown.from), sb = seat(shown.item.to);
      if (!sa) { setGeo(null); return; }
      const a = pt(sa), b = sb ? pt(sb) : null;
      const path = b ? `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 70 - Math.abs(a.x - b.x) * 0.12} ${b.x} ${b.y}` : '';
      setGeo(g => g && g.path === path && g.a.x === a.x && g.a.y === a.y ? g : { a, b, path });
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [shown, visible]);

  // The two seats light up while the bubble is hovered, the receiver pulses when the letter lands.
  const light = (on: boolean) => { const shell = layer.current?.parentElement; if (!shell || !shown) return; for (const id of [shown.from, shown.item.to]) shell.querySelector(`.agent-seat[data-agent="${id}"]`)?.classList.toggle('exchange-lit', on); };
  useEffect(() => {
    if (!shown || !visible) return;
    const shell = layer.current?.parentElement;
    const t = setTimeout(() => { const el = shell?.querySelector(`.agent-seat[data-agent="${shown.item.to}"]`); el?.classList.add('exchange-arrived'); setTimeout(() => el?.classList.remove('exchange-arrived'), 1600); }, paused ? 0 : TRAVEL_MS);
    return () => { clearTimeout(t); light(false); };
  }, [shown, visible]);

  const name = (id: string) => agents.find(a => a.id === id)?.name ?? id;
  return <div ref={layer} className={`exchange-layer ${paused ? 'is-paused' : ''}`} aria-live="polite">
    {shown && visible && geo && <>
      {geo.b && <svg className="exchange-wire" aria-hidden="true"><path d={geo.path} />{!paused && <circle r="3.5" style={{ offsetPath: `path('${geo.path}')` } as React.CSSProperties} key={shown.item.mid + step} />}</svg>}
      <button type="button" key={'b' + step} className="exchange-bubble" style={{ left: geo.a.x, top: geo.a.y - 12 }}
        onMouseEnter={() => light(true)} onMouseLeave={() => light(false)} onFocus={() => light(true)} onBlur={() => light(false)}
        onClick={() => openOn(open, shown.from, shown.item.mid)}
        aria-label={`${name(shown.from)} écrit à ${name(shown.item.to)} : ${shown.item.summary}. Ouvrir l’échange`}>
        <span className="exchange-bubble-to"><Icon d={mailIcon} size={11} />à {name(shown.item.to)}</span>
        <span className="exchange-bubble-text">{shown.item.summary}</span>
      </button>
    </>}
  </div>;
}
