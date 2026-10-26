import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { askBackground, detectTone, toneOfColorFgBg, toneOfOsc11 } from '../src/tui/background.js';
import { C, PALETTES, STATE_COLOR, setTone, toneFor } from '../src/tui/theme.js';

/** A terminal on a fake TTY: what the TUI writes, and what the terminal answers to it. */
function terminal(answer: (query: string) => string | null, o: { tty?: boolean } = {}) {
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: o.tty ?? true, isRaw: false, paused: true,
    setRawMode(on: boolean) { this.isRaw = on; return this; },
    resume() { this.paused = false; return this; },
    pause() { this.paused = true; return this; }
  });
  const written: string[] = [];
  const stdout = { isTTY: o.tty ?? true, write(s: string) { written.push(s); const a = answer(s); if (a !== null) setTimeout(() => stdin.emit('data', Buffer.from(a)), 5); return true; } };
  return { stdin, stdout, written };
}

const OSC = '\u001b]11;?\u0007\u001b[c';
const DA1 = '\u001b[?62;22c';

describe('ledge tui: the terminal\'s background (#95 lot D)', () => {
  it('COLORFGBG: its last field is the background, 0 to 6 and 8 dark, the others light', () => {
    expect(toneOfColorFgBg('15;0')).toBe('dark');
    expect(toneOfColorFgBg('0;15')).toBe('light');
    expect(toneOfColorFgBg('0;7')).toBe('light');
    expect(toneOfColorFgBg('7;8')).toBe('dark');
    expect(toneOfColorFgBg('0;default;15')).toBe('light');
    expect(toneOfColorFgBg('default;default')).toBeNull();
    expect(toneOfColorFgBg(undefined)).toBeNull();
    expect(toneOfColorFgBg('')).toBeNull();
  });

  it('OSC 11: rgb in 1 to 4 digits, ended by BEL or ST, light past half the luminance', () => {
    expect(toneOfOsc11('\u001b]11;rgb:ffff/ffff/ffff\u0007')).toBe('light');
    expect(toneOfOsc11('\u001b]11;rgb:fbfb/f9f9/f6f6\u001b\\')).toBe('light');
    expect(toneOfOsc11('\u001b]11;rgb:12/11/10\u0007')).toBe('dark');
    expect(toneOfOsc11('\u001b]11;rgb:1e1e/1e1e/2e2e\u0007')).toBe('dark');
    expect(toneOfOsc11('\u001b]11;rgba:ffff/ffff/ffff/ffff\u0007')).toBe('light');
    expect(toneOfOsc11('nothing')).toBeNull();
  });

  it('asks OSC 11 then DA1, takes the answer and gives the terminal back as it was', async () => {
    const term = terminal(q => (q === OSC ? `\u001b]11;rgb:fbfb/f9f9/f6f6\u0007${DA1}` : null));
    expect(await askBackground(term, 500)).toBe('light');
    expect(term.written).toEqual([OSC]);
    expect(term.stdin.isRaw).toBe(false);
    expect(term.stdin.paused).toBe(true);
    expect(term.stdin.listenerCount('data')).toBe(0);
  });

  it('a terminal that knows no OSC 11 answers DA1 only: no background, at once, not after the delay', async () => {
    const term = terminal(q => (q === OSC ? DA1 : null));
    const t0 = Date.now();
    expect(await askBackground(term, 2000)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('a terminal that answers nothing: no background once the delay is out', async () => {
    const term = terminal(() => null);
    expect(await askBackground(term, 60)).toBeNull();
    expect(term.stdin.isRaw).toBe(false);
    expect(term.stdin.listenerCount('data')).toBe(0);
  });

  it('not a terminal: nothing is asked', async () => {
    const term = terminal(() => null, { tty: false });
    expect(await askBackground(term, 60)).toBeNull();
    expect(term.written).toEqual([]);
  });

  it('COLORFGBG first, then OSC 11, else dark', async () => {
    const light = terminal(q => (q === OSC ? `\u001b]11;rgb:ffff/ffff/ffff\u0007${DA1}` : null));
    expect(await detectTone({ COLORFGBG: '15;0' }, light)).toBe('dark');
    expect(light.written).toEqual([]);
    expect(await detectTone({}, light)).toBe('light');
    expect(await detectTone({}, terminal(q => (q === OSC ? DA1 : null)))).toBe('dark');
  });
});

describe('ledge tui: the palette (#95 lot D)', () => {
  it('auto follows the background; dark and light are chosen as they are', () => {
    expect(toneFor('auto', 'light')).toBe('light');
    expect(toneFor('auto', 'dark')).toBe('dark');
    expect(toneFor('dark', 'light')).toBe('dark');
    expect(toneFor('light', 'dark')).toBe('light');
  });

  it('the light palette is the mockup\'s, the states follow it', () => {
    try {
      setTone('light');
      expect(C.fg).toBe('#24201d');
      expect(C.coral).toBe('#c44a2f');
      expect(C.bar).toBe('#ece6e0');
      expect(STATE_COLOR.approval).toBe(PALETTES.light.red);
      setTone('dark');
      expect(C.fg).toBe('#e6e0dc');
      expect(C.bar).toBe('#1f1d1b');
      expect(STATE_COLOR.working).toBe(PALETTES.dark.blue);
    } finally { setTone('dark'); }
  });

  it('both palettes have the same colours', () => {
    expect(Object.keys(PALETTES.light).sort()).toEqual(Object.keys(PALETTES.dark).sort());
  });
});
