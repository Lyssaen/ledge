import type { CSSProperties } from 'react';

/** The radius of the concave fillets joining the island to the top screen edge (spec 2026-10-12 §3). */
export const SHOULDER_R = 12;
/** The discreet strip's smaller fillets. */
export const STRIP_SHOULDER_R = 6;
/** How far each fillet reaches into the surface, in the notch colour. */
const OVERLAP = 1;
/** The fillet radius for a surface of width `w`: never wider than half of it. */
export const shoulderR = (w: number, strip = false) => Math.min(strip ? STRIP_SHOULDER_R : SHOULDER_R, Math.floor(w / 2));

/** The two concave fillets either side of the island where it leaves the top screen edge: the notch flows out of the
 *  edge instead of starting at a right angle. Filled with the notch colour and borderless like the surface, they follow
 *  its left and width with the same transition. */
export function Shoulders({ left, w, strip = false, transition, opacity }: { left: number; w: number; strip?: boolean; transition: string; opacity: number }) {
  const r = shoulderR(w, strip);
  if (r <= 0) return null;
  // Along the screen edge (tangent to it) OVERLAP px into the island, down the island's edge (tangent to it) to the
  // fillet's foot, then back to the corner along the arc. Meeting the island on a shared edge would leave a seam at a
  // fractional display scale (150 %): both edges land mid-pixel, each covers half the column and the desktop shows through.
  const fill = `M0,0 H${r + OVERLAP} V${r} H${r} A${r},${r} 0 0 0 0,0 Z`;
  const box: CSSProperties = { position: 'absolute', top: 0, width: r + OVERLAP, height: r, pointerEvents: 'none', opacity };
  const svg = (flip: boolean) => (
    <svg width={r + OVERLAP} height={r} viewBox={`0 0 ${r + OVERLAP} ${r}`} style={{ display: 'block', transform: flip ? 'scaleX(-1)' : undefined }}>
      <path d={fill} fill="var(--notch)" />
    </svg>
  );
  return (
    <>
      <div data-shoulder="left" aria-hidden style={{ ...box, left: left - r, transition }}>{svg(false)}</div>
      <div data-shoulder="right" aria-hidden style={{ ...box, left: left + w - OVERLAP, transition }}>{svg(true)}</div>
    </>
  );
}
