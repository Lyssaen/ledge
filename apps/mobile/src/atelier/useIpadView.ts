// The Atelier as a canvas on iPad (docs/mockups/ledge-ipad-atelier.html, view 1 a and view 4): it opens readable (ipadFit), one
// finger scrolls it, two pinch the zoom around their midpoint, a double tap frames a room (or comes back to the fit), « Ajuster »
// comes back to the readable view. The zoom and the scroll are kept for this page's life: back from « Plein écran », the
// Atelier is where it was left.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { clampZoom, frameZoom, stepZoom, zoomAround } from '@ledge/ui/atelier/zoom';
import { IPAD_PAD, ipadFit, orientOf } from './fit';

export interface IpadView {
  scrollRef: RefObject<HTMLDivElement | null>;
  shellRef: RefObject<HTMLDivElement | null>;
  /** The zoom shown: the manual one, else the fit's. */
  zoom: number;
  fitted: boolean;
  zoomTo(z: number): void;
  step(dir: 1 | -1): void;
  fit(): void;
}

/** A finger on these taps them: it still pans once it has moved past a tap. */
const TAP_SLOP = 8;
/** Two taps this close in time and place are a double tap. */
const DOUBLE_MS = 320, DOUBLE_PX = 30;
/** A double tap on these is a tap on them, never a frame. */
const NO_FRAME = 'button,a,[role=button],.unassigned-card';
/** The tiles the fit measures. */
const TILES = '.atelier-room,.unassigned-zone';

/** Kept for the page's life (module state): the zoom chosen by hand (null: the fit) and where the floor was scrolled. */
let kept: { zoom: number | null; left: number; top: number } = { zoom: null, left: 0, top: 0 };
/** Forgets the kept view (tests). */
export function resetIpadView(): void { kept = { zoom: null, left: 0, top: 0 }; }

/** `refit`: what, when it changes, measures the rooms again (the sessions, the rooms). */
export function useIpadView(refit: readonly unknown[]): IpadView {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [manual, setManual] = useState<number | null>(kept.zoom);
  const applied = useRef(kept.zoom ?? 1);
  const manualRef = useRef<number | null>(kept.zoom);
  const size = useRef({ w: -1, h: -1 });

  const compute = useCallback(() => {
    const scroll = scrollRef.current, shell = shellRef.current;
    if (!scroll || !shell) return;
    const s = shell.style;
    s.zoom = '1';
    const view = { width: scroll.clientWidth, height: scroll.clientHeight };
    size.current = { w: scroll.offsetWidth, h: scroll.offsetHeight };
    const orient = orientOf(view);
    // Measured in one column first, so a room's own width and height are read whatever the flow.
    s.padding = `${IPAD_PAD.top}px ${IPAD_PAD.side}px ${IPAD_PAD.bottom}px`;
    s.flexWrap = 'wrap'; s.width = 'max-content'; s.maxWidth = 'none'; s.minHeight = ''; s.alignContent = 'flex-start'; s.gap = '0 8px';
    const rooms = [...shell.querySelectorAll<HTMLElement>(TILES)].map(r => ({ w: r.offsetWidth, h: r.offsetHeight })).filter(r => r.w > 0);
    const { zoom, along } = ipadFit(rooms, view, orient);
    if (along === 'row') { s.flexWrap = 'nowrap'; s.width = 'max-content'; s.justifyContent = 'flex-start'; }
    else {
      const w = Math.max(0, ...rooms.map(r => r.w)) + 2 * IPAD_PAD.side;
      s.flexWrap = 'wrap'; s.width = `${w}px`; s.maxWidth = `${w}px`; s.justifyContent = 'center';
    }
    // Without rooms (no session), the floor fills the view: Ledge alone in its corner.
    if (rooms.length === 0) { s.width = `${view.width}px`; s.minHeight = `${view.height}px`; }
    setFitZoom(zoom);
    applied.current = manualRef.current ?? zoom;
    s.zoom = String(applied.current);
  }, []);

  useLayoutEffect(() => {
    compute();
    const scroll = scrollRef.current;
    if (scroll) { scroll.scrollLeft = kept.left; scroll.scrollTop = kept.top; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compute, ...refit]);

  // A new size (the iPad turned, Split View, a notice above): measured again.
  const latest = useRef(compute);
  latest.current = compute;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (scroll.offsetWidth !== size.current.w || scroll.offsetHeight !== size.current.h) latest.current();
    });
    observer.observe(scroll);
    // Fonts arriving change the rooms' sizes.
    void globalThis.document?.fonts?.ready.then(() => latest.current());
    return () => observer.disconnect();
  }, []);

  const setZoom = (z: number, left: number, top: number) => {
    const scroll = scrollRef.current, shell = shellRef.current;
    applied.current = z; manualRef.current = z; setManual(z); kept.zoom = z;
    if (!scroll || !shell) return;
    shell.style.zoom = String(z);
    scroll.scrollLeft = left; scroll.scrollTop = top;
  };
  const zoomTo = (target: number) => {
    const scroll = scrollRef.current;
    const z = clampZoom(target);
    if (!scroll) { setZoom(z, 0, 0); return; }
    const { left, top } = zoomAround({ zoom: applied.current, left: scroll.scrollLeft, top: scroll.scrollTop }, z, { x: scroll.clientWidth / 2, y: scroll.clientHeight / 2 });
    setZoom(z, left, top);
  };
  const step = (dir: 1 | -1) => zoomTo(stepZoom(applied.current, dir));
  const fit = () => {
    manualRef.current = null; setManual(null); kept.zoom = null;
    compute();
    const scroll = scrollRef.current;
    if (scroll) { scroll.scrollLeft = 0; scroll.scrollTop = 0; }
  };
  const frame = (el: HTMLElement) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const old = applied.current, r = scroll.getBoundingClientRect(), e = el.getBoundingClientRect();
    const box = { x: (scroll.scrollLeft + e.left - r.left) / old, y: (scroll.scrollTop + e.top - r.top) / old, w: e.width / old, h: e.height / old };
    if (box.w <= 0 || box.h <= 0) return;
    const { zoom, left, top } = frameZoom(box, { width: scroll.clientWidth, height: scroll.clientHeight });
    setZoom(zoom, left, top);
  };

  const actions = useRef({ setZoom, fit, frame });
  actions.current = { setZoom, fit, frame };
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    // The scroller's `touch-action: none` (atelier.css) keeps Safari from zooming the page: the fingers are followed here.
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; zoom: number; x: number; y: number } | null = null;
    let swipe: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    let lastTap: { at: number; x: number; y: number } | null = null;
    // The finger that lifted had swiped: the click it ends with is no tap.
    let swiped = false;
    const span = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) });
    const regrip = () => {
      const [a, b] = [...fingers.values()];
      pinch = null; swipe = null;
      if (a && b) {
        const m = span(a, b), r = scroll.getBoundingClientRect(), z = applied.current;
        pinch = { d: Math.max(m.d, 1), zoom: z, x: (scroll.scrollLeft + m.x - r.left) / z, y: (scroll.scrollTop + m.y - r.top) / z };
      } else if (a) swipe = { x: a.x, y: a.y, left: scroll.scrollLeft, top: scroll.scrollTop, moved: false };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      if (fingers.size === 0) swiped = false;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      regrip();
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...fingers.values()];
      if (pinch && a && b) {
        const m = span(a, b), r = scroll.getBoundingClientRect(), z = clampZoom(pinch.zoom * m.d / pinch.d);
        actions.current.setZoom(z, pinch.x * z - (m.x - r.left), pinch.y * z - (m.y - r.top));
      } else if (swipe) {
        const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
        if (!swipe.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
        swipe.moved = true;
        scroll.scrollLeft = swipe.left - dx;
        scroll.scrollTop = swipe.top - dy;
      }
    };
    const up = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      if (swipe?.moved || pinch) swiped = true;
      const tap = fingers.size === 1 && swipe !== null && !swipe.moved;
      fingers.delete(e.pointerId);
      regrip();
      if (!tap || e.type === 'pointercancel') return;
      const t = e.target instanceof Element ? e.target : null;
      const now = e.timeStamp;
      if (lastTap && now - lastTap.at < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_PX && !t?.closest(NO_FRAME)) {
        lastTap = null;
        const room = t?.closest<HTMLElement>('.atelier-room');
        if (room) actions.current.frame(room); else actions.current.fit();
        return;
      }
      lastTap = { at: now, x: e.clientX, y: e.clientY };
    };
    // A swipe or a pinch is no tap: the click it would end with is dropped.
    const click = (e: MouseEvent) => { if (swiped) { swiped = false; e.preventDefault(); e.stopPropagation(); } };
    const remember = () => { kept.left = scroll.scrollLeft; kept.top = scroll.scrollTop; };
    scroll.addEventListener('pointerdown', down);
    scroll.addEventListener('pointermove', move);
    scroll.addEventListener('pointerup', up);
    scroll.addEventListener('pointercancel', up);
    scroll.addEventListener('click', click, true);
    scroll.addEventListener('scroll', remember, { passive: true });
    return () => {
      scroll.removeEventListener('pointerdown', down);
      scroll.removeEventListener('pointermove', move);
      scroll.removeEventListener('pointerup', up);
      scroll.removeEventListener('pointercancel', up);
      scroll.removeEventListener('click', click, true);
      scroll.removeEventListener('scroll', remember);
    };
  }, []);

  return { scrollRef, shellRef, zoom: manual ?? fitZoom, fitted: manual === null, zoomTo, step, fit };
}
