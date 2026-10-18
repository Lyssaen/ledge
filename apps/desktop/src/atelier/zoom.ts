export const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5, FIT_MAX = 1.8, FIT_MIN = 0.4, FIT_STEP = 0.02, FRAME_MAX = 2.2;
export const FLOOR_MARGIN = 56, TILE_GAP = 12, LEDGE_TILE = 230, ZONE_TILE = 420;

/** Width of the widest row when aiming at `rows` rows (the mockup's first useLayoutEffect). */
export function widestRow(widths: readonly number[], rows: number): number {
  const total = widths.reduce((a, b) => a + b + TILE_GAP, 0);
  const target = total / rows;
  let row = 0, widest = 0;
  for (const w of widths) {
    if (row > 0 && row + w > target * 1.12) { widest = Math.max(widest, row); row = 0; }
    row += w + TILE_GAP;
  }
  return Math.max(widest, row);
}
export const fitCeiling = (viewportWidth: number, widest: number): number => Math.min(FIT_MAX, (viewportWidth - 8) / (widest + 2 * FLOOR_MARGIN + 16));
export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export const stepZoom = (z: number, dir: 1 | -1): number => clampZoom(dir > 0 ? z * 1.2 : z / 1.2);
export const wheelZoom = (z: number, deltaY: number): number => clampZoom(z * Math.exp(-deltaY * 0.0022));

export function zoomAround(from: { zoom: number; left: number; top: number }, zoom: number, at: { x: number; y: number }): { left: number; top: number } {
  const px = (from.left + at.x) / from.zoom, py = (from.top + at.y) / from.zoom;
  return { left: px * zoom - at.x, top: py * zoom - at.y };
}

/** The content point (in unzoomed pixels) at the centre of a view scrolled to `left`, `top` at `zoom`. */
export const centreOf = (at: { zoom: number; left: number; top: number }, view: { width: number; height: number }): { x: number; y: number } =>
  ({ x: (at.left + view.width / 2) / at.zoom, y: (at.top + view.height / 2) / at.zoom });

/** The scroll that brings `point` back to the centre of the view at `zoom`, clamped to the content's scrollable range. */
export function centreOn(point: { x: number; y: number }, zoom: number, view: { width: number; height: number }, content: { width: number; height: number }): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, Math.max(0, max)));
  return { left: clamp(point.x * zoom - view.width / 2, content.width - view.width), top: clamp(point.y * zoom - view.height / 2, content.height - view.height) };
}

export function frameZoom(box: { x: number; y: number; w: number; h: number }, view: { width: number; height: number }): { zoom: number; left: number; top: number } {
  const zoom = Math.min(FRAME_MAX, Math.max(ZOOM_MIN, Math.min(view.width * 0.92 / box.w, view.height * 0.92 / box.h)));
  return { zoom, left: (box.x + box.w / 2) * zoom - view.width / 2, top: (box.y + box.h / 2) * zoom - view.height / 2 };
}
