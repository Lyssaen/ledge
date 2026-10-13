import { describe, it, expect } from 'vitest';
import { layout, scaledLayout, islandWidth, stripWidth, islandOrder, ISLAND, SIZES, SURFACE_CHROME_Y } from '../src/surface/geometry';
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
    const l = layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W });
    expect(l).toMatchObject({ top: 0, w: islandWidth(2), h: ISLAND.h });
    expect(l.left).toBe(Math.round(W / 2 - islandWidth(2) / 2));
    expect(l.handle).toEqual({ left: l.left, w: l.w, h: ISLAND.h });
  });
  it('slots run left to right after the separator, asks first, six at most', () => {
    const l = layout({ bots: bots(8, [6]), mode: 'handle', screenH: H, screenW: W });
    expect(islandOrder(bots(8, [6])).map(b => b.id)).toEqual(['6', '0', '1', '2', '3', '4', '5', '7']);
    expect(l.slots.map(s => s.id)).toEqual(['6', '0', '1', '2', '3', '4']);
    const first = l.left + 12 + 22 + 8 + 1 + 8;
    expect(l.slots[0]).toEqual({ id: '6', size: 22, center: first + 11 });
    expect(l.slots[1]!.center).toBe(first + 22 + 8 + 11);
  });
  it('no sessions: the mascot alone, no separator room', () => {
    expect(layout({ bots: [], mode: 'handle', screenH: H, screenW: W })).toMatchObject({ w: 48, h: 38, slots: [] });
  });
  it('the discreet strip: 10 px high, dots 6 x 4 spaced 4, only in handle mode', () => {
    expect(stripWidth(0)).toBe(islandWidth(0));
    expect(stripWidth(3)).toBe(Math.max(48, 10 + 3 * 6 + 2 * 4 + 10));
    expect(stripWidth(9)).toBe(Math.max(48, 10 + 6 * 6 + 5 * 4 + 10));
    const s = layout({ bots: bots(3), mode: 'handle', screenH: H, screenW: W, strip: true });
    expect(s).toMatchObject({ top: 0, h: ISLAND.stripH, w: stripWidth(3) });
    expect(s.handle.h).toBe(ISLAND.stripH);
    const b = layout({ bots: bots(3), mode: 'bubble', screenH: H, screenW: W, strip: true });
    expect(b).toMatchObject({ w: SIZES.bubbleW, h: SIZES.bubbleH });
    expect(layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W, strip: true }).w).toBe(SIZES.listW);
  });
  it('every view hangs from the top edge, centred on the axis, at its own width', () => {
    const list = layout({ bots: bots(3), mode: 'list', screenH: H, screenW: W });
    expect(list).toMatchObject({ top: 0, w: SIZES.listW, left: (W - SIZES.listW) / 2 });
    expect(list.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + SIZES.footerH + SURFACE_CHROME_Y);
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500 })).toMatchObject({ top: 0, w: 480, h: 500, left: (W - 480) / 2 });
    expect(layout({ bots: bots(2), mode: 'session', screenH: H, screenW: W, sessionH: 500, reading: true }).w).toBe(SIZES.readingW);
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
  it('the island position moves the axis to a quarter of the screen, clamped inside it', () => {
    const left = layout({ bots: bots(2), mode: 'handle', screenH: H, screenW: W, position: 'left' });
    expect(left.left).toBe(Math.round(W / 4 - islandWidth(2) / 2));
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
    expect(h2.handle).toEqual({ left: h1.left * 2, w: h1.w * 2, h: 76 });
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
