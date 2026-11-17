import { beforeEach, expect, it } from 'vitest';
import { wheelLines, wheelReport, type WheelPref } from '../src/term/wheel';
import { loadWheel, saveWheel, WHEEL_DEFAULT } from '../src/term/wheelPrefs';

const PIXEL = 0, LINE = 1, PAGE = 2;
const system: WheelPref = { mode: 'system', lines: 3 };
const fixed = (lines: number): WheelPref => ({ mode: 'fixed', lines });

beforeEach(() => { localStorage.clear(); });

it('like Windows: a notch is worth the lines Windows sets, read from its pixels (100 px for 3 lines)', () => {
  expect(wheelLines({ deltaY: -100, deltaMode: PIXEL }, system, 24, 0).lines).toBe(-3);
  // Windows at 6 lines: 200 px.
  expect(wheelLines({ deltaY: 200, deltaMode: PIXEL }, system, 24, 0).lines).toBe(6);
  // A touchpad's small steps add up, the remainder carried.
  let r = wheelLines({ deltaY: 20, deltaMode: PIXEL }, system, 24, 0);
  expect(r.lines).toBe(0);
  r = wheelLines({ deltaY: 20, deltaMode: PIXEL }, system, 24, r.partial);
  expect(r.lines).toBe(1);
  // « One screen at a time »: a page.
  expect(wheelLines({ deltaY: -1, deltaMode: PAGE }, system, 24, 0).lines).toBe(-24);
  expect(wheelLines({ deltaY: 3, deltaMode: LINE }, system, 24, 0).lines).toBe(3);
});

it('a speed chosen: that many lines per notch, whatever Windows sets', () => {
  // A notch is 120 in `wheelDeltaY` (up is positive there), however many pixels Windows makes of it.
  expect(wheelLines({ deltaY: -100, deltaMode: PIXEL, wheelDeltaY: 120 }, fixed(8), 24, 0).lines).toBe(-8);
  expect(wheelLines({ deltaY: 400, deltaMode: PIXEL, wheelDeltaY: -240 }, fixed(8), 24, 0).lines).toBe(16);
  // A touchpad's quarter notch: two lines out of eight.
  expect(wheelLines({ deltaY: 25, deltaMode: PIXEL, wheelDeltaY: -30 }, fixed(8), 24, 0).lines).toBe(2);
  // Without `wheelDeltaY`, 100 px is a notch.
  expect(wheelLines({ deltaY: 100, deltaMode: PIXEL }, fixed(5), 24, 0).lines).toBe(5);
  expect(wheelLines({ deltaY: -1, deltaMode: PAGE }, fixed(5), 24, 0).lines).toBe(-24);
});

it('a line rounded a hair short is still a line, and a fraction left the other way is dropped when the wheel turns back', () => {
  expect(wheelLines({ deltaY: 33.33333206, deltaMode: PIXEL }, system, 24, 0).lines).toBe(1);
  expect(wheelLines({ deltaY: -99.9999962, deltaMode: PIXEL }, system, 24, 0).lines).toBe(-3);
  // Two thirds of a line down are left; one line up still moves one line up.
  const r = wheelLines({ deltaY: -33.34, deltaMode: PIXEL }, system, 24, 0.66);
  expect(r.lines).toBe(-1);
  // A touchpad at one line per notch: four quarter notches make the line.
  let q = { lines: 0, partial: 0 };
  let total = 0;
  for (let i = 0; i < 4; i++) { q = wheelLines({ deltaY: 25, deltaMode: PIXEL, wheelDeltaY: -30 }, fixed(1), 24, q.partial); total += q.lines; }
  expect(total).toBe(1);
});

it('never more than a screen per event, and nothing without a vertical move', () => {
  expect(wheelLines({ deltaY: 5000, deltaMode: PIXEL }, system, 24, 0).lines).toBe(24);
  expect(wheelLines({ deltaY: -100, deltaMode: PIXEL, wheelDeltaY: 120 }, fixed(20), 10, 0).lines).toBe(-10);
  expect(wheelLines({ deltaY: 0, deltaMode: PIXEL }, system, 24, 0.5)).toEqual({ lines: 0, partial: 0.5 });
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

it('the setting: like Windows by default, a chosen speed kept between 1 and 20, anything else the default', () => {
  expect(loadWheel()).toEqual(WHEEL_DEFAULT);
  expect(WHEEL_DEFAULT).toEqual({ mode: 'system', lines: 3 });
  saveWheel({ mode: 'fixed', lines: 8 });
  expect(loadWheel()).toEqual({ mode: 'fixed', lines: 8 });
  saveWheel({ mode: 'fixed', lines: 99 });
  expect(loadWheel()).toEqual({ mode: 'fixed', lines: 20 });
  saveWheel({ mode: 'system', lines: 0 });
  expect(loadWheel()).toEqual({ mode: 'system', lines: 1 });
  localStorage.setItem('ledge.ide.wheel', '"fast"');
  expect(loadWheel()).toEqual(WHEEL_DEFAULT);
  localStorage.setItem('ledge.ide.wheel', '{"mode":"fixed","lines":2.5}');
  expect(loadWheel()).toEqual(WHEEL_DEFAULT);
});
