import { useEffect, useRef, useState, type CSSProperties } from 'react';
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

/** A vector portrait with independent gaze, pose, antenna and hand layers. It belongs to Ledge, not an agent tool. */
export function ResidentMascot({ size, theme, paused = false, frozen = false, reducedMotion = false, dnd = false, pointer = null, center, gestureKey, gestureKind = 'hello', boopKey }: ResidentMascotProps) {
  const t = useUiCopy();
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
  return <svg className="resident" width={size} height={size} viewBox={size <= 24 ? '12 8 72 76' : '0 0 96 96'} role="img" aria-label="Ledge" data-theme={theme} data-large={String(size > 24)} data-near={String(near)} data-dnd={String(dnd)} data-frozen={String(frozen)} data-quiet={String(quiet)} data-gesture={gesture ?? undefined} style={style} onMouseEnter={() => { setHovered(true); play('happy'); }} onMouseLeave={() => setHovered(false)}>
    <g className="resident-body"><g className="resident-pose">
      <path className="resident-antenna" d="M48 23v-9" /><circle className="resident-light" cx="48" cy="12" r="3" />
      <rect className="resident-foot" x="30" y="74" width="12" height="8" rx="4" /><rect className="resident-foot" x="54" y="74" width="12" height="8" rx="4" />
      <path className="resident-shell" d="M23 33Q25 21 40 21h16q15 0 17 12l5 23q4 22-17 22H35Q14 78 18 56Z" />
      <path className="resident-shine" d="M28 34q3-7 14-7h12" /><rect className="resident-visor" x="25" y="37" width="46" height="27" rx="12" />
      <g className="resident-gaze"><g className="resident-blink"><g className="resident-eyes"><rect x="35" y="44" width="6" height="12" rx="3" /><rect x="55" y="44" width="6" height="12" rx="3" /></g><path className="resident-smile" d="M34 51q4-8 8 0m12 0q4-8 8 0" /><path className="resident-sleep" d="M34 50q4 4 8 0m12 0q4 4 8 0" /></g></g>
      <ellipse className="resident-hand" cx="78" cy="63" rx="5" ry="8" />
    </g></g>
    <title>{frozen ? t.residentOffline : t.residentName}</title>
  </svg>;
}
