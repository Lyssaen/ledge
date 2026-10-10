import { describe, it, expect } from 'vitest';
import { layout, slotSizes, SIZES } from '../src/surface/geometry';
const bots = (n: number, pending: number[] = []) => Array.from({ length: n }, (_, i) => ({ id: String(i), pending: pending.includes(i) }));

describe('geometry', () => {
  it('uses 20/12/5 up to five bots and 18/11/3 after', () => {
    expect(slotSizes(5)).toEqual({ big: 20, small: 12, gap: 5 });
    expect(slotSizes(6)).toEqual({ big: 18, small: 11, gap: 3 });
  });
  it('centres the handle and sizes it to the team', () => {
    const l = layout({ bots: bots(5, [0, 1]), mode: 'handle', screenH: 1080 });
    expect(l.w).toBe(SIZES.handleW);
    expect(l.h).toBe(16 + 20 + 20 + 12 + 12 + 12 + 4 * 5);
    expect(l.top).toBe(Math.round(540 - l.h / 2));
    expect(l.slots[0]!.center).toBe(l.top + 8 + 10);
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
  it('the list grows with the rows and never exceeds the screen minus margins', () => {
    const l = layout({ bots: bots(3), mode: 'list', screenH: 1080 });
    expect(l.h).toBe(SIZES.headerH + 16 + 3 * SIZES.rowH + 48);
    const big = layout({ bots: bots(10, [0, 4, 8]), mode: 'list', screenH: 600 });
    expect(big.h).toBe(600 - 2 * SIZES.margin);
    expect(big.top).toBe(SIZES.margin);
  });
  it('hot zones cover the edge above and below the handle with a 6px gap', () => {
    const l = layout({ bots: bots(5), mode: 'handle', screenH: 1080 });
    expect(l.hotZones[0]).toEqual({ top: SIZES.margin, h: l.handle.top - 6 - SIZES.margin });
    expect(l.hotZones[1]!.top).toBe(l.handle.top + l.handle.h + 6);
  });
  it('an empty team gives a 6px strip 60px tall', () => {
    const l = layout({ bots: [], mode: 'handle', screenH: 1080 });
    expect(l).toMatchObject({ w: 6, h: 60 });
  });
  it('reading mode widens the session', () => {
    expect(layout({ bots: bots(2), mode: 'session', screenH: 1080, sessionH: 500, reading: true }).w).toBe(SIZES.readingW);
  });
  it('an expanded focused row adds its extra height to the list, still clamped', () => {
    const base = layout({ bots: bots(3), mode: 'list', screenH: 1080 }).h;
    expect(layout({ bots: bots(3), mode: 'list', screenH: 1080, listExtraH: 42 }).h).toBe(base + 42);
    expect(layout({ bots: bots(30), mode: 'list', screenH: 1080, listExtraH: 42 }).h).toBe(1080 - 2 * SIZES.margin);
  });
});
