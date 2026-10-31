import { describe, it, expect } from 'vitest';
import { layout, scaledLayout, islandWidth, islandPipes, stripWidth, filetWidth, islandOrder, ISLAND, FILET, LINE, SIZES, SURFACE_CHROME_Y } from '../src/surface/geometry';
import { frameOf } from '../src/surface/frame';
const bots = (n: number, pending: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: String(i), pending: pending.includes(i) }));
const W = 1920, H = 1080;

describe('island geometry', () => {
  it('the compact island: margins, mascot, separator, 22 px companions 8 px apart, never past 300 px', () => {
    expect(islandWidth(0)).toBe(12 + 22 + 14);
    expect(islandWidth(2)).toBe(12 + 22 + 8 + 1 + 8 + 22 + 8 + 22 + 14);
    expect(islandWidth(6)).toBe(12 + 22 + 8 + 1 + 8 + 6 * 22 + 5 * 8 + 14);
    expect(islandWidth(7)).toBe(islandWidth(6) + 8 + ISLAND.pill);
    expect(islandWidth(40)).toBe(islandWidth(7));
    expect(islandWidth(40, true)).toBe(islandWidth(7) + 8 + ISLAND.moon);
    expect(islandWidth(40, true)).toBeLessThan(300);
  });
  it('several machines: this machine first, asks first inside each machine, a 9 px pipe between two machines', () => {
    const fleet = [{ id: 'r1', pending: false, machine: 'srv' }, { id: 'l1', pending: false }, { id: 'r2', pending: true, machine: 'srv' }, { id: 'l2', pending: true, machine: 'local' }, { id: 'o1', pending: false, machine: 'other' }];
    const ordered = islandOrder(fleet);
    expect(ordered.map(b => b.id)).toEqual(['l2', 'l1', 'r2', 'r1', 'o1']);
    expect(islandPipes(ordered)).toBe(2);
    expect(islandPipes(islandOrder(bots(8, [6])))).toBe(0);
    expect(islandWidth(5, false, 2)).toBe(islandWidth(5) + 2 * (8 + 1));
  });
  it('the resting notch is the filet: 10 px, Ledge’s rectangle; the sessions no longer widen it', () => {
    expect(filetWidth([])).toBe(21);
    expect(filetWidth([2])).toBe(40);
    expect(filetWidth([3, 3, 1])).toBe(85);
    expect(filetWidth([3, 3, 1], true)).toBe(90);
    expect(layout({ bots: [], mode: 'handle', screenH: H, screenW: W })).toMatchObject({ w: 21, h: 10 });
    const fleet = [{ id: 'l1', pending: false }, { id: 'l2', pending: true }, { id: 'r1', pending: false, machine: 'srv' }];
    expect(layout({ bots: bots(8, [6]), mode: 'handle', screenH: H, screenW: W })).toMatchObject({ top: 0, h: 10, w: filetWidth([]) });
    expect(layout({ bots: fleet, mode: 'handle', screenH: H, screenW: W, pip: true }).w).toBe(filetWidth([], true));
    const bubble = layout({ bots: bots(3), mode: 'bubble', screenH: H, screenW: W });
    expect(bubble).toMatchObject({ w: SIZES.bubbleW, h: SIZES.bubbleH });
  });
  it('awake, the island is the mascot alone whatever the sessions, the moon when on', () => {
    expect(layout({ bots: bots(4, [1]), mode: 'handle', awake: true, screenH: H, screenW: W })).toMatchObject({ w: islandWidth(0), h: ISLAND.h });
    expect(layout({ bots: bots(4), mode: 'handle', awake: true, dnd: true, screenH: H, screenW: W }).w).toBe(islandWidth(0, true));
  });
  it('the measured line widens the notch by its width and its gap, resting and awake', () => {
    expect(filetWidth([], false, { line: 30 })).toBe(filetWidth([]) + FILET.sep + 30);
    expect(islandWidth(0, false, 0, { line: 300 })).toBe(islandWidth(0) + LINE.gap + 300);
    const g = (awake: boolean, line?: number) => layout({ bots: bots(3), mode: 'handle', awake, line, screenH: H, screenW: W });
    expect(g(false, 30).w).toBe(g(false).w + FILET.sep + 30);
    expect(g(true, 300).w).toBe(g(true).w + LINE.gap + 300);
    expect(g(true, 300).handle).toMatchObject({ w: g(true, 300).w });
  });
  it('the trailing slot widens the notch by its measured width and its rule, and only when filled', () => {
    expect(filetWidth([], true, { line: 30, trailing: 0 })).toBe(filetWidth([], true, { line: 30 }));
    expect(filetWidth([], true, { line: 30, trailing: 40 })).toBe(filetWidth([], true, { line: 30 }) + FILET.sep + 40);
    expect(islandWidth(0, true, 0, { line: 300, trailing: 40 })).toBe(islandWidth(0, true, 0, { line: 300 }) + 2 * ISLAND.sepGap + SIZES.separatorH + 40);
    for (const awake of [false, true]) {
      const g = (trailing?: number) => layout({ bots: bots(2), mode: 'handle', awake, line: 120, trailing, screenH: H, screenW: W });
      const rule = awake ? 2 * ISLAND.sepGap + SIZES.separatorH : FILET.sep;
      expect(g(40).w).toBe(g().w + rule + 40);
      expect(g(0).w).toBe(g().w);
      // The hot zone and the window follow the handle: centred on the axis, as wide as the notch.
      expect(g(40).handle).toEqual({ left: Math.round(W / 2 - g(40).w / 2), w: g(40).w, h: g().h });
    }
    const s = scaledLayout({ bots: bots(2), mode: 'list', line: 120, trailing: 40, screenH: H, screenW: W }, { handle: 2, panel: 1 });
    expect(s.handle.w).toBe(2 * filetWidth([], false, { line: 120, trailing: 40 }));
  });
  it('the discreet flag does not change the filet; a bubble still opens at 440', () => {
    expect(stripWidth(0)).toBe(islandWidth(0));
    const s = layout({ bots: bots(3), mode: 'handle', screenH: H, screenW: W, strip: true });
    expect(s).toMatchObject({ top: 0, h: 10, w: filetWidth([]) });
    const b = layout({ bots: bots(3), mode: 'bubble', screenH: H, screenW: W, strip: true });
    expect(b).toMatchObject({ w: SIZES.bubbleW, h: SIZES.bubbleH });
    expect(layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W, strip: true }).w).toBe(SIZES.listW);
  });
  it('every view hangs from the top edge, centred on the axis, at its own width', () => {
    const list = layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W });
    expect(list).toMatchObject({ top: 0, w: SIZES.listW, left: (W - SIZES.listW) / 2 });
    expect(list.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + SIZES.footerH + SURFACE_CHROME_Y);
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500 })).toMatchObject({ top: 0, w: 480, h: 500, left: (W - 480) / 2 });
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500, reading: true }).w).toBe(1152); // 60% of W
    expect(layout({ bots: bots(2), mode: 'launch', screenH: H, screenW: W })).toMatchObject({ w: SIZES.listW, h: SIZES.launchH });
    expect(layout({ bots: bots(2), mode: 'launch', screenH: H, screenW: W, detailH: 700 }).h).toBe(700);
    expect(layout({ bots: [], mode: 'chat', screenH: 1000, screenW: W, detailH: 500 })).toMatchObject({ w: SIZES.sessionW, h: 500 });
    expect(layout({ bots: [], mode: 'chat', screenH: 1000, screenW: W }).h).toBe(SIZES.chatH);
    expect(layout({ bots: [], mode: 'list', screenH: H, screenW: W }).h).toBe(SIZES.headerH + SIZES.emptyH + SIZES.footerH + SURFACE_CHROME_Y);
  });
  it('heights are capped at the work area minus the bottom margin', () => {
    expect(layout({ bots: bots(30), mode: 'list', screenH: 600, screenW: W }).h).toBe(600 - SIZES.margin);
    expect(layout({ bots: bots(0), mode: 'launch', screenH: 300, screenW: W }).h).toBe(300 - SIZES.margin);
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
    expect(layout({ bots: [], mode: 'reader', screenH: H, screenW: 1200 })).toMatchObject({ w: 560, h: 760, top: 0 });
    expect(layout({ bots: [], mode: 'reader', screenH: 600, screenW: 1200, readerExpanded: true })).toMatchObject({ w: 800, h: 560 });
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
    expect(left.left).toBe(Math.round(W / 4 - filetWidth([]) / 2));
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
