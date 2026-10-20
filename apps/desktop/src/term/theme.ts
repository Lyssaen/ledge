export type TermTheme = import('@xterm/xterm').ITheme;

/** xterm's sixteen ANSI slots, in the order of `--term-ansi-0` … `--term-ansi-15`. */
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const;

/** xterm parses hex and rgb()/rgba() itself; anything else (the tokens are oklch) is painted on a canvas and read back as hex. */
function xtermColor(value: string): string {
  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value)) return value;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return value;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? '' : hex(a)}`;
}

/** The terminal's colours from Ledge's tokens (pass `getComputedStyle(document.documentElement)`); a token that is not set leaves xterm its default. */
export function termTheme(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): TermTheme {
  const read = (name: string) => { const v = style.getPropertyValue(name).trim(); return v ? xtermColor(v) : undefined; };
  const theme: TermTheme = {
    background: read('--term-bg'),
    foreground: read('--term-fg'),
    cursor: read('--term-cursor'),
    cursorAccent: read('--term-bg'),
    selectionBackground: read('--term-selection')
  };
  ANSI.forEach((slot, i) => { theme[slot] = read(`--term-ansi-${i}`); });
  return Object.fromEntries(Object.entries(theme).filter(([, v]) => v !== undefined)) as TermTheme;
}
