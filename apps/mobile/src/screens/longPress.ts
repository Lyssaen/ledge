import { useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a finger rests on a seat or a row before its actions open (m2-sessions.html §8). */
export const LONG_PRESS_MS = 500;
const SLOP = 10;

/**
 * A long press (§8): after LONG_PRESS_MS without moving, a light haptic tap and `onLong`; the click that follows the finger's
 * lift is then swallowed, so the seat does not also open its thread. A browser's own context menu (a right click, Android's long
 * press) opens the same actions.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const fire = () => {
    clear();
    fired.current = true;
    try { navigator.vibrate?.(10); } catch { /* no haptics here */ }
    onLong();
  };
  return {
    onPointerDown: (e: PointerEvent) => {
      // The main button or a finger only; a right click goes through `contextmenu`.
      if (e.button > 0) return;
      fired.current = false;
      from.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(fire, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const f = from.current;
      if (f && Math.hypot(e.clientX - f.x, e.clientY - f.y) > SLOP) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); if (!fired.current) fire(); },
    onClickCapture: (e: MouseEvent) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }
  };
}
