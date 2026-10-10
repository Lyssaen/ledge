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
