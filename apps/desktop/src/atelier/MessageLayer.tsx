import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode, type RefObject } from 'react';
import { qualify, splitId } from '@ledge/fleet';
import { LEDGE_GIVER, transmissions, type Session, type Task, type TaskTransmission } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';

/** Messages between agents in the atelier (exchange.tsx, AtelierExchanges): the sender's bubble for 5 s and a dotted line to the
 *  receiver's seat with an envelope travelling along it (#27: no tag on the seats afterwards, the session's thread says it better).
 *  A task handed between agents (#92) travels the same way, as a ticket on a line in the task colour. */
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
/** A wire's end: a seat by its agent's id, or Ledge's corner (`ledge` in a task's log). */
type End = string | 'desk';
const endOf = (id: string): End => (id === LEDGE_GIVER ? 'desk' : id);
const placeOf = (shell: Element | null | undefined, end: End | undefined): HTMLElement | null =>
  end === 'desk' ? shell?.querySelector<HTMLElement>('.ledge-desk') ?? null : seatOf(shell, end);

/** One exchange in the atelier: a bubble over `from`, a dotted line to `to` with an envelope (a message) or a ticket (a task)
 *  travelling along it, `to` ringing when it lands. Without `from` on screen, nothing; without `to`, the bubble alone. */
function Wire({ from, to, kind, label, head, text, onOpen, still, layer }: {
  from: End; to: End | undefined; kind: 'message' | 'task'; label: string; head: ReactNode; text: string; onOpen(): void; still: boolean;
  layer: RefObject<HTMLDivElement | null>;
}): JSX.Element | null {
  const [geo, setGeo] = useState<Geo | null>(null);

  // Follows the two ends while the bubble shows (zoom, pan and the tables' layout move them); the shell's CSS zoom is divided out.
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const shell = layer.current?.parentElement;
      if (!shell) return;
      const box = shell.getBoundingClientRect();
      const z = box.width / (shell.offsetWidth || 1) || 1;
      const pt = (el: HTMLElement): Point => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / z, y: (r.top + 6 - box.top) / z }; };
      const sa = placeOf(shell, from), sb = placeOf(shell, to);
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
    for (const end of [from, to]) placeOf(shell, end)?.classList.toggle('exchange-lit', on);
  };
  // The receiving end rings when the envelope or the ticket lands (not with the animations frozen or reduced).
  useEffect(() => {
    if (still) return;
    const shell = layer.current?.parentElement;
    let ring: ReturnType<typeof setTimeout> | undefined;
    let place: HTMLElement | null = null;
    const land = setTimeout(() => {
      place = placeOf(shell, to);
      place?.classList.add('exchange-arrived');
      ring = setTimeout(() => place?.classList.remove('exchange-arrived'), RING_MS);
    }, TRAVEL_MS);
    return () => {
      clearTimeout(land); clearTimeout(ring); place?.classList.remove('exchange-arrived');
      for (const end of [from, to]) placeOf(shell, end)?.classList.remove('exchange-lit');
    };
  }, [still, layer, from, to]);

  if (!geo) return null;
  const task = kind === 'task';
  const fly = { offsetPath: `path('${geo.path}')` } as CSSProperties;
  return <>
    {geo.b && (
      <svg className={`exchange-wire${task ? ' task-wire' : ''}`} aria-hidden="true">
        <path d={geo.path} />
      </svg>
    )}
    {geo.b && !still && (task
      ? <span className="exchange-ticket" aria-hidden="true" style={fly}>
          <svg viewBox="0 0 24 20"><path className="exchange-ticket-body" d="M1.5 1.5h15l6 6v11h-21z" /><path className="exchange-ticket-fold" d="M16.5 1.5v6h6" /><path className="exchange-ticket-lines" d="M5 10h8M5 14h12" /></svg>
        </span>
      : <span className="exchange-envelope" aria-hidden="true" style={fly}>
          <svg viewBox="0 0 26 19"><rect className="exchange-envelope-body" x="1" y="1" width="24" height="17" rx="2.5" /><path className="exchange-envelope-flap" d="M1.8 2.4 13 10.6 24.2 2.4" /></svg>
        </span>
    )}
    <button type="button" className={`exchange-bubble${task ? ' task-bubble' : ''}`} style={{ left: geo.a.x, top: geo.a.y - 12 }}
      onMouseEnter={() => light(true)} onMouseLeave={() => light(false)} onFocus={() => light(true)} onBlur={() => light(false)}
      onClick={onOpen} aria-label={label}>
      <span className="exchange-bubble-to">{head}</span>
      <span className="exchange-bubble-text">{text}</span>
    </button>
  </>;
}

type Recent = { task: Task; tr: TaskTransmission };
/** Every transmission of a task in the last 5 s (its first sight counts when its date is ahead of the clock), and a render at
 *  the moment the next one ends. A give then a pass within 5 s are two. */
function useRecentTransmissions(tasks: readonly Task[]): Recent[] {
  const seen = useRef(new Map<string, number>());
  const [, setTick] = useState(0);
  const now = Date.now();
  let next = Infinity;
  const recent: Recent[] = [];
  for (const task of tasks) for (const tr of transmissions(task)) {
    const k = `${task.id}#${tr.index}`;
    if (!seen.current.has(k)) seen.current.set(k, now);
    const end = Math.min(Date.parse(tr.at), seen.current.get(k)!) + BUBBLE_MS;
    if (end <= now) continue;
    recent.push({ task, tr });
    next = Math.min(next, end);
  }
  const due = next === Infinity ? 0 : next;
  useEffect(() => { if (!due) return; const t = setTimeout(() => setTick(k => k + 1), Math.max(0, due - Date.now())); return () => clearTimeout(t); }, [due]);
  return recent;
}

export interface MessageLayerProps {
  sessions: readonly Session[]; clock: MessageClock; paused: boolean; reduced: boolean; dispatch: (a: NavAction) => void;
  /** The tasks the daemon knows: each hand-over under 5 s old draws its line, a ticket travelling along it. */
  tasks?: readonly Task[];
}

/** A layer over the atelier, the shell's first child: one bubble per session whose last message is less than 5 s old, and one per
 *  task hand-over as recent (#92). */
export function MessageLayer({ sessions, clock, paused, reduced, dispatch, tasks = [] }: MessageLayerProps): JSX.Element {
  const { t } = useI18n();
  const layer = useRef<HTMLDivElement>(null);
  const handed = useRecentTransmissions(tasks);
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const nameOf = (id: string, then: string) => byId.get(id)?.name ?? then;
  const shown = sessions.filter(s => isRecent(s, clock, BUBBLE_MS));
  const still = paused || reduced;
  return (
    <div ref={layer} className="exchange-layer" aria-live="polite">
      {shown.map(s => {
        const m = s.lastMessage!;
        const peerId = peerIdOf(s);
        const receiver = (peerId !== undefined ? byId.get(peerId)?.name : undefined) ?? m.to;
        return <Wire key={`${s.id}\n${m.id}`} from={s.id} to={peerId} kind="message" still={still} layer={layer}
          label={t.atelier.messageLabel(s.name, receiver, m.summary)} head={<><Icon d={SHELL_ICONS.mail} size={11} />{t.atelier.messageTo(receiver)}</>}
          text={m.summary} onOpen={() => dispatch({ type: 'open', id: s.id, item: m.id })} />;
      })}
      {handed.map(({ task, tr }) => {
        const from = nameOf(tr.from, tr.fromName), to = nameOf(tr.to, tr.toName);
        return <Wire key={`${task.id}#${tr.index}`} from={endOf(tr.from)} to={endOf(tr.to)} kind="task" still={still} layer={layer}
          label={t.atelier.taskLabel(tr.op, from, to, task.title)} head={<><Icon d={SHELL_ICONS.plan} size={11} />{t.atelier.taskTo[tr.op](to)}</>}
          text={tr.op === 'pass' && tr.note ? tr.note : task.title} onOpen={() => dispatch({ type: 'ledge', tab: 'tasks', task: task.id })} />;
      })}
    </div>
  );
}
