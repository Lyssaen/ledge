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
 *  its left and width with the same transition. Each box keeps the largest fillet's size, the fillet drawn against the
 *  island: when the radius changes (the filet waking or resting) the fillet stays joined to the island while the box
 *  slides with it, and its curve eases to the new radius over `pathTransition`. */
export function Shoulders({ left, w, strip = false, transition, pathTransition, opacity }: { left: number; w: number; strip?: boolean; transition: string; pathTransition?: string; opacity: number }) {
  const r = shoulderR(w, strip);
  if (r <= 0) return null;
  // Along the screen edge (tangent to it) OVERLAP px into the island, down the island's edge (tangent to it) to the
  // fillet's foot, then back to the corner along the arc. Meeting the island on a shared edge would leave a seam at a
  // fractional display scale (150 %): both edges land mid-pixel, each covers half the column and the desktop shows through.
  const R = SHOULDER_R, x = R - r;
  const fill = `M${x},0 H${R + OVERLAP} V${r} H${R} A${r},${r} 0 0 0 ${x},0 Z`;
  const box: CSSProperties = { position: 'absolute', top: 0, width: R + OVERLAP, height: R, pointerEvents: 'none', opacity };
  const svg = (flip: boolean) => (
    <svg width={R + OVERLAP} height={R} viewBox={`0 0 ${R + OVERLAP} ${R}`} style={{ display: 'block', transform: flip ? 'scaleX(-1)' : undefined }}>
      <path d={fill} fill="var(--notch)" style={{ d: `path("${fill}")`, transition: pathTransition } as CSSProperties} />
    </svg>
  );
  return (
    <>
      <div data-shoulder="left" aria-hidden style={{ ...box, left: left - R, transition }}>{svg(false)}</div>
      <div data-shoulder="right" aria-hidden style={{ ...box, left: left + w - OVERLAP, transition }}>{svg(true)}</div>
    </>
  );
}
