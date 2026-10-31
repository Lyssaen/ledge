import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode, type RefObject } from 'react';
import { qualify, splitId } from '@ledge/fleet';
import type { Exchange, Session } from '@ledge/protocol';
import { exchangeArcs, type Arc } from '@ledge/ui/rigs/model';
import type { AtelierRoom } from '@ledge/ui/rigs/scene';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';

/** Messages between agents in the atelier (exchange.tsx, AtelierExchanges): the sender's bubble for 5 s and a dotted line to the
 *  receiver's seat with an envelope travelling along it (#27: no tag on the seats afterwards, the session's thread says it better). */
export const BUBBLE_MS = 5000;
const TRAVEL_MS = 1300;
const RING_MS = 1600;

type Sent = NonNullable<Session['lastMessage']>;

/** The receiver's fleet id: `peer` is a raw daemon id, on the sender's machine. */
export const peerIdOf = (s: Session): string | undefined =>
  s.lastMessage?.peer === undefined ? undefined : qualify(splitId(s.id)?.machine ?? 'local', s.lastMessage.peer);

/** The atelier's clock for the messages. A message's time is the earlier of its date and the moment the atelier first saw
 *  it: a date ahead of the clock (another machine's skew) counts from its arrival, so it shows at once and for 5 s; a message
 *  first seen already old keeps its own date. */
export interface MessageClock {
  now: number;
  /** The session's last message's time (ms), or null without one. */
  timeOf(s: Session): number | null;
}
const seenKey = (s: Session) => `${s.id}\n${s.lastMessage!.id}`;
/** The age of the session's last message on `clock` (never negative), or null without one. */
const ageOf = (s: Session, clock: MessageClock): number | null => {
  const at = clock.timeOf(s);
  return at === null ? null : Math.max(0, clock.now - at);
};
const isRecent = (s: Session, clock: MessageClock, ms: number) => { const age = ageOf(s, clock); return age !== null && age < ms; };

/** Re-read when the sessions change, and at the next moment a bubble ends (a timeout to that moment, none while nothing is due). */
export function useMessageClock(sessions: readonly Session[]): MessageClock {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  // When each last message (by session and id) was first seen; dropped once no session carries it.
  const seen = useRef(new Map<string, number>());
  const timeOf = useMemo(() => {
    const n = Date.now(), live = new Set<string>();
    for (const s of sessions) {
      if (!s.lastMessage) continue;
      const k = seenKey(s);
      live.add(k);
      if (!seen.current.has(k)) seen.current.set(k, n);
    }
    for (const k of [...seen.current.keys()]) if (!live.has(k)) seen.current.delete(k);
    return (s: Session): number | null => {
      if (!s.lastMessage) return null;
      const at = Date.parse(s.lastMessage.at);
      return Math.min(at, seen.current.get(seenKey(s)) ?? at);
    };
  }, [sessions]);
  useEffect(() => {
    const n = Date.now();
    let next = Infinity;
    for (const s of sessions) {
      const at = timeOf(s);
      if (at === null) continue;
      const end = at + BUBBLE_MS;
      if (end > n && end < next) next = end;
    }
    // Always: the render must judge the ages with the clock the deadline was chosen with (an idle atelier's clock is stale).
    setNow(n);
    if (next === Infinity) return;
    const t = setTimeout(() => setTick(k => k + 1), next - n);
    return () => clearTimeout(t);
  }, [sessions, timeOf, tick]);
  return useMemo(() => ({ now, timeOf }), [now, timeOf]);
}

/** A seat of the atelier, by its agent's id, or a rig's placeholder seat by its `seat:` id (compared as data, never built into a selector). */
const seatOf = (shell: Element | null | undefined, id: string | undefined): HTMLElement | null =>
  id === undefined || !shell ? null : [...shell.querySelectorAll<HTMLElement>('.agent-seat[data-agent], .agent-seat[data-seat]')].find(el => (el.dataset.agent ?? el.dataset.seat) === id) ?? null;

/**
 * The exchanges between the seats of the rig and kernel tables shown (lot 3), as arcs (`exchangeArcs`, BUBBLE_MS): re-read when the
 * exchanges change and at the next moment a bubble ends. As for the messages, an exchange's time is the earlier of its date and the moment
 * the atelier first saw it (a remote clock ahead still shows it for 5 s).
 */
export function useExchangeArcs(rooms: readonly AtelierRoom[], exchanges: ReadonlyMap<string, readonly Exchange[]>, byId: ReadonlyMap<string, Session>): Arc[] {
  const seen = useRef(new Map<string, number>());
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const timed = useMemo(() => {
    const n = Date.now(), live = new Set<string>(), out = new Map<string, Exchange[]>();
    for (const [k, list] of exchanges) {
      out.set(k, list.map(x => {
        const id = `${k}\n${x.id}`;
        live.add(id);
        if (!seen.current.has(id)) seen.current.set(id, n);
        const at = Date.parse(x.at), first = seen.current.get(id)!;
        return first < at ? { ...x, at: new Date(first).toISOString() } : x;
      }));
    }
    for (const id of [...seen.current.keys()]) if (!live.has(id)) seen.current.delete(id);
    return out;
  }, [exchanges]);
  useEffect(() => {
    const n = Date.now();
    let next = Infinity;
    for (const list of timed.values()) for (const x of list) { const end = Date.parse(x.at) + BUBBLE_MS; if (end > n && end < next) next = end; }
    setNow(n);
    if (next === Infinity) return;
    const t = setTimeout(() => setTick(k => k + 1), next - n);
    return () => clearTimeout(t);
  }, [timed, tick]);
  return useMemo(() => rooms.flatMap(r => (r.kind === 'project' ? [] : exchangeArcs(timed.get(r.key) ?? [], r.rig, byId, now, BUBBLE_MS))), [rooms, timed, byId, now]);
}

type Point = { x: number; y: number };
type Geo = { a: Point; b: Point | null; path: string };
/** One message in the atelier: a bubble over `from`, a dotted line to `to` with an envelope travelling along it, `to` ringing
 *  when it lands. Without `from` on screen, nothing; without `to`, the bubble alone. */
function Wire({ from, to, label, head, text, onOpen, still, layer, ticket = false }: {
  from: string; to: string | undefined; label: string; head: ReactNode; text: string; onOpen(): void; still: boolean; ticket?: boolean;
  layer: RefObject<HTMLDivElement | null>;
}): JSX.Element | null {
  const [geo, setGeo] = useState<Geo | null>(null);

  // Follows the two ends while the bubble shows (zoom, pan and the tables' layout move them); the shell's CSS zoom is divided out.
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const shell = layer.current?.parentElement;
      // A wire mounted with the layer itself measures before the layer's ref is set: it tries again at the next frame.
      if (!shell) { raf = requestAnimationFrame(measure); return; }
      const box = shell.getBoundingClientRect();
      const z = box.width / (shell.offsetWidth || 1) || 1;
      const pt = (el: HTMLElement): Point => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / z, y: (r.top + 6 - box.top) / z }; };
      const sa = seatOf(shell, from), sb = seatOf(shell, to);
      if (!sa) setGeo(null);
      else {
        const a = pt(sa), b = sb ? pt(sb) : null;
        const path = b ? `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 70 - Math.abs(a.x - b.x) * 0.12} ${b.x} ${b.y}` : '';
        setGeo(g => (g && g.path === path && g.a.x === a.x && g.a.y === a.y ? g : { a, b, path }));
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [layer, from, to]);

  // The two ends light up while the bubble is hovered or focused.
  const light = (on: boolean) => {
    const shell = layer.current?.parentElement;
    for (const end of [from, to]) seatOf(shell, end)?.classList.toggle('exchange-lit', on);
  };
  // The receiving end rings when the envelope lands (not with the animations frozen or reduced).
  useEffect(() => {
    if (still) return;
    const shell = layer.current?.parentElement;
    let ring: ReturnType<typeof setTimeout> | undefined;
    let place: HTMLElement | null = null;
    const land = setTimeout(() => {
      place = seatOf(shell, to);
      place?.classList.add('exchange-arrived');
      ring = setTimeout(() => place?.classList.remove('exchange-arrived'), RING_MS);
    }, TRAVEL_MS);
    return () => {
      clearTimeout(land); clearTimeout(ring); place?.classList.remove('exchange-arrived');
      for (const end of [from, to]) seatOf(shell, end)?.classList.remove('exchange-lit');
    };
  }, [still, layer, from, to]);

  if (!geo) return null;
  const fly = { offsetPath: `path('${geo.path}')` } as CSSProperties;
  return <>
    {geo.b && (
      <svg className="exchange-wire" aria-hidden="true">
        <path d={geo.path} />
      </svg>
    )}
    {geo.b && !still && (
      <span className="exchange-envelope" aria-hidden="true" style={fly}>
        <svg viewBox="0 0 26 19"><rect className="exchange-envelope-body" x="1" y="1" width="24" height="17" rx="2.5" /><path className="exchange-envelope-flap" d="M1.8 2.4 13 10.6 24.2 2.4" /></svg>
      </span>
    )}
    <button type="button" className={ticket ? 'exchange-bubble exchange-ticket' : 'exchange-bubble'} style={{ left: geo.a.x, top: geo.a.y - 12 }}
      onMouseEnter={() => light(true)} onMouseLeave={() => light(false)} onFocus={() => light(true)} onBlur={() => light(false)}
      onClick={onOpen} aria-label={label}>
      <span className="exchange-bubble-to">{head}</span>
      <span className="exchange-bubble-text">{text}</span>
    </button>
  </>;
}

export interface MessageLayerProps {
  sessions: readonly Session[]; clock: MessageClock; paused: boolean; reduced: boolean; dispatch: (a: NavAction) => void;
  /** The exchanges between rig seats (lot 3), drawn the same way; a task or handoff shows as a ticket. A click opens Ledge's thread. */
  arcs?: readonly Arc[];
}

/** A layer over the atelier, the shell's first child: one bubble per session whose last message is less than 5 s old. */
export function MessageLayer({ sessions, clock, paused, reduced, dispatch, arcs = [] }: MessageLayerProps): JSX.Element {
  const { t } = useI18n();
  const layer = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const shown = sessions.filter(s => isRecent(s, clock, BUBBLE_MS));
  const still = paused || reduced;
  return (
    <div ref={layer} className="exchange-layer" aria-live="polite">
      {shown.map(s => {
        const m = s.lastMessage!;
        const peerId = peerIdOf(s);
        const receiver = (peerId !== undefined ? byId.get(peerId)?.name : undefined) ?? m.to;
        return <Wire key={`${s.id}\n${m.id}`} from={s.id} to={peerId} still={still} layer={layer}
          label={t.atelier.messageLabel(s.name, receiver, m.summary)} head={<><Icon d={SHELL_ICONS.mail} size={11} />{t.atelier.messageTo(receiver)}</>}
          text={m.summary} onOpen={() => dispatch({ type: 'open', id: s.id, item: m.id })} />;
      })}
      {arcs.map(a => {
        const ticket = a.kind === 'task' || a.kind === 'handoff';
        return <Wire key={`arc\n${a.fromId}\n${a.id}`} from={a.fromId} to={a.toId} still={still} layer={layer} ticket={ticket}
          label={t.atelier.messageLabel(a.fromName, a.toName, a.text)}
          head={<><Icon d={SHELL_ICONS.mail} size={11} />{ticket ? t.atelier.exchangeTicket(a.toName) : t.atelier.messageTo(a.toName)}</>}
          text={a.text} onOpen={() => dispatch({ type: 'ledge', tab: 'conversation' })} />;
      })}
    </div>
  );
}
