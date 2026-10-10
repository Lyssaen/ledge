import { useEffect, useRef, type RefObject } from 'react';
import { seedHash, type BotState } from './poseFor';

/** Spec section 6/7 microgesture timings (real time, independent of VITE_LEDGE_MOTION: callers disable motion instead). */
export const BOT_MOTION = {
  blinkMs: 180,
  gazePx: 1.4,
  gazeYPx: 0.3,
  askDelayMs: 180,
  askMs: 850,
  nodMs: 650
} as const;

/** First blink lands 1.4–4.9 s after mount to desynchronise bots; later ones every 3.4–6.7 s. */
export const blinkDelay = (h: number, cycle: number): number =>
  cycle === 0 ? 1400 + (h % 3500) : 3400 + ((h + cycle * 997) % 3300);
/** First gaze move 0.8–2.6 s after mount; later ones every 2.4–4.5 s. */
export const lookDelay = (h: number, cycle: number): number =>
  cycle === 0 ? 800 + (h % 1800) : 2400 + ((h + cycle * 557) % 2100);

/** States in which the bot stays still: closed eyes, concerned stillness, read-only fallback. */
const STILL: ReadonlySet<BotState> = new Set<BotState>(['done', 'error', 'readonly']);

interface Clock { h: number; blinkAt: number; lookAt: number; blinks: number; looks: number }

function setGaze(el: SVGSVGElement, x: number, y: number) {
  el.style.setProperty('--bot-gx', `${x}px`);
  el.style.setProperty('--bot-gy', `${y}px`);
}

/**
 * Per-bot blink/gaze scheduling and the one-shot approval hand gesture.
 * Deadlines live in a ref, so theme changes, renames and state changes between moving states never reset them.
 * Nothing is scheduled while disabled, still, the document is hidden, or the bot sits in an inert (inactive) layer.
 * The daemon's state is an input only; no timer ever changes it.
 */
export function useBotMotion(
  ref: RefObject<SVGSVGElement | null>,
  options: { seed: string; state: BotState; enabled: boolean; askKey?: string }
): void {
  const { seed, state, enabled, askKey } = options;
  const h = seedHash(seed);
  const ambient = enabled && !STILL.has(state);
  const stateRef = useRef(state);
  const clock = useRef<Clock | null>(null);
  const prevState = useRef(state);
  const prevAsk = useRef<string | undefined>(undefined);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ambient) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blinkEnd: ReturnType<typeof setTimeout> | undefined;
    const active = () => !document.hidden && !el.closest('[inert]');
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (blinkEnd !== undefined) clearTimeout(blinkEnd);
      timer = blinkEnd = undefined;
      el.removeAttribute('data-blink');
    };
    const schedule = () => {
      stop();
      if (!active()) return;
      const now = Date.now();
      if (!clock.current || clock.current.h !== h) clock.current = { h, blinkAt: now + blinkDelay(h, 0), lookAt: now + lookDelay(h, 0), blinks: 0, looks: 0 };
      const c = clock.current;
      // Resuming after a pause: skip missed beats rather than firing them all at once.
      if (c.blinkAt < now) c.blinkAt = now + blinkDelay(h, ++c.blinks);
      if (c.lookAt < now) c.lookAt = now + lookDelay(h, ++c.looks);
      timer = setTimeout(tick, Math.min(c.blinkAt, c.lookAt) - now);
    };
    const tick = () => {
      timer = undefined;
      const c = clock.current!;
      const now = Date.now();
      if (now >= c.blinkAt) {
        el.setAttribute('data-blink', 'true');
        if (blinkEnd !== undefined) clearTimeout(blinkEnd);
        blinkEnd = setTimeout(() => { blinkEnd = undefined; el.removeAttribute('data-blink'); }, BOT_MOTION.blinkMs);
        c.blinkAt = now + blinkDelay(h, ++c.blinks);
      }
      if (now >= c.lookAt) {
        c.looks++;
        const focused = stateRef.current === 'working';
        setGaze(el, focused ? (c.looks % 2 ? BOT_MOTION.gazePx : -BOT_MOTION.gazePx) : 0, focused ? BOT_MOTION.gazeYPx : 0);
        c.lookAt = now + lookDelay(h, c.looks);
      }
      timer = setTimeout(tick, Math.min(c.blinkAt, c.lookAt) - now);
    };
    schedule();
    const onVisibility = () => schedule();
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new MutationObserver(() => {
      const isActive = active();
      if (isActive && timer === undefined) schedule();
      else if (!isActive && timer !== undefined) stop();
    });
    observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['inert'] });
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, [ref, ambient, h]);

  // A state change recentres the gaze. The hand rises once, after the gaze settles, for each new approval request:
  // on a transition into `approval`, or when a new defined `askKey` arrives while in approval (including on mount).
  useEffect(() => {
    const el = ref.current;
    const prev = prevState.current;
    const prevKey = prevAsk.current;
    prevState.current = state;
    prevAsk.current = askKey;
    if (!el) return;
    if (prev !== state) setGaze(el, 0, 0);
    const newRequest = state === 'approval' && (prev !== 'approval' || (askKey !== undefined && askKey !== prevKey));
    if (!newRequest || !enabled || document.hidden || el.closest('[inert]')) return;
    let end: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    const start = setTimeout(() => {
      started = true;
      el.setAttribute('data-gesture', 'ask');
      end = setTimeout(() => { if (el.getAttribute('data-gesture') === 'ask') el.removeAttribute('data-gesture'); }, BOT_MOTION.askMs);
    }, BOT_MOTION.askDelayMs);
    return () => {
      clearTimeout(start);
      if (end !== undefined) clearTimeout(end);
      if (el.getAttribute('data-gesture') === 'ask') el.removeAttribute('data-gesture');
      // Cancelled before it began (e.g. StrictMode's mount/unmount/mount): let the next run still see the request as new.
      if (!started && prevAsk.current === askKey) prevAsk.current = prevKey;
    };
  }, [ref, state, enabled, askKey]);
}

/** One 650 ms nod each time `nodKey` changes: it confirms that a decision was received, never that the task succeeded. */
export function useBotNod(ref: RefObject<SVGSVGElement | null>, nodKey: number | undefined, enabled: boolean): void {
  const prev = useRef(nodKey);
  useEffect(() => {
    const el = ref.current;
    const changed = prev.current !== nodKey;
    prev.current = nodKey;
    if (!el || !changed || nodKey === undefined || !enabled) return;
    el.setAttribute('data-gesture', 'nod');
    const end = setTimeout(() => el.removeAttribute('data-gesture'), BOT_MOTION.nodMs);
    return () => {
      clearTimeout(end);
      if (el.getAttribute('data-gesture') === 'nod') el.removeAttribute('data-gesture');
    };
  }, [ref, nodKey, enabled]);
}
