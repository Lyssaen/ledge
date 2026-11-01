import { useEffect, useId, useRef } from 'react';

// Ledge mascot for the office floor.
export type LedgePalette = 'darkred' | 'red' | 'sage' | 'rose' | 'peach' | 'sky' | 'lilac' | 'vanilla';

/** The eyes follow the pointer up to this many pixels beyond the mascot's edges. */
const REACH = 240;
const HEAD = 'M25 60V41C25 28 35 23 48 23C61 23 71 28 71 41V60Z';

export function LedgeSketch({ palette, size, theme, label }: { palette: LedgePalette; size: number; theme: 'dark' | 'light'; label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const id = `ls-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const small = size <= 32;

  useEffect(() => {
    const el = ref.current;
    if (!el || small) return;
    const move = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const dx = event.clientX - box.left - box.width / 2;
      const dy = event.clientY - box.top - box.height / 2;
      const far = Math.abs(dx) > box.width / 2 + REACH || Math.abs(dy) > box.height / 2 + REACH;
      const clamp = (n: number) => Math.max(-1, Math.min(1, n));
      el.style.setProperty('--ls-gx', far ? '0px' : `${clamp(dx / (box.width / 2 + REACH)) * 3}px`);
      el.style.setProperty('--ls-gy', far ? '0px' : `${clamp(dy / (box.height / 2 + REACH)) * 2}px`);
    };
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [small]);

  const shell = `url(#${id}-shell)`;
  return <svg ref={ref} className="ledge-sketch" data-palette={palette} data-theme={theme} data-small={String(small)}
    role="img" aria-label={label} width={size} height={size} viewBox="0 0 96 96">
    <defs>
      <linearGradient id={`${id}-shell`} x1=".15" y1="0" x2=".75" y2="1"><stop className="ls-top" /><stop className="ls-bottom" offset="1" /></linearGradient>
      <radialGradient id={`${id}-sheen`} cx=".3" cy=".2" r=".75"><stop className="ls-sheen" /><stop className="ls-sheen" offset="1" stopOpacity="0" /></radialGradient>
    </defs>
    <g className="ls-breathe">
      <path className="ls-antenna" d="M48 23V16" /><circle className="ls-light" cx="48" cy="14" r="2.6" />
      <path className="ls-shell" d={HEAD} fill={shell} />
      {!small && <path d={HEAD} fill={`url(#${id}-sheen)`} />}
      <g className="ls-gaze"><g className="ls-blink">
        <rect className="ls-eye" x="37" y="35" width="6" height="12" rx="3" /><rect className="ls-eye" x="53" y="35" width="6" height="12" rx="3" />
        {!small && <><circle className="ls-glint" cx="38.8" cy="37.8" r="1.5" /><circle className="ls-glint" cx="54.8" cy="37.8" r="1.5" /></>}
      </g></g>
    </g>
    <rect className="ls-wall" x="9" y="59" width="78" height="20" rx="6" />
    <rect className="ls-slab" x="6" y="55" width="84" height="7" rx="3.5" />
    <path className="ls-accent-line" d="M12 56.4H84" />
    <rect className="ls-shell" x="26" y="50" width="12" height="9" rx="4.5" fill={shell} />
    <rect className="ls-shell" x="58" y="50" width="12" height="9" rx="4.5" fill={shell} />
  </svg>;
}
