import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react';
import { qualify, splitId } from '@ledge/fleet';
import { LEDGE_GIVER, type Session, type Task } from '@ledge/protocol';
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

/** A seat of the atelier, by its agent's id (compared as data, never built into a selector). */
const seatOf = (shell: Element | null | undefined, id: string | undefined): HTMLElement | null =>
  id === undefined || !shell ? null : [...shell.querySelectorAll<HTMLElement>('.agent-seat[data-agent]')].find(el => el.dataset.agent === id) ?? null;

type Point = { x: number; y: number };
type Geo = { a: Point; b: Point | null; path: string };

function Bubble({ sender, message, peerId, receiver, still, layer, dispatch }: {
  sender: Session; message: Sent; peerId: string | undefined; receiver: string; still: boolean;
  layer: RefObject<HTMLDivElement | null>; dispatch: (a: NavAction) => void;
}): JSX.Element | null {
  const { t } = useI18n();
  const [geo, setGeo] = useState<Geo | null>(null);

  // Follows the two seats while the bubble shows (zoom, pan and the tables' layout move them); the shell's CSS zoom is divided out.
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const shell = layer.current?.parentElement;
      if (!shell) return;
      const box = shell.getBoundingClientRect();
      const z = box.width / (shell.offsetWidth || 1) || 1;
      const pt = (el: HTMLElement): Point => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / z, y: (r.top + 6 - box.top) / z }; };
      const sa = seatOf(shell, sender.id), sb = seatOf(shell, peerId);
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
  }, [layer, sender.id, peerId]);

  // The two seats light up while the bubble is hovered or focused.
  const light = (on: boolean) => {
    const shell = layer.current?.parentElement;
    for (const id of [sender.id, peerId]) seatOf(shell, id)?.classList.toggle('exchange-lit', on);
  };
  // The receiver's seat rings when the envelope lands (not with the animations frozen or reduced).
  useEffect(() => {
    if (still) return;
    const shell = layer.current?.parentElement;
    let ring: ReturnType<typeof setTimeout> | undefined;
    let seat: HTMLElement | null = null;
    const land = setTimeout(() => {
      seat = seatOf(shell, peerId);
      seat?.classList.add('exchange-arrived');
      ring = setTimeout(() => seat?.classList.remove('exchange-arrived'), RING_MS);
    }, TRAVEL_MS);
    return () => {
      clearTimeout(land); clearTimeout(ring); seat?.classList.remove('exchange-arrived');
      for (const id of [sender.id, peerId]) seatOf(shell, id)?.classList.remove('exchange-lit');
    };
  }, [still, layer, sender.id, peerId]);

  if (!geo) return null;
  return <>
    {geo.b && (
      <svg className="exchange-wire" aria-hidden="true">
        <path d={geo.path} />
      </svg>
    )}
    {geo.b && !still && (
      <span className="exchange-envelope" aria-hidden="true" style={{ offsetPath: `path('${geo.path}')` } as CSSProperties}>
        <svg viewBox="0 0 26 19"><rect className="exchange-envelope-body" x="1" y="1" width="24" height="17" rx="2.5" /><path className="exchange-envelope-flap" d="M1.8 2.4 13 10.6 24.2 2.4" /></svg>
      </span>
    )}
    <button type="button" className="exchange-bubble" style={{ left: geo.a.x, top: geo.a.y - 12 }}
      onMouseEnter={() => light(true)} onMouseLeave={() => light(false)} onFocus={() => light(true)} onBlur={() => light(false)}
      onClick={() => dispatch({ type: 'open', id: sender.id, item: message.id })}
      aria-label={t.atelier.messageLabel(sender.name, receiver, message.summary)}>
      <span className="exchange-bubble-to"><Icon d={SHELL_ICONS.mail} size={11} />{t.atelier.messageTo(receiver)}</span>
      <span className="exchange-bubble-text">{message.summary}</span>
    </button>
  </>;
}

/** A task Ledge just gave (atelier rooms spec §3.3): the dotted line from Ledge's corner to its owner's seat, with its title,
 *  as for a message between sessions. */
function LedgeWire({ task, still, layer, dispatch }: { task: Task; still: boolean; layer: RefObject<HTMLDivElement | null>; dispatch: (a: NavAction) => void }): JSX.Element | null {
  const { t } = useI18n();
  const [geo, setGeo] = useState<Geo | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const shell = layer.current?.parentElement;
      if (!shell) return;
      const box = shell.getBoundingClientRect();
      const z = box.width / (shell.offsetWidth || 1) || 1;
      const pt = (el: HTMLElement): Point => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / z, y: (r.top + 6 - box.top) / z }; };
      const desk = shell.querySelector<HTMLElement>('.ledge-desk'), seat = seatOf(shell, task.owner);
      if (!desk || !seat) setGeo(null);
      else {
        const a = pt(desk), b = pt(seat);
        const path = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 70 - Math.abs(a.x - b.x) * 0.12} ${b.x} ${b.y}`;
        setGeo(g => (g && g.path === path ? g : { a, b, path }));
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [layer, task.owner]);
  if (!geo) return null;
  return <>
    <svg className="exchange-wire ledge-wire" aria-hidden="true"><path d={geo.path} /></svg>
    {!still && (
      <span className="exchange-envelope" aria-hidden="true" style={{ offsetPath: `path('${geo.path}')` } as CSSProperties}>
        <svg viewBox="0 0 26 19"><rect className="exchange-envelope-body" x="1" y="1" width="24" height="17" rx="2.5" /><path className="exchange-envelope-flap" d="M1.8 2.4 13 10.6 24.2 2.4" /></svg>
      </span>
    )}
    <button type="button" className="exchange-bubble ledge-bubble" style={{ left: geo.a.x, top: geo.a.y - 12 }}
      onClick={() => dispatch({ type: 'ledge', tab: 'tasks', task: task.id })} aria-label={t.atelier.ledgeTaskLabel(task.ownerName, task.title)}>
      <span className="exchange-bubble-to"><Icon d={SHELL_ICONS.mail} size={11} />{t.atelier.messageTo(task.ownerName)}</span>
      <span className="exchange-bubble-text">{task.title}</span>
    </button>
  </>;
}

/** The tasks Ledge gave in the last 5 s (their first sight counts when their date is ahead of the clock), and a render at the moment the last one ends. */
function useRecentLedgeTasks(tasks: readonly Task[]): Task[] {
  const seen = useRef(new Map<string, number>());
  const [, setTick] = useState(0);
  const now = Date.now();
  const recent = tasks.filter(x => {
    if (x.giver !== LEDGE_GIVER || x.log.length > 1) return false;
    if (!seen.current.has(x.id)) seen.current.set(x.id, now);
    const at = Math.min(Date.parse(x.at), seen.current.get(x.id)!);
    return now - at < BUBBLE_MS;
  });
  const ids = recent.map(x => x.id).join(',');
  useEffect(() => { if (!ids) return; const t = setTimeout(() => setTick(k => k + 1), BUBBLE_MS); return () => clearTimeout(t); }, [ids]);
  return recent;
}

export interface MessageLayerProps {
  sessions: readonly Session[]; clock: MessageClock; paused: boolean; reduced: boolean; dispatch: (a: NavAction) => void;
  /** The tasks Ledge gave: one just given draws its line from Ledge's corner to its owner's seat. */
  tasks?: readonly Task[];
}

/** A layer over the atelier, the shell's first child: one bubble per session whose last message is less than 5 s old. */
export function MessageLayer({ sessions, clock, paused, reduced, dispatch, tasks = [] }: MessageLayerProps): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const given = useRecentLedgeTasks(tasks);
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const shown = sessions.filter(s => isRecent(s, clock, BUBBLE_MS));
  return (
    <div ref={layer} className="exchange-layer" aria-live="polite">
      {shown.map(s => {
        const m = s.lastMessage!;
        const peerId = peerIdOf(s);
        const receiver = (peerId !== undefined ? byId.get(peerId)?.name : undefined) ?? m.to;
        return <Bubble key={`${s.id}\n${m.id}`} sender={s} message={m} peerId={peerId} receiver={receiver} still={paused || reduced} layer={layer} dispatch={dispatch} />;
      })}
      {given.map(x => <LedgeWire key={x.id} task={x} still={paused || reduced} layer={layer} dispatch={dispatch} />)}
    </div>
  );
}
