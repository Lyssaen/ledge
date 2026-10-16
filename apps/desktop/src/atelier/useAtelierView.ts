import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ScreenKeyHandler } from '../nav/screenKeys';
import { clampZoom, fitCeiling, FIT_MIN, FIT_STEP, FLOOR_MARGIN, frameZoom, stepZoom, wheelZoom, widestRow, zoomAround } from './zoom';

export interface AtelierView {
  scrollRef: RefObject<HTMLDivElement | null>;
  shellRef: RefObject<HTMLDivElement | null>;
  /** Shown: the manual zoom, else the fit's. */
  zoom: number;
  /** No manual zoom. */
  fitted: boolean;
  /** Bounded; `at` (client coordinates) stays still, the centre by default. */
  zoomTo(z: number, at?: { x: number; y: number }): void;
  step(dir: 1 | -1): void;
  fit(): void;
  frame(el: HTMLElement): void;
  /** + (and =), −, 0, Space. */
  keys: ScreenKeyHandler;
}

/** Pressing on these never pans (the mockup's `interactive`), unless Space is held or it is the middle button. */
const INTERACTIVE = 'button,a,input,textarea,select,label,[draggable="true"],.agent-seat,.unassigned-card,.room-heading,.ledge-desk,.zoom-controls';
/** A double-click on these neither frames nor refits. */
const NO_FRAME = 'button,a,input,textarea,.unassigned-card,.agent-seat';
/** Space on these keeps its own activation. */
const OWN_SPACE = 'button,a,input,textarea,select,[role=button],[role=checkbox],[role=menuitem],[role=tab],[contenteditable=true]';

/** The atelier as a canvas (observatory.tsx, the first `useLayoutEffect`, `zoomAt`, `fitView`, `zoomTo`, `zoomStep` and the
 *  wheel / pan / double-click effect): the mosaic is fitted to the scroller, then the viewer may zoom and pan it.
 *  `tiles`: the tiles' widths in render order; `refit`: what, when it changes, redoes the fit. */
export function useAtelierView(tiles: readonly number[], refit: readonly unknown[]): AtelierView {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [manual, setManual] = useState<number | null>(null);
  // The applied zoom and the manual one live in refs: jsdom keeps no `style.zoom`, so it is never read back.
  const applied = useRef(1);
  const manualRef = useRef<number | null>(null);
  // The scroller's border box at the last fit: a resize that keeps it (scroll bars coming and going) does not refit.
  const fittedAt = useRef({ w: -1, h: -1 });
  const space = useRef(false);

  const tilesKey = tiles.join(',');
  const compute = useCallback(() => {
    const scroll = scrollRef.current, shell = shellRef.current;
    if (!scroll || !shell) return;
    const widths = tilesKey === '' ? [] : tilesKey.split(',').map(Number);
    const s = shell.style;
    s.width = s.paddingInline = s.minHeight = s.maxWidth = s.marginInline = '';
    s.zoom = '1';
    // Measured as fitted (no scroll bars), whatever the manual zoom.
    scroll.classList.add('fitted');
    fittedAt.current = { w: scroll.offsetWidth, h: scroll.offsetHeight };
    let z = 1;
    // A scroller without a width (not laid out, or jsdom) cannot be measured: the fit is 1.
    if (scroll.clientWidth > 0 && widths.length > 0) {
      const fits = () => scroll.scrollHeight <= scroll.clientHeight + 1 && scroll.scrollWidth <= scroll.clientWidth + 1;
      // Try every number of rows, force it through the shell's width, and keep the arrangement that zooms the most.
      let best: { z: number; w: number } | null = null;
      for (let k = 1; k <= widths.length; k++) {
        const widest = widestRow(widths, k);
        const w = Math.ceil(widest + 2 * FLOOR_MARGIN);
        s.maxWidth = `${w}px`; s.marginInline = 'auto';
        let zk = fitCeiling(scroll.clientWidth, widest);
        for (; zk > FIT_MIN; zk -= FIT_STEP) { s.zoom = String(zk); if (fits()) break; }
        zk = Math.max(FIT_MIN, zk);
        if (best === null || zk > best.z) best = { z: zk, w };
      }
      z = best!.z;
      s.maxWidth = `${best!.w}px`; s.zoom = String(z);
      // Then fill both axes: the floor spans the whole width (padding instead of a max width) and the leftover height.
      s.maxWidth = '';
      s.paddingInline = `${Math.max(FLOOR_MARGIN, (shell.offsetWidth - best!.w) / 2 + FLOOR_MARGIN)}px`;
      if (!fits()) { s.paddingInline = ''; s.maxWidth = `${best!.w}px`; }
      const extra = scroll.scrollHeight - shell.getBoundingClientRect().height;
      s.minHeight = `${Math.max(0, (scroll.clientHeight - extra - 4) / z)}px`;
      if (!fits()) s.minHeight = '';
      // Freeze the fitted layout's width so a manual zoom scales it (and overflows, to pan) instead of reflowing the rows.
      s.width = `${shell.offsetWidth}px`;
    }
    setFitZoom(z);
    applied.current = manualRef.current ?? z;
    s.zoom = String(applied.current);
    scroll.classList.toggle('fitted', manualRef.current === null);
  }, [tilesKey]);

  // `refit` is the caller's list of what redoes the fit (a list of the same length on every render).
  useLayoutEffect(compute, [compute, ...refit]);

  // A new size of the scroller (the window, the chat, full screen) redoes the fit.
  const latest = useRef(compute);
  latest.current = compute;
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const { w, h } = fittedAt.current;
      if (scroll.offsetWidth !== w || scroll.offsetHeight !== h) latest.current();
    });
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  const setZoom = (z: number, left: number, top: number) => {
    const scroll = scrollRef.current, shell = shellRef.current;
    applied.current = z; manualRef.current = z; setManual(z);
    if (!scroll || !shell) return;
    shell.style.zoom = String(z);
    scroll.classList.remove('fitted');
    scroll.scrollLeft = left; scroll.scrollTop = top;
  };
  const zoomTo = (target: number, at?: { x: number; y: number }) => {
    const scroll = scrollRef.current;
    const z = clampZoom(target);
    if (!scroll) { setZoom(z, 0, 0); return; }
    const r = scroll.getBoundingClientRect();
    const point = at ? { x: at.x - r.left, y: at.y - r.top } : { x: scroll.clientWidth / 2, y: scroll.clientHeight / 2 };
    const { left, top } = zoomAround({ zoom: applied.current, left: scroll.scrollLeft, top: scroll.scrollTop }, z, point);
    setZoom(z, left, top);
  };
  const step = (dir: 1 | -1) => zoomTo(stepZoom(applied.current, dir));
  const fit = () => {
    manualRef.current = null; setManual(null);
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

  const arm = (on: boolean) => { space.current = on; scrollRef.current?.classList.toggle('can-pan', on); };
  const keys: ScreenKeyHandler = e => {
    if (e.key === ' ') {
      if (e.target instanceof Element && e.target.closest(OWN_SPACE)) return false;
      if (!e.repeat) arm(true);
      return true;
    }
    if (e.key === '+' || e.key === '=') { step(1); return true; }
    if (e.key === '-') { step(-1); return true; }
    if (e.key === '0') { fit(); return true; }
    return false;
  };

  // The listeners call the latest render's actions.
  const actions = useRef({ zoomTo, fit, frame, arm });
  actions.current = { zoomTo, fit, frame, arm };
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      actions.current.zoomTo(wheelZoom(applied.current, e.deltaY), { x: e.clientX, y: e.clientY });
    };
    let pan: { x: number; y: number; left: number; top: number; id: number } | null = null;
    const down = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!(e.button === 1 || space.current || (e.button === 0 && !t?.closest(INTERACTIVE)))) return;
      if (scroll.scrollWidth <= scroll.clientWidth && scroll.scrollHeight <= scroll.clientHeight) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, id: e.pointerId };
      scroll.setPointerCapture?.(e.pointerId);
      scroll.classList.add('panning');
    };
    const move = (e: PointerEvent) => {
      if (!pan) return;
      scroll.scrollLeft = pan.left - (e.clientX - pan.x);
      scroll.scrollTop = pan.top - (e.clientY - pan.y);
    };
    const up = () => {
      if (!pan) return;
      if (scroll.hasPointerCapture?.(pan.id)) scroll.releasePointerCapture(pan.id);
      pan = null;
      scroll.classList.remove('panning');
    };
    const dbl = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(NO_FRAME)) return;
      // A double-click also selects the word under it: the view changes instead.
      window.getSelection()?.removeAllRanges();
      const room = t.closest<HTMLElement>('.project-room');
      if (room) actions.current.frame(room); else actions.current.fit();
    };
    const keyup = (e: KeyboardEvent) => { if (e.key === ' ') actions.current.arm(false); };
    const blur = () => actions.current.arm(false);
    scroll.addEventListener('wheel', wheel, { passive: false });
    scroll.addEventListener('pointerdown', down);
    scroll.addEventListener('pointermove', move);
    scroll.addEventListener('pointerup', up);
    scroll.addEventListener('pointercancel', up);
    scroll.addEventListener('dblclick', dbl);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      scroll.removeEventListener('wheel', wheel);
      scroll.removeEventListener('pointerdown', down);
      scroll.removeEventListener('pointermove', move);
      scroll.removeEventListener('pointerup', up);
      scroll.removeEventListener('pointercancel', up);
      scroll.removeEventListener('dblclick', dbl);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // The scroller's dynamic classes belong to this hook (React never rewrites its static className): `fitted` = no scrolling.
  const fitted = manual === null;
  useLayoutEffect(() => { scrollRef.current?.classList.toggle('fitted', fitted); }, [fitted]);

  return { scrollRef, shellRef, zoom: manual ?? fitZoom, fitted, zoomTo, step, fit, frame, keys };
}
