import type { Frame } from '../tauri/bridge';

/** Something drawn at a page position (logical px; the page's y axis is the work area's). */
export interface Box { left: number; top: number; w: number; h: number }
/** Room around the drawn boxes for the overlay shadow (it falls mostly downward). */
export const FRAME_PAD = { top: 8, right: 16, bottom: 24 } as const;

/** The native window: the bounding box of the surface and every visible extra (status line, unread say, coachmark),
 *  from the left screen edge, padded for the shadow and clamped to the work area. Integer px for the shell. */
export function frameOf(surface: { top: number; w: number; h: number }, extras: Box[], screenH: number): Frame {
  const boxes: Box[] = [{ left: 0, top: surface.top, w: surface.w, h: surface.h }, ...extras];
  const top = Math.max(0, Math.floor(Math.min(...boxes.map(b => b.top)) - FRAME_PAD.top));
  const bottom = Math.min(screenH, Math.ceil(Math.max(...boxes.map(b => b.top + b.h)) + FRAME_PAD.bottom));
  const right = Math.ceil(Math.max(...boxes.map(b => b.left + b.w)) + FRAME_PAD.right);
  return { top, w: right, h: Math.max(1, bottom - top) };
}

/** The smallest frame holding both: the window while the surface animates from one to the other. */
export function unionFrame(a: Frame, b: Frame): Frame {
  const top = Math.min(a.top, b.top);
  return { top, w: Math.max(a.w, b.w), h: Math.max(a.top + a.h, b.top + b.h) - top };
}

export const containsFrame = (outer: Frame, inner: Frame) =>
  outer.top <= inner.top && outer.w >= inner.w && outer.top + outer.h >= inner.top + inner.h;
