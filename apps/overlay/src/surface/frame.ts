import type { Frame } from '../tauri/bridge';

/** Something drawn at a page position (logical px; the page's axes are the work area's). */
export interface Box { left: number; top: number; w: number; h: number }
/** Room around the drawn boxes for the overlay shadow (it falls sideways and mostly downward; nothing is above the top edge). */
export const FRAME_PAD = { left: 16, right: 16, bottom: 24 } as const;

/** The native window: the bounding box of the surface and every visible extra (fillets, status line, unread say,
 *  coachmark), padded for the shadow and clamped to the work area. Integer px for the shell. */
export function frameOf(surface: Box, extras: Box[], screen: { w: number; h: number }): Frame {
  const boxes: Box[] = [surface, ...extras];
  const left = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.left)) - FRAME_PAD.left));
  const right = Math.min(screen.w, Math.ceil(Math.max(...boxes.map(b => b.left + b.w)) + FRAME_PAD.right));
  const top = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.top))));
  const bottom = Math.min(screen.h, Math.ceil(Math.max(...boxes.map(b => b.top + b.h)) + FRAME_PAD.bottom));
  return { left, top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** The smallest frame holding both: the window while the surface animates from one to the other. */
export function unionFrame(a: Frame, b: Frame): Frame {
  const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
  return { left, top, w: Math.max(a.left + a.w, b.left + b.w) - left, h: Math.max(a.top + a.h, b.top + b.h) - top };
}

export const containsFrame = (outer: Frame, inner: Frame) =>
  outer.left <= inner.left && outer.top <= inner.top && outer.left + outer.w >= inner.left + inner.w && outer.top + outer.h >= inner.top + inner.h;
