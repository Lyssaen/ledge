import type { CSSProperties } from 'react';

/** The radius of the concave fillets joining the surface to the screen edge (the surface's own --radius-xl). */
export const SHOULDER_R = 14;
/** The fillet radius for a surface of width `w`: never wider than half of it (the bare 6 px strip gets small ones). */
/** How far each fillet reaches into the surface, in the notch colour. */
const OVERLAP = 1;
export const shoulderR =(w: number) => Math.min(SHOULDER_R, Math.floor(w / 2));

/** The two concave fillets above and below the surface, where it leaves the screen edge: the notch flows out of the
 *  edge instead of starting at a right angle. Filled with the notch colour and borderless like the surface, they
 *  follow its top and height with the same transition. */
export function Shoulders({ top, h, w, transition, opacity }: { top: number; h: number; w: number; transition: string; opacity: number }) {
  const r = shoulderR(w);
  if (r <= 0) return null;
  // From the screen edge (tangent to it) to the surface's top edge (tangent to it), then down OVERLAP px into the
  // surface and back along the corner. Meeting the surface on a shared edge would leave a seam at a fractional display
  // scale (150 %): both edges land mid-pixel, each covers half the row and the desktop shows through.
  const fill = `M0,0 A${r},${r} 0 0 0 ${r},${r} L${r},${r + OVERLAP} L0,${r + OVERLAP} Z`;
  const box: CSSProperties = { position: 'absolute', left: 0, width: r, height: r + OVERLAP, pointerEvents: 'none', opacity };
  const svg = (flip: boolean) => (
    <svg width={r} height={r + OVERLAP} viewBox={`0 0 ${r} ${r + OVERLAP}`} style={{ display: 'block', transform: flip ? 'scaleY(-1)' : undefined }}>
      <path d={fill} fill="var(--notch)" />
    </svg>
  );
  return (
    <>
      <div data-shoulder="top" aria-hidden style={{ ...box, top: top - r, transition }}>{svg(false)}</div>
      <div data-shoulder="bottom" aria-hidden style={{ ...box, top: top + h - OVERLAP, transition }}>{svg(true)}</div>
    </>
  );
}
