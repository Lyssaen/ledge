export const MOTION = {
  grow: { ms: 320, ease: 'cubic-bezier(.22,1,.36,1)', delayMs: 0 },
  shrink: { ms: 260, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 60 },
  cardExit: { ms: 300, ease: 'cubic-bezier(.65,0,.35,1)', delayMs: 180 },
  pop: { ms: 260, ease: 'cubic-bezier(.34,1.3,.64,1)', delayMs: 0 },
  fadeIn: { ms: 180, ease: 'ease-out', delayMs: 140 },
  fadeOut: { ms: 100, ease: 'ease-in', delayMs: 0 },
  hover: { ms: 150, ease: 'ease-out', delayMs: 0 }
} as const;
export type MotionKind = keyof typeof MOTION;

/** When a view's content fades in, in ms from the surface's change of shape. Entries follow the shape once it has
 *  nearly settled: 120 ms into a grow (fast start, long deceleration), but a shrink waits 60 ms and starts slowly, so
 *  its content comes in at 280 ms, 40 ms before the shrink ends. Earlier, the list's rows and footer would be drawn at
 *  the session's size and jump into place as the surface shrinks. */
export const ENTER_DELAY = { grow: 120, shrink: MOTION.shrink.delayMs + MOTION.shrink.ms - 40 } as const;
export const enterDelay = (growing: boolean): number => growing ? ENTER_DELAY.grow : ENTER_DELAY.shrink;

const scale = (): number => {
  const v = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_LEDGE_MOTION;
  return v === undefined ? 1 : Number(v);
};
export const ms = (n: number): string => `${Math.round(n * scale())}ms`;

export function transition(parts: Array<[string, MotionKind, number?]>): string {
  return parts.map(([prop, kind, delay]) => {
    const m = MOTION[kind];
    return `${prop} ${ms(m.ms)} ${m.ease} ${ms(delay ?? m.delayMs)}`;
  }).join(', ');
}
