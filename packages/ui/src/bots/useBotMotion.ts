import { useEffect, useRef, type RefObject } from 'react';
import { seedHash, type BotState } from './poseFor';

/** Spec section 6/7 microgesture timings (real time, independent of VITE_LEDGE_MOTION: callers disable motion instead). */
export const BOT_MOTION = {
  blinkMs: 180,
  gazePx: 1.4,
  gazeYPx: 0.3,
  askDelayMs: 180,
  transitionMs: 500,
  hopMs: 480,
  touchMs: 360,
  idleMs: 1700,
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

interface Clock { h: number; blinkAt: number; lookAt: number; idleAt: number; blinks: number; looks: number; idles: number }
const idleDelay = (h: number, cycle: number) => cycle === 0 ? 3500 + h % 4000 : 5500 + (h + cycle * 557) % 3500;

const active = (el: SVGSVGElement) => !document.hidden && !el.closest('[inert]');
/** Recheck at callbacks too: mutation observers are asynchronous. */
function watchActivity(el: SVGSVGElement, change: () => void) {
  document.addEventListener('visibilitychange', change);
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['inert'] });
  return () => { document.removeEventListener('visibilitychange', change); observer.disconnect(); };
}

/** CSS loops also stop in a hidden document, including on small bots with no JS microgestures. */
export function useBotVisibility(ref: RefObject<SVGSVGElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => el.setAttribute('data-suspended', String(!active(el)));
    sync();
    return watchActivity(el, sync);
  }, [ref]);
}

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
  options: { seed: string; state: BotState; enabled: boolean; askKey?: string; nodKey?: number }
): void {
  const { seed, state, enabled, askKey, nodKey } = options;
  const h = seedHash(seed);
  const ambient = enabled && !STILL.has(state);
  const clock = useRef<Clock | null>(null);
  const prevState = useRef(state);
  const prevNod = useRef(nodKey);
  const prevAsk = useRef<string | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ambient) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blinkEnd: ReturnType<typeof setTimeout> | undefined;
    let idleEnd: ReturnType<typeof setTimeout> | undefined;
    const isActive = () => active(el);
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (blinkEnd !== undefined) clearTimeout(blinkEnd);
      if (idleEnd !== undefined) clearTimeout(idleEnd);
      timer = blinkEnd = idleEnd = undefined;
      el.removeAttribute('data-idle');
      setGaze(el, 0, 0);
      el.removeAttribute('data-blink');
    };
    const schedule = () => {
      stop();
      if (!isActive()) return;
      const now = Date.now();
      if (!clock.current || clock.current.h !== h) clock.current = { h, blinkAt: now + blinkDelay(h, 0), lookAt: now + lookDelay(h, 0), idleAt: now + idleDelay(h, 0), blinks: 0, looks: 0, idles: 0 };
      const c = clock.current;
      // Resuming after a pause: skip missed beats rather than firing them all at once.
      if (c.blinkAt < now) c.blinkAt = now + blinkDelay(h, ++c.blinks);
      if (c.lookAt < now) c.lookAt = now + lookDelay(h, ++c.looks);
      if (c.idleAt < now) c.idleAt = now + idleDelay(h, ++c.idles);
      timer = setTimeout(tick, Math.min(c.blinkAt, c.lookAt, c.idleAt) - now);
    };
    const tick = () => {
      timer = undefined;
      if (!isActive()) { stop(); return; }
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
        const focused = state === 'working';
        if (!el.hasAttribute('data-hover') && !el.hasAttribute('data-transition')) setGaze(el, focused ? (c.looks % 2 ? BOT_MOTION.gazePx : -BOT_MOTION.gazePx) : 0, focused ? BOT_MOTION.gazeYPx : 0);
        c.lookAt = now + lookDelay(h, c.looks);
      }
      if (now >= c.idleAt) {
        c.idles++;
        const current = state;
        if (!el.hasAttribute('data-hover') && !el.hasAttribute('data-transition') && (current === 'idle' || current === 'question')) {
          el.setAttribute('data-idle', current === 'question' ? 'tilt' : c.idles % 4 === 0 ? 'stretch' : 'look');
          idleEnd = setTimeout(() => { idleEnd = undefined; el.removeAttribute('data-idle'); }, BOT_MOTION.idleMs);
        }
        c.idleAt = now + idleDelay(h, c.idles);
      }
      timer = setTimeout(tick, Math.min(c.blinkAt, c.lookAt, c.idleAt) - now);
    };
    schedule();
    const unwatch = watchActivity(el, () => {
      if (isActive() && timer === undefined) schedule();
      else if (!isActive()) stop();
    });
    return () => { stop(); unwatch(); };
  }, [ref, ambient, h, state]);

  // Consume events even while disabled: resuming never replays stale business transitions.
  useEffect(() => {
    const el = ref.current;
    const prev = prevState.current;
    const prevKey = prevAsk.current;
    const acknowledged = prevNod.current !== nodKey && nodKey !== undefined;
    prevNod.current = nodKey;
    prevState.current = state;
    prevAsk.current = askKey;
    if (!el) return;
    setGaze(el, 0, 0);
    el.removeAttribute('data-idle');
    const newRequest = state === 'approval' && (prev !== 'approval' || (askKey !== undefined && askKey !== prevKey));
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); if (active(el)) fn(); else stop(); }, delay);
      timers.add(timer);
      return timer;
    };
    const stop = () => {
      timers.forEach(clearTimeout); timers.clear();
      ['data-transition', 'data-gesture', 'data-touch', 'data-hover', 'data-idle'].forEach(a => el.removeAttribute(a));
      setGaze(el, 0, 0);
    };
    let started = false;
    let interrupted = false;
    if (enabled && active(el)) {
      if (prev !== state && ['working', 'question', 'idle', 'done', 'error'].includes(state)) {
        el.setAttribute('data-transition', state);
        later(() => el.removeAttribute('data-transition'), state === 'working' ? BOT_MOTION.hopMs : state === 'question' ? 650 : BOT_MOTION.transitionMs);
      }
      if (newRequest && !acknowledged) later(() => {
        started = true;
        el.setAttribute('data-gesture', 'ask');
        later(() => { if (el.getAttribute('data-gesture') === 'ask') el.removeAttribute('data-gesture'); }, BOT_MOTION.askMs);
      }, BOT_MOTION.askDelayMs);
    }
    const interactive = () => enabled && !STILL.has(state) && active(el);
    const move = (event: PointerEvent) => {
      if (!interactive() || event.pointerType === 'touch') return;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return;
      el.setAttribute('data-hover', 'true');
      el.removeAttribute('data-idle');
      const clamp = (n: number) => Math.max(-2, Math.min(2, n));
      setGaze(el, clamp((event.clientX - box.left - box.width / 2) / box.width * 4), clamp((event.clientY - box.top - box.height / 2) / box.height * 4));
    };
    const leave = () => { el.removeAttribute('data-hover'); setGaze(el, 0, 0); };
    let touchEnd: ReturnType<typeof setTimeout> | undefined;
    const click = () => {
      if (!interactive()) return;
      if (touchEnd !== undefined) { clearTimeout(touchEnd); timers.delete(touchEnd); }
      el.removeAttribute('data-touch');
      // Flush the previous one-shot before restarting it; never prevent the parent's click.
      void el.getBoundingClientRect();
      el.setAttribute('data-touch', 'true');
      touchEnd = later(() => el.removeAttribute('data-touch'), BOT_MOTION.touchMs);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', click);
    const unwatch = watchActivity(el, () => { if (!active(el)) { interrupted = true; stop(); } });
    return () => {
      stop(); unwatch();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', click);
      // StrictMode's effect replay must not swallow the pending request.
      const blocked = ['data-paused', 'data-frozen', 'data-reduced', 'data-readonly'].some(a => el.getAttribute(a) === 'true');
      if (!started && newRequest && !acknowledged && el.getAttribute('data-state') === state && enabled && !interrupted && active(el) && !blocked) {
        prevAsk.current = prevKey;
      }
    };
  }, [ref, state, enabled, askKey, nodKey, h]);
}

/** One 650 ms nod each time `nodKey` changes: it confirms that a decision was received, never that the task succeeded. */
export function useBotNod(ref: RefObject<SVGSVGElement | null>, nodKey: number | undefined, enabled: boolean, state: BotState, askKey?: string): void {
  const prev = useRef(nodKey);
  useEffect(() => {
    const el = ref.current;
    const changed = prev.current !== nodKey;
    prev.current = nodKey;
    if (!el || !changed || nodKey === undefined || !enabled || !active(el) || STILL.has(state)) return;
    el.setAttribute('data-gesture', 'nod');
    const end = setTimeout(() => { if (el.getAttribute('data-gesture') === 'nod') el.removeAttribute('data-gesture'); }, BOT_MOTION.nodMs);
    const stop = () => {
      clearTimeout(end);
      if (el.getAttribute('data-gesture') === 'nod') el.removeAttribute('data-gesture');
    };
    const unwatch = watchActivity(el, () => { if (!active(el)) stop(); });
    return () => {
      unwatch(); stop();
    };
  }, [ref, nodKey, enabled, state, askKey]);
}
