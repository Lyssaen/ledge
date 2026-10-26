import type { Tone } from './theme.js';

/** `COLORFGBG` (rxvt, Konsole, iTerm2…), `fg;bg` or `fg;default;bg`: its last field is the background's colour number,
 *  0 to 6 and 8 dark, the others light, as Vim reads it. Not set, or `default`: unknown. */
export function toneOfColorFgBg(value: string | undefined): Tone | null {
  const bg = value?.split(';').at(-1);
  if (!bg || !/^\d+$/.test(bg)) return null;
  const n = Number(bg);
  return n <= 6 || n === 8 ? 'dark' : 'light';
}

/** The answer to OSC 11, `ESC ] 11 ; rgb:RRRR/GGGG/BBBB` (1 to 4 hex digits a channel) ended by BEL or ST: light past half
 *  the luminance. */
export function toneOfOsc11(reply: string): Tone | null {
  const m = /\u001b\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(reply);
  if (!m) return null;
  const [r, g, b] = m.slice(1, 4).map(x => parseInt(x, 16) / (16 ** x.length - 1)) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5 ? 'light' : 'dark';
}

export interface TerminalIo {
  stdin: { isTTY?: boolean; isRaw?: boolean; setRawMode?(on: boolean): unknown; on(e: 'data', f: (b: Buffer) => void): unknown; off(e: 'data', f: (b: Buffer) => void): unknown; resume(): unknown; pause(): unknown };
  stdout: { isTTY?: boolean; write(s: string): unknown };
}

/** Asks the terminal its background (OSC 11), then its attributes (DA1), which every terminal answers, in order: DA1 come
 *  back alone, the terminal knows no OSC 11, no need to wait. Nothing back within `ms` (a terminal that answers nothing, a
 *  slow link), unknown. The terminal is given back as found, raw mode and all. tmux answers OSC 11 itself (3.3 and later),
 *  from the outer terminal's colour; an older one answers DA1 only. */
export function askBackground(io: TerminalIo, ms = 150): Promise<Tone | null> {
  const { stdin, stdout } = io;
  if (!stdin.isTTY || !stdout.isTTY || !stdin.setRawMode) return Promise.resolve(null);
  return new Promise(resolve => {
    const wasRaw = stdin.isRaw === true;
    let got = '';
    const done = (tone: Tone | null) => {
      clearTimeout(timer);
      stdin.off('data', onData);
      stdin.setRawMode!(wasRaw);
      stdin.pause();
      resolve(tone);
    };
    const onData = (b: Buffer) => {
      got += b.toString('latin1');
      const tone = toneOfOsc11(got);
      if (tone) { if (/\u001b\[\?[\d;]*c/.test(got)) done(tone); return; }
      // DA1 without OSC 11 before it: the terminal does not tell its background.
      if (/\u001b\[\?[\d;]*c/.test(got)) done(null);
    };
    const timer = setTimeout(() => done(toneOfOsc11(got)), ms);
    stdin.setRawMode!(true);
    stdin.on('data', onData);
    stdin.resume();
    stdout.write('\u001b]11;?\u0007\u001b[c');
  });
}

/** The terminal's background: `COLORFGBG`, else OSC 11, else dark (the palette Ledge's TUI was drawn for). */
export async function detectTone(env: NodeJS.ProcessEnv, io: TerminalIo, ms?: number): Promise<Tone> {
  return toneOfColorFgBg(env.COLORFGBG) ?? (await askBackground(io, ms)) ?? 'dark';
}
