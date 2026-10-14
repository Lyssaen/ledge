export interface TableSize { stageW: number; stageH: number; tableW: number; tableH: number }
/** The mockup's sizes per seat count (app.js:62); past six the furniture keeps growing per seat. */
const SIZES: Record<number, [number, number, number, number]> = { 1: [260, 240, 160, 86], 2: [380, 300, 230, 90], 3: [440, 320, 280, 100], 4: [500, 340, 330, 116], 5: [560, 360, 360, 126], 6: [620, 380, 400, 140] };
export function tableSize(count: number): TableSize {
  const fixed = SIZES[Math.max(1, count)];
  if (fixed) { const [stageW, stageH, tableW, tableH] = fixed; return { stageW, stageH, tableW, tableH }; }
  const n = count - 6;
  return { stageW: 620 + n * 40, stageH: 380 + n * 24, tableW: 400 + n * 30, tableH: 140 + n * 16 };
}
/** Seat positions in percent of the stage, the mockup's for 1..8 (app.js:51-58); beyond, evenly around an ellipse (app.js:67). */
const POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 22]], 2: [[30, 16], [70, 84]], 3: [[27, 16], [73, 16], [50, 84]],
  4: [[27, 16], [73, 16], [73, 84], [27, 84]],
  5: [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84]],
  6: [[27, 16], [73, 16], [91, 50], [73, 84], [27, 84], [9, 50]],
  7: [[20, 16], [50, 16], [80, 16], [91, 50], [73, 84], [27, 84], [9, 50]],
  8: [[20, 16], [50, 16], [80, 16], [91, 50], [80, 84], [50, 84], [20, 84], [9, 50]]
};
export function seatPositions(count: number): { x: number; y: number }[] {
  const fixed = POSITIONS[count];
  if (fixed) return fixed.map(([x, y]) => ({ x, y }));
  return Array.from({ length: count }, (_, i) => ({ x: 50 + 42 * Math.cos((2 * Math.PI * i) / count), y: 50 + 36 * Math.sin((2 * Math.PI * i) / count) }));
}
