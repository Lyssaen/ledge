import { describe, it, expect } from 'vitest';
import { seatPositions, tableSize } from '../src/room/geometry';
describe('table geometry', () => {
  it('follows the mockup table for one to six seats', () => {
    expect(tableSize(1)).toEqual({ stageW: 260, stageH: 240, tableW: 160, tableH: 86 });
    expect(tableSize(6)).toEqual({ stageW: 620, stageH: 380, tableW: 400, tableH: 140 });
  });
  it.each([[2, 380, 300, 230, 90], [3, 440, 320, 280, 100], [4, 500, 340, 330, 116], [5, 560, 360, 360, 126]])('sizes %i seats as the mockup does', (n, stageW, stageH, tableW, tableH) => { expect(tableSize(n)).toEqual({ stageW, stageH, tableW, tableH }); });
  it.each([
    [2, [[30, 16], [70, 84]]], [3, [[27, 16], [73, 16], [50, 84]]], [4, [[27, 16], [73, 16], [73, 84], [27, 84]]],
    [5, [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84]]], [6, [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84], [9, 50]]],
    [7, [[20, 16], [50, 16], [80, 16], [91, 50], [73, 84], [27, 84], [9, 50]]]
  ] as [number, [number, number][]][])('places %i seats as the mockup does', (n, pts) => { expect(seatPositions(n)).toEqual(pts.map(([x, y]) => ({ x, y }))); });
  it('grows past six as the mockup does', () => { expect(tableSize(8)).toEqual({ stageW: 700, stageH: 428, tableW: 460, tableH: 172 }); });
  it('uses the mockup seats for eight', () => { expect(seatPositions(8)[3]).toEqual({ x: 91, y: 50 }); expect(seatPositions(1)).toEqual([{ x: 50, y: 22 }]); });
  it('gives one seat per participant, inside the stage', () => {
    for (const n of [1, 2, 5, 8, 12]) { const p = seatPositions(n); expect(p).toHaveLength(n); for (const { x, y } of p) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(100); } }
  });
});
