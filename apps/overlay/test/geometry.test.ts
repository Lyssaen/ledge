import { describe, it, expect } from 'vitest';
import { layout, scaledLayout, awakeWidth, filetWidth, NOTCH, OPEN_MAX_SHARE, SIZES, SURFACE_CHROME_Y } from '../src/surface/geometry';
import { frameOf } from '../src/surface/frame';
const bots = (n: number, pending: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: String(i), pending: pending.includes(i) }));
const W = 1920, H = 1080;

describe('island geometry', () => {
  it('the filet: Ledge’s mark, then the update dash and the music bars, 4 px apart; never a session dash', () => {
    expect(filetWidth()).toBe(6 + 9 + 6);
    expect(filetWidth({ pip: true })).toBe(21 + 4 + 5);
    expect(filetWidth({ pip: true, playing: true })).toBe(21 + 9 + 9);
    expect(layout({ bots: bots(8, [6]), mode: 'handle', screenH: H, screenW: W })).toMatchObject({ w: 21, h: 10, slots: [] });
    expect(layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W, pip: true, notch: { playing: true } }).w).toBe(39);
  });
  it('awake: Ledge, the DND moon, the line (420 px, 220 with the controls open), the filet and the 24 px cover', () => {
    expect(awakeWidth()).toBe(12 + 22 + 12);
    expect(awakeWidth({ dnd: true })).toBe(46 + 6 + 12);
    expect(awakeWidth({ line: 200 })).toBe(46 + 10 + 200);
    expect(awakeWidth({ line: 900 })).toBe(46 + 10 + NOTCH.lineMax);
    expect(awakeWidth({ music: true })).toBe(46 + 12 + 1 + 10 + 24);
    expect(awakeWidth({ line: 900, music: true, musicOpen: true })).toBe(Math.min(NOTCH.max, 46 + 10 + 220 + 23 + 24 + 16 + 168 + 84 + 4));
    expect(awakeWidth({ line: 900, music: true, musicOpen: true, dnd: true })).toBeLessThanOrEqual(NOTCH.max);
  });
  it('the measured width wins over the estimate, at rest and awake; the strip keeps the filet; a bubble still opens at 440', () => {
    expect(layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W, awake: true, handleW: 333 })).toMatchObject({ w: 333, h: 38, left: Math.round(W / 2 - 333 / 2) });
    expect(layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W, awake: true })).toMatchObject({ w: awakeWidth(), h: 38 });
    expect(layout({ bots: bots(3), mode: 'handle', screenH: H, screenW: W, strip: true })).toMatchObject({ top: 0, h: 10, w: filetWidth() });
    expect(layout({ bots: bots(3), mode: 'bubble', screenH: H, screenW: W, strip: true })).toMatchObject({ w: SIZES.bubbleW, h: SIZES.bubbleH });
    expect(layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W, strip: true }).w).toBe(SIZES.listW);
  });
  it('every view hangs from the top edge, centred on the axis, at its own width', () => {
    const list = layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W });
    expect(list).toMatchObject({ top: 0, w: SIZES.listW, left: (W - SIZES.listW) / 2 });
    expect(list.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + SIZES.footerH + SURFACE_CHROME_Y);
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500 })).toMatchObject({ top: 0, w: 480, h: 500, left: (W - 480) / 2 });
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500, reading: true }).w).toBe(1152); // 60% of W
    expect(layout({ bots: bots(2), mode: 'launch', screenH: 1440, screenW: W })).toMatchObject({ w: SIZES.listW, h: SIZES.launchH });
    expect(layout({ bots: bots(2), mode: 'launch', screenH: 1440, screenW: W, detailH: 700 }).h).toBe(700);
    expect(layout({ bots: [], mode: 'chat', screenH: 1000, screenW: W, detailH: 500 })).toMatchObject({ w: SIZES.sessionW, h: 500 });
    expect(layout({ bots: [], mode: 'chat', screenH: 1200, screenW: W }).h).toBe(SIZES.chatH);
    expect(layout({ bots: [], mode: 'list', screenH: H, screenW: W }).h).toBe(SIZES.headerH + SIZES.emptyH + SIZES.footerH + SURFACE_CHROME_Y);
  });
  it('an open view takes half the work area at most (the closed notch is not concerned)', () => {
    expect(OPEN_MAX_SHARE).toBe(0.5);
    // A long chat: 540 px on a 1080 work area, 720 on a 1440 one; its thread scrolls past that.
    expect(layout({ bots: [], mode: 'chat', screenH: 1080, screenW: W, detailH: 2000 }).h).toBe(540);
    expect(layout({ bots: [], mode: 'chat', screenH: 1440, screenW: 2560, detailH: 2000 }).h).toBe(720);
    // Under a 150 % window size the cap stays half of the real screen.
    expect(scaledLayout({ bots: [], mode: 'chat', screenH: 1440, screenW: 2560, detailH: 2000 }, { handle: 1, panel: 1.5 }).h).toBeCloseTo(720, 0);
    // The reader, 760 px tall before the cap: 540 on a 1080 work area, expanded or not; its page scrolls (document-view.test).
    expect(layout({ bots: [], mode: 'reader', screenH: 1080, screenW: W })).toMatchObject({ w: SIZES.readerW, h: 540 });
    expect(layout({ bots: [], mode: 'reader', screenH: 1080, screenW: W, readerExpanded: true }).h).toBe(540);
    for (const mode of ['session', 'reader', 'settings', 'help', 'launch', 'list', 'helper'] as const)
      expect(layout({ bots: bots(30), mode, screenH: 1080, screenW: W, sessionH: 2000, helperH: 2000, detailH: 2000 }).h).toBe(540);
    expect(layout({ bots: bots(30), mode: 'handle', screenH: 1080, screenW: W, awake: true }).h).toBe(38);
    expect(layout({ bots: bots(30), mode: 'list', screenH: 600, screenW: W }).h).toBe(300);
    expect(layout({ bots: bots(0), mode: 'launch', screenH: 300, screenW: W }).h).toBe(150);
    expect(layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W, listExtraH: 42 }).h).toBe(layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W }).h + 42);
  });
  it('the empty list also grows by the extra height (the update card, the notice)', () => {
    expect(layout({ bots: [], mode: 'list', screenH: H, screenW: W, listExtraH: 150 }).h).toBe(layout({ bots: [], mode: 'list', screenH: H, screenW: W }).h + 150);
  });
  it('the bubble is the island stretched to 440 px, top edge, centred, whatever bot asks', () => {
    const l = layout({ bots: bots(5, [4]), mode: 'bubble', screenH: H, screenW: W });
    expect(l).toMatchObject({ top: 0, w: 440, h: SIZES.bubbleH, left: (W - 440) / 2 });
    expect(layout({ bots: bots(5, [4]), mode: 'bubble', screenH: H, screenW: W, bubbleH: 160 }).h).toBe(160);
  });
  it('the reader is 560 or 800, shrunk to the work area minus 24, and its frame stays on screen', () => {
    expect(layout({ bots: [], mode: 'reader', screenH: 1600, screenW: 1200 })).toMatchObject({ w: 560, h: 760, top: 0 });
    expect(layout({ bots: [], mode: 'reader', screenH: 600, screenW: 1200, readerExpanded: true })).toMatchObject({ w: 800, h: 300 });
    const narrow = layout({ bots: [], mode: 'reader', screenH: 900, screenW: 700, readerExpanded: true });
    expect(narrow.w).toBe(676); expect(narrow.left).toBe(12);
    for (const panel of [1, 1.5, 2]) {
      const g = scaledLayout({ bots: [], mode: 'reader', screenH: 900, screenW: 700, readerExpanded: true }, { handle: 1, panel });
      const f = frameOf(g, [], { w: 700, h: 900 });
      expect(f.left).toBeGreaterThanOrEqual(0); expect(f.left + f.w).toBeLessThanOrEqual(700);
    }
  });
  it('an enlarged view (reading mode, expanded reader) takes 60% of the screen, between its old width and 1200', () => {
    const w = (mode: 'session' | 'reader', screenW: number) => layout({ bots: [], mode, screenH: H, screenW, reading: true, readerExpanded: true }).w;
    expect(w('session', 1920)).toBe(1152); expect(w('reader', 1920)).toBe(1152);
    expect(w('session', 2560)).toBe(1200); expect(w('reader', 3840)).toBe(1200);
    expect(w('session', 1280)).toBe(800); expect(w('reader', 1280)).toBe(800);
    expect(w('session', 800)).toBe(776); // the terminal sits alongside: as wide as the screen allows
    expect(w('session', 500)).toBe(480); // never narrower than the session view itself
    expect(layout({ bots: [], mode: 'session', screenH: H, screenW: 1920, sessionH: 500 }).w).toBe(SIZES.sessionW);
  });
  it('the island position moves the axis to a quarter of the screen, clamped inside it', () => {
    const left = layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W, position: 'left' });
    expect(left.left).toBe(Math.round(W / 4 - filetWidth() / 2));
    const right = layout({ bots: bots(2), mode: 'list', screenH: H, screenW: W, position: 'right' });
    expect(right.left).toBe(Math.round((3 * W) / 4 - SIZES.listW / 2));
    // A view wider than the quarter: never off the left edge, never off the right one.
    expect(layout({ bots: [], mode: 'reader', screenH: H, screenW: 1000, readerExpanded: true, position: 'left' }).left).toBe(0);
    expect(layout({ bots: [], mode: 'reader', screenH: H, screenW: 1000, readerExpanded: true, position: 'right' }).left).toBe(1000 - 800);
  });
  it('adds a header height per group to the list', () => {
    const two = bots(2);
    expect(layout({ bots: two, mode: 'list', screenH: 1000, screenW: W, groups: 2 }).h - layout({ bots: two, mode: 'list', screenH: 1000, screenW: W, groups: 1 }).h).toBe(SIZES.groupH);
  });
  it('scaled layout: the island follows the handle scale, the views the window scale, both centred on the real screen', () => {
    const input = { bots: bots(2, [1]), screenH: 2160, screenW: 3840 };
    const h1 = layout({ ...input, mode: 'handle', screenH: 1080, screenW: 1920 });
    const h2 = scaledLayout({ ...input, mode: 'handle' }, { handle: 2, panel: 1 });
    expect(h2).toMatchObject({ left: h1.left * 2, top: 0, w: h1.w * 2, h: h1.h * 2 });
    expect(h2.slots.map(s => s.center)).toEqual(h1.slots.map(s => s.center * 2));
    expect(h2.handle).toEqual({ left: h1.left * 2, w: h1.w * 2, h: 20 });
    const l = scaledLayout({ ...input, mode: 'list' }, { handle: 2, panel: 1 });
    expect(l.w).toBe(SIZES.listW);
    expect(l.left + l.w / 2).toBeCloseTo(1920, 0);
    expect(l.handle).toEqual(h2.handle);
    const base = layout({ ...input, mode: 'list', screenH: 2160 / 1.5, screenW: 3840 / 1.5 });
    const l15 = scaledLayout({ ...input, mode: 'list' }, { handle: 2, panel: 1.5 });
    expect(l15.w).toBe(SIZES.listW * 1.5);
    expect(l15.h).toBe((base.h - SURFACE_CHROME_Y) * 1.5 + SURFACE_CHROME_Y);
    expect(l15.left).toBe(base.left * 1.5);
  });
});
