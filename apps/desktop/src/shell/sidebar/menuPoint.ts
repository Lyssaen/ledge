import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

/** Where a menu opens: at the pointer for a click; under the row for the keyboard (the menu key reports no point, or 0, 0). */
export function menuPoint(e: ReactMouseEvent | ReactKeyboardEvent | MouseEvent | KeyboardEvent, el: HTMLElement): { x: number; y: number } {
  if ('clientX' in e && (e.clientX !== 0 || e.clientY !== 0)) return { x: e.clientX, y: e.clientY };
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 4 };
}

/** The menu key or Shift+F10: the keyboard's right click. */
export const isMenuKey = (e: ReactKeyboardEvent | KeyboardEvent): boolean => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
