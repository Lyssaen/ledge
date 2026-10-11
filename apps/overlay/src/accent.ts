/** The brand colour others can claim as theirs. Absent or invalid: the factory coral in tokens.css. */
const KEY = 'ledge.accent';
export const DEFAULT_ACCENT = '#e85d4a';

type Rgb = [number, number, number];

export function parseAccent(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
  const hex = m?.[1];
  return hex ? `#${hex.toLowerCase()}` : null;
}

export function loadAccent(): string | null {
  try { return parseAccent(localStorage.getItem(KEY)); } catch { return null; }
}

export function saveAccent(hex: string | null): void {
  try {
    const parsed = hex === null ? null : parseAccent(hex);
    if (parsed === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, parsed);
  } catch { /* storage unavailable: the in-memory value still applies */ }
}

const hexRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbHex = ([r, g, b]: Rgb) => `#${[r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

export interface AccentTokens {
  primary: string;
  primaryHover: string;
  primaryForeground: string;
  sidebarPrimary: string;
  residentGlow: string;
  residentGlowSoft: string;
  residentEye: string;
}

/** Theme-aware chrome and mascot tints from one #rrggbb. Does not touch danger / success / warning. */
export function accentTokens(hex: string, theme: 'dark' | 'light'): AccentTokens {
  const rgb = hexRgb(parseAccent(hex) ?? DEFAULT_ACCENT);
  const sidebar = theme === 'light' ? mix(rgb, BLACK, 0.12) : mix(rgb, WHITE, 0.08);
  const primary = mix(sidebar, BLACK, theme === 'light' ? 0.12 : 0.22);
  const hover = mix(primary, BLACK, 0.12);
  const glow = theme === 'light' ? mix(rgb, BLACK, 0.18) : mix(rgb, WHITE, 0.18);
  return {
    primary: rgbHex(primary),
    primaryHover: rgbHex(hover),
    primaryForeground: lum(primary) > 140 ? rgbHex(mix(BLACK, rgb, 0.12)) : '#f7f0ee',
    sidebarPrimary: rgbHex(sidebar),
    residentGlow: rgbHex(glow),
    residentGlowSoft: rgbHex(mix(glow, WHITE, 0.28)),
    residentEye: rgbHex(mix(rgb, WHITE, 0.42))
  };
}

const VARS = ['--primary', '--primary-hover', '--primary-foreground', '--sidebar-primary', '--ledge-glow', '--ledge-glow-soft', '--ledge-eye'] as const;

/** Paint the derived tokens on an element; `null` or garbage removes them so the factory CSS wins. */
export function applyAccent(hex: string | null, theme: 'dark' | 'light', el: HTMLElement = document.documentElement): void {
  const parsed = parseAccent(hex);
  if (!parsed) {
    for (const name of VARS) el.style.removeProperty(name);
    return;
  }
  const t = accentTokens(parsed, theme);
  el.style.setProperty('--primary', t.primary);
  el.style.setProperty('--primary-hover', t.primaryHover);
  el.style.setProperty('--primary-foreground', t.primaryForeground);
  el.style.setProperty('--sidebar-primary', t.sidebarPrimary);
  el.style.setProperty('--ledge-glow', t.residentGlow);
  el.style.setProperty('--ledge-glow-soft', t.residentGlowSoft);
  el.style.setProperty('--ledge-eye', t.residentEye);
}
