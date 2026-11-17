import { expect, it } from 'vitest';
import { wheelLines, wheelReport } from '../src/term/wheel';

const PIXEL = 0, LINE = 1, PAGE = 2;

it('counts pixels in rows, keeping the remainder for the next event', () => {
  // A notch in WebView2: 100 px over rows of 17 px, 5 lines and 15 px carried over.
  let r = wheelLines({ deltaY: -100, deltaMode: PIXEL }, 17, 24, 0);
  expect(r.lines).toBe(-5);
  r = wheelLines({ deltaY: -100, deltaMode: PIXEL }, 17, 24, r.partial);
  expect(r.lines).toBe(-6);
  // A touchpad's small steps add up to a line.
  r = wheelLines({ deltaY: 6, deltaMode: PIXEL }, 17, 24, 0);
  expect(r.lines).toBe(0);
  r = wheelLines({ deltaY: 6, deltaMode: PIXEL }, 17, 24, r.partial);
  r = wheelLines({ deltaY: 6, deltaMode: PIXEL }, 17, 24, r.partial);
  expect(r.lines).toBe(1);
});

it('takes lines as they are, a page as the screen, and never more than a screen per event', () => {
  expect(wheelLines({ deltaY: 3, deltaMode: LINE }, 17, 24, 0).lines).toBe(3);
  expect(wheelLines({ deltaY: -1, deltaMode: PAGE }, 17, 24, 0).lines).toBe(-24);
  expect(wheelLines({ deltaY: 5000, deltaMode: PIXEL }, 17, 24, 0).lines).toBe(24);
  expect(wheelLines({ deltaY: 0, deltaMode: PIXEL }, 17, 24, 0.5)).toEqual({ lines: 0, partial: 0.5 });
});

it('writes SGR reports with the modifiers in the button', () => {
  const none = { shift: false, alt: false, ctrl: false };
  expect(wheelReport(-1, 3, 7, none, 'sgr')).toBe('\x1b[<64;3;7M');
  expect(wheelReport(1, 3, 7, none, 'sgr')).toBe('\x1b[<65;3;7M');
  expect(wheelReport(-1, 1, 1, { shift: true, alt: true, ctrl: true }, 'sgr')).toBe('\x1b[<92;1;1M');
});

it('writes default reports as bytes, and none past what they can hold or for an unknown encoding', () => {
  const none = { shift: false, alt: false, ctrl: false };
  expect(wheelReport(-1, 1, 2, none, 'default')).toBe('\x1b[M' + String.fromCharCode(96, 33, 34));
  // Past 95 a byte would not stay one byte once the text is UTF-8.
  expect(wheelReport(1, 95, 95, none, 'default')).toBe('\x1b[M' + String.fromCharCode(97, 127, 127));
  expect(wheelReport(1, 96, 1, none, 'default')).toBeNull();
  expect(wheelReport(1, 1, 96, none, 'default')).toBeNull();
  expect(wheelReport(1, 1, 1, none, 'other')).toBeNull();
});
