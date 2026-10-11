import { describe, it, expect } from 'vitest';
import { layout, scaledLayout, slotSizes, SIZES, SURFACE_CHROME_Y } from '../src/surface/geometry';
import { frameOf } from '../src/surface/frame';
const bots = (n: number, pending: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: String(i), pending: pending.includes(i) }));

describe('geometry', () => {
  it('sizes the reader at 560 or 800 and keeps its native frame within a narrow work area', () => {
    const base = layout({ bots: [], mode: 'reader', screenH: 1080, screenW: 1200 });
    expect(base).toMatchObject({ w: 560, h: 760 });
    expect(layout({ bots: [], mode: 'reader', screenH: 600, screenW: 1200, readerExpanded: true })).toMatchObject({ w: 800, h: 520 });
    for (const panel of [1, 1.5, 2]) {
      const g = scaledLayout({ bots: [], mode: 'reader', screenH: 900, screenW: 700, readerExpanded: true }, { handle: 1, panel });
      expect(frameOf(g, [], 900).w).toBeLessThanOrEqual(700);
    }
  });
  it('uses 20/12/5 up to five bots and 18/11/3 after', () => {
    expect(slotSizes(5)).toEqual({ big: 20, small: 12, gap: 5 });
    expect(slotSizes(6)).toEqual({ big: 18, small: 11, gap: 3 });
  });
  it('centres the handle and sizes it to the team', () => {
    const l = layout({ bots: bots(5, [0, 1]), mode: 'handle', screenH: 1080 });
    expect(l.w).toBe(SIZES.handleW);
    expect(l.h).toBe(16 + SIZES.residentH + 5 + SIZES.separatorH + 5 + 20 + 20 + 12 + 12 + 12 + 4 * 5);
    expect(l.top).toBe(Math.round(540 - l.h / 2));
    expect(l.slots[0]!.center).toBe(l.top + 8 + SIZES.residentH + 5 + SIZES.separatorH + 5 + 10);
    expect(l.slots[2]!.size).toBe(12);
  });
  it('a bubble sits at the asking bot slot, clamped to the margins', () => {
    const l = layout({ bots: bots(5, [4]), mode: 'bubble', screenH: 1080, bubbleId: '4' });
    const h = layout({ bots: bots(5, [4]), mode: 'handle', screenH: 1080 });
    expect(l.w).toBe(SIZES.bubbleW); expect(l.h).toBe(SIZES.bubbleH);
    expect(l.top).toBe(h.slots[4]!.center - 38);
    const edge = layout({ bots: bots(10, [0]), mode: 'bubble', screenH: 300, bubbleId: '0' });
    expect(edge.top).toBeGreaterThanOrEqual(SIZES.margin);
  });
  it('the launch form is a detail view at the list width, measured or at its fallback height', () => {
    const l = layout({ bots: bots(2), mode: 'launch', screenH: 1080 });
    expect(l.w).toBe(SIZES.listW); expect(l.h).toBe(SIZES.launchH);
    expect(layout({ bots: bots(2), mode: 'launch', screenH: 1080, detailH: 700 }).h).toBe(700);
    expect(layout({ bots: bots(0), mode: 'launch', screenH: 500 }).h).toBe(500 - 2 * SIZES.margin);
  });
  it('an empty list holds the empty state instead of rows', () => {
    const l = layout({ bots: bots(0), mode: 'list', screenH: 1080 });
    expect(l.h).toBe(SIZES.headerH + SIZES.emptyH + SIZES.footerH + SURFACE_CHROME_Y);
    expect(l.w).toBe(SIZES.listW);
  });
  it('the list grows with the rows and never exceeds the screen minus margins', () => {
    const l = layout({ bots: bots(3), mode: 'list', screenH: 1080 });
    expect(l.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + SIZES.footerH + SURFACE_CHROME_Y);
    const big = layout({ bots: bots(10, [0, 4, 8]), mode: 'list', screenH: 600 });
    expect(big.h).toBe(600 - 2 * SIZES.margin);
    expect(big.top).toBe(SIZES.margin);
  });
  it('hot zones cover the edge above and below the handle with a 6px gap', () => {
    const l = layout({ bots: bots(5), mode: 'handle', screenH: 1080 });
    expect(l.hotZones[0]).toEqual({ top: SIZES.margin, h: l.handle.top - 6 - SIZES.margin });
    expect(l.hotZones[1]!.top).toBe(l.handle.top + l.handle.h + 6);
  });
  it('an empty team still has a visible mascot in the full-width notch', () => {
    const l = layout({ bots: [], mode: 'handle', screenH: 1080 });
    expect(l).toMatchObject({ w: 28, h: 36 });
  });
  it('reading mode widens the session past its 480 px page', () => {
    expect(layout({ bots: bots(2), mode: 'session', screenH: 1080, sessionH: 500 }).w).toBe(480);
    expect(layout({ bots: bots(2), mode: 'session', screenH: 1080, sessionH: 500, reading: true }).w).toBe(SIZES.readingW);
  });
  it('an expanded focused row adds its extra height to the list, still clamped', () => {
    const base = layout({ bots: bots(3), mode: 'list', screenH: 1080 }).h;
    expect(layout({ bots: bots(3), mode: 'list', screenH: 1080, listExtraH: 42 }).h).toBe(base + 42);
    expect(layout({ bots: bots(30), mode: 'list', screenH: 1080, listExtraH: 42 }).h).toBe(1080 - 2 * SIZES.margin);
  });
  it('scaled layout: the handle and its bands follow the handle scale, the opened views the window scale, independently', () => {
    const input = { bots: bots(2, [1]), screenH: 2160 };
    const h1 = layout({ ...input, mode: 'handle', screenH: 1080 });
    const h2 = scaledLayout({ ...input, mode: 'handle' }, { handle: 2, panel: 1 });
    expect(h2).toMatchObject({ top: h1.top * 2, w: h1.w * 2, h: h1.h * 2 });
    expect(h2.hotZones).toEqual(h1.hotZones.map(z => ({ top: z.top * 2, h: z.h * 2 })));
    expect(h2.slots.map(s => s.center)).toEqual(h1.slots.map(s => s.center * 2));
    // The list at 100 % on the same screen: base width, centered on the real 2160 px; the handle data is unchanged.
    const l = scaledLayout({ ...input, mode: 'list' }, { handle: 2, panel: 1 });
    expect(l.w).toBe(SIZES.listW);
    expect(l.top + l.h / 2).toBeCloseTo(1080, 0);
    expect(l.hotZones).toEqual(h2.hotZones);
    // Windows at 150 %: content scaled, the 1 px border kept.
    const base = layout({ ...input, mode: 'list', screenH: 2160 / 1.5 });
    const l15 = scaledLayout({ ...input, mode: 'list' }, { handle: 2, panel: 1.5 });
    expect(l15.w).toBe(SIZES.listW * 1.5);
    expect(l15.h).toBe((base.h - SURFACE_CHROME_Y) * 1.5 + SURFACE_CHROME_Y);
    // The bubble still aligns to its bot's real center.
    const b = scaledLayout({ ...input, mode: 'bubble', bubbleId: '1', bubbleH: 120 }, { handle: 2, panel: 1 });
    expect(b.top).toBe(Math.round(h2.slots[1]!.center - 38));
  });
  it('adds a header height per group to the list', () => {
    const bots = [{ id: 'a', pending: false }, { id: 'b', pending: false }];
    const one = layout({ bots, mode: 'list', screenH: 1000, groups: 1 });
    const two = layout({ bots, mode: 'list', screenH: 1000, groups: 2 });
    expect(two.h - one.h).toBe(SIZES.groupH);
  });
  it('the first slot sits under the resident, a gap, the separator and a gap', () => {
    const l = layout({ bots: [{ id: 'a', pending: false }], mode: 'handle', screenH: 1000 });
    const { small, gap } = slotSizes(1);
    expect(l.slots[0]!.center).toBe(l.handle.top + 8 + SIZES.residentH + gap + SIZES.separatorH + gap + small / 2);
    expect(l.handle.h).toBe(16 + SIZES.residentH + gap + SIZES.separatorH + gap + small);
  });

  it('sizes the chat like a session, by its measured height', () => {
    const l = layout({ bots: [], mode: 'chat', screenH: 1000, detailH: 500 });
    expect(l.w).toBe(SIZES.sessionW); expect(l.h).toBe(500);
    expect(layout({ bots: [], mode: 'chat', screenH: 1000 }).h).toBe(SIZES.chatH);
  });
  it('a Ledge finish bubble sits at the resident, not the first bot', () => {
    const h = layout({ bots: bots(3, [0]), mode: 'handle', screenH: 1080 });
    const l = layout({ bots: bots(3, [0]), mode: 'bubble', screenH: 1080, bubbleId: 'ledge' });
    const resident = h.handle.top + 8 + SIZES.residentH / 2;
    expect(l.top).toBe(Math.round(resident - 38));
    expect(l.top).not.toBe(h.slots[0]!.center - 38);
  });
});
