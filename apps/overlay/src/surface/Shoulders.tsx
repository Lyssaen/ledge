import type { CSSProperties } from 'react';
import { SURFACE_BORDER } from './geometry';

/** The radius of the concave fillets joining the surface to the screen edge (the surface's own --radius-xl). */
export const SHOULDER_R = 14;
/** The fillet radius for a surface of width `w`: never wider than half of it (the bare 6 px strip gets small ones). */
export const shoulderR = (w: number) => Math.min(SHOULDER_R, Math.floor(w / 2));

/** The two concave fillets above and below the surface, where it leaves the screen edge: the notch flows out of the
 *  edge instead of starting at a right angle. Each is drawn on top of the surface's own top/bottom border row, which
 *  it covers up to the end of the curve, and follows the surface's top and height with the same transition. */
export function Shoulders({ top, h, w, transition, opacity }: { top: number; h: number; w: number; transition: string; opacity: number }) {
  const r = shoulderR(w);
  if (r <= 0) return null;
  const b = SURFACE_BORDER;
  // The arc runs from the screen edge (tangent to it) to the surface's top border (tangent to it), centered half a
  // border inside so the stroke lines up with the border row; the fill covers the corner and that border row.
  const fill = `M0,${b / 2} A${r},${r} 0 0 0 ${r},${r + b / 2} L${r},${r + b} L0,${r + b} Z`;
  const arc = `M0,${b / 2} A${r},${r} 0 0 0 ${r},${r + b / 2}`;
  const box: CSSProperties = { position: 'absolute', left: 0, width: r, height: r + b, pointerEvents: 'none', overflow: 'visible', opacity };
  const svg = (flip: boolean) => (
    <svg width={r} height={r + b} viewBox={`0 0 ${r} ${r + b}`} style={{ display: 'block', overflow: 'visible', transform: flip ? 'scaleY(-1)' : undefined }}>
      <path d={fill} fill="var(--sidebar)" />
      <path d={arc} fill="none" stroke="var(--sidebar-border)" strokeWidth={b} />
    </svg>
  );
  return (
    <>
      <div data-shoulder="top" aria-hidden style={{ ...box, top: top - r, transition }}>{svg(false)}</div>
      <div data-shoulder="bottom" aria-hidden style={{ ...box, top: top + h - b, transition }}>{svg(true)}</div>
    </>
  );
}
