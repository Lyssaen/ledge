import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useUiCopy } from '../i18n/copy';

export type ResidentGesture = 'blink' | 'curious' | 'hello' | 'boop' | 'happy' | 'look' | 'stretch' | 'tap' | 'pulse' | 'nod' | 'yawn' | 'sleep';

export interface ResidentMascotProps {
  size: number;
  theme: 'dark' | 'light';
  paused?: boolean;
  frozen?: boolean;
  reducedMotion?: boolean;
  dnd?: boolean;
  pointer?: { x: number; y: number } | null;
  /** The resident's center in screen coordinates, used by the native cursor poller and browser pointer alike. */
  center?: { x: number; y: number };
  gestureKey?: number;
  gestureKind?: ResidentGesture;
  boopKey?: number;
}

const GESTURE_MS: Record<ResidentGesture, number> = { blink: 180, curious: 900, hello: 1100, boop: 700, happy: 900, look: 1800, stretch: 1600, tap: 1150, pulse: 1400, nod: 700, yawn: 1700, sleep: 3200 };
const clamp = (n: number, range: number) => Math.max(-range, Math.min(range, n));

const HEAD = 'M25 60V41C25 28 35 23 48 23C61 23 71 28 71 41V60Z';

/** The watcher: a head peeking over its own rebord, keeping an eye on every agent. Gaze, pose, antenna and hands are separate layers. It belongs to Ledge, not an agent tool. */
export function ResidentMascot({ size, theme, paused = false, frozen = false, reducedMotion = false, dnd = false, pointer = null, center, gestureKey, gestureKind = 'hello', boopKey }: ResidentMascotProps) {
  const t = useUiCopy();
  const id = `resident-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [gesture, setGesture] = useState<ResidentGesture | null>(null);
  const [hovered, setHovered] = useState(false);
  const clearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quiet = paused || reducedMotion || dnd || frozen;
  const near = !quiet && !!pointer && !!center && Math.hypot(pointer.x - center.x, pointer.y - center.y) < 140;
  const gx = near ? clamp((pointer!.x - center!.x) / 140 * 5, 4) : 0;
  const gy = near ? clamp((pointer!.y - center!.y) / 140 * 3, 2) : 0;
  const tilt = near ? clamp((pointer!.x - center!.x) / 140 * 7, 5) : 0;

  const play = (next: ResidentGesture) => {
    if (quiet || document.hidden) return;
    clearTimeout(clearRef.current);
    setGesture(null);
    setGesture(next);
    clearRef.current = setTimeout(() => setGesture(null), GESTURE_MS[next]);
  };

  useEffect(() => () => clearTimeout(clearRef.current), []);

  useEffect(() => {
    if (!gestureKey) return;
    play(gestureKind);
    // gestureKey only changes on activation; prop changes must not replay the gesture.
  }, [gestureKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (boopKey) play('boop'); }, [boopKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const wasNear = useRef(false);
  useEffect(() => {
    if (near && !wasNear.current && !hovered) play('curious');
    wasNear.current = near;
  }, [near]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (quiet) { setGesture(null); clearTimeout(clearRef.current); return; }
    let timer: ReturnType<typeof setTimeout>;
    let beat = 0;
    const tick = () => {
      if (!document.hidden && !hovered) {
        beat++;
        play(beat % 17 === 0 ? 'sleep' : beat % 13 === 0 ? 'yawn' : beat % 11 === 0 ? 'tap' : beat % 7 === 0 ? 'stretch' : beat % 5 === 0 ? 'look' : 'blink');
      }
      timer = setTimeout(tick, 4300 + beat % 3 * 900);
    };
    timer = setTimeout(tick, 3200);
    const visibility = () => { if (document.hidden) { setGesture(null); clearTimeout(clearRef.current); } };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [quiet, hovered]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = { '--resident-gx': gx ? `${gx.toFixed(2)}px` : '0px', '--resident-gy': gy ? `${gy.toFixed(2)}px` : '0px', '--resident-tilt': tilt ? `${tilt.toFixed(2)}deg` : '0deg' } as CSSProperties;
  return <svg className="resident" width={size} height={size} viewBox={size <= 24 ? '5 8 86 74' : '0 0 96 96'} role="img" aria-label="Ledge" data-theme={theme} data-large={String(size > 24)} data-near={String(near)} data-dnd={String(dnd)} data-frozen={String(frozen)} data-quiet={String(quiet)} data-gesture={gesture ?? undefined} style={style} onMouseEnter={() => { setHovered(true); play('happy'); }} onMouseLeave={() => setHovered(false)}>
    <defs>
      <linearGradient id={`${id}-shell`} x1=".15" y1="0" x2=".75" y2="1"><stop className="resident-top" /><stop className="resident-bottom" offset="1" /></linearGradient>
      <radialGradient id={`${id}-sheen`} cx=".3" cy=".2" r=".75"><stop className="resident-sheen" /><stop className="resident-sheen" offset="1" stopOpacity="0" /></radialGradient>
    </defs>
    <g className="resident-body"><g className="resident-pose">
      <path className="resident-antenna" d="M48 23v-7" /><circle className="resident-light" cx="48" cy="14" r="2.6" />
      <path className="resident-shell" d={HEAD} fill={`url(#${id}-shell)`} />
      {size > 24 && <path d={HEAD} fill={`url(#${id}-sheen)`} />}
      <g className="resident-gaze"><g className="resident-blink">
        <g className="resident-eyes"><rect x="37" y="35" width="6" height="12" rx="3" /><rect x="53" y="35" width="6" height="12" rx="3" />{size > 24 && <g className="resident-glint"><circle cx="38.8" cy="37.8" r="1.5" /><circle cx="54.8" cy="37.8" r="1.5" /></g>}</g>
        <path className="resident-smile" d="M36 43q4-7 8 0m8 0q4-7 8 0" /><path className="resident-sleep" d="M36 42q4 4 8 0m8 0q4 4 8 0" />
      </g></g>
    </g></g>
    <rect className="resident-wall" x="9" y="59" width="78" height="20" rx="6" />
    <rect className="resident-slab" x="6" y="55" width="84" height="7" rx="3.5" />
    <path className="resident-rim" d="M12 56.4H84" />
    <rect className="resident-shell resident-grip" x="26" y="50" width="12" height="9" rx="4.5" fill={`url(#${id}-shell)`} />
    <rect className="resident-shell resident-hand" x="58" y="50" width="12" height="9" rx="4.5" fill={`url(#${id}-shell)`} />
    <title>{frozen ? t.residentOffline : t.residentName}</title>
  </svg>;
}
