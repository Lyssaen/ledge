import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react';
import { qualify, splitId } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { SHELL_ICONS } from '../shell/icons';

/** Messages between agents in the atelier (exchange.tsx, AtelierExchanges and PeerTag): the sender's bubble for 5 s, a
 *  dotted line to the receiver's seat with a letter travelling along it, and a tag on both seats while the exchange is recent. */
export const BUBBLE_MS = 5000;
export const TAG_MS = 10 * 60_000;
const TRAVEL_MS = 1300;
const RING_MS = 1600;

type Sent = NonNullable<Session['lastMessage']>;

const ageOf = (m: Sent, now: number) => now - Date.parse(m.at);
/** The receiver's fleet id: `peer` is a raw daemon id, on the sender's machine. */
export const peerIdOf = (s: Session): string | undefined =>
  s.lastMessage?.peer === undefined ? undefined : qualify(splitId(s.id)?.machine ?? 'local', s.lastMessage.peer);

/** The atelier's clock for the messages: re-read when the sessions change, and at the next moment a bubble or a tag ends
 *  (a timeout to that moment, none while nothing is due). */
export function useMessageClock(sessions: readonly Session[]): number {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  // Something was due at the last reading: the sessions' other changes re-render nothing while no message is recent.
  const due = useRef(false);
  useEffect(() => {
    const n = Date.now();
    let next = Infinity;
    for (const s of sessions) {
      if (!s.lastMessage) continue;
      const at = Date.parse(s.lastMessage.at);
      for (const end of [at + BUBBLE_MS, at + TAG_MS]) if (end > n && end < next) next = end;
    }
    if (next !== Infinity || due.current) setNow(n);
    due.current = next !== Infinity;
    if (next === Infinity) return;
    const t = setTimeout(() => setTick(k => k + 1), next - n);
    return () => clearTimeout(t);
  }, [sessions, tick]);
  return now;
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
  // The receiver's seat rings when the letter lands (not with the animations frozen or reduced).
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
        {!still && <circle r="3.5" style={{ offsetPath: `path('${geo.path}')` } as CSSProperties} />}
      </svg>
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

export interface MessageLayerProps {
  sessions: readonly Session[]; now: number; paused: boolean; reduced: boolean; dispatch: (a: NavAction) => void;
}

/** A layer over the atelier, the shell's first child: one bubble per session whose last message is less than 5 s old. */
export function MessageLayer({ sessions, now, paused, reduced, dispatch }: MessageLayerProps): JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const shown = sessions.filter(s => s.lastMessage && ageOf(s.lastMessage, now) < BUBBLE_MS);
  return (
    <div ref={layer} className="exchange-layer" aria-live="polite">
      {shown.map(s => {
        const m = s.lastMessage!;
        const peerId = peerIdOf(s);
        const receiver = (peerId !== undefined ? byId.get(peerId)?.name : undefined) ?? m.to;
        return <Bubble key={`${s.id}\n${m.id}`} sender={s} message={m} peerId={peerId} receiver={receiver} still={paused || reduced} layer={layer} dispatch={dispatch} />;
      })}
    </div>
  );
}

/** The seat's tag (top-left: the « … » holds the top-right corner): the agents it wrote to or heard from less than 10 min
 *  ago, the latest first, « ✉ Name » or « ✉ Name +N ». */
export function PeerTag({ session, sessions, now }: { session: Session; sessions: readonly Session[]; now: number }): JSX.Element | null {
  const { t } = useI18n();
  const recent: { key: string; name: string; at: number }[] = [];
  const own = session.lastMessage;
  if (own && ageOf(own, now) < TAG_MS) {
    const peerId = peerIdOf(session);
    const peer = peerId !== undefined ? sessions.find(s => s.id === peerId) : undefined;
    recent.push({ key: peer?.id ?? `to:${own.to}`, name: peer?.name ?? own.to, at: Date.parse(own.at) });
  }
  for (const s of sessions) {
    if (s.id === session.id || !s.lastMessage || ageOf(s.lastMessage, now) >= TAG_MS || peerIdOf(s) !== session.id) continue;
    recent.push({ key: s.id, name: s.name, at: Date.parse(s.lastMessage.at) });
  }
  if (recent.length === 0) return null;
  recent.sort((a, b) => b.at - a.at);
  const names = [...new Map(recent.map(r => [r.key, r.name])).values()];
  const label = t.atelier.peerTag(names.join(', '));
  return (
    <span className="peer-tag" title={label}>
      <Icon d={SHELL_ICONS.mail} size={10} />{names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}
    </span>
  );
}
