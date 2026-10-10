export const SIZES = { handleW: 28, bubbleW: 336, bubbleH: 128, listW: 380, sessionW: 420, readingW: 560, rowH: 58, headerH: 72, footerH: 44, margin: 40, stripW: 6, stripH: 60, settingsH: 360, helpH: 420 } as const;
/** The surface's top + bottom border (border-box): added to a measured content height so nothing is clipped. */
export const SURFACE_BORDER = 1;
export const SURFACE_CHROME_Y = 2 * SURFACE_BORDER;
export type Mode = 'handle' | 'bubble' | 'list' | 'session' | 'settings' | 'help';
export interface Slot { id: string; size: number; center: number }
export interface Layout { top: number; w: number; h: number; slots: Slot[]; handle: { top: number; h: number }; hotZones: Array<{ top: number; h: number }> }

export function slotSizes(n: number): { big: number; small: number; gap: number } {
  return n > 5 ? { big: 18, small: 11, gap: 3 } : { big: 20, small: 12, gap: 5 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** `detailH` is the measured height of the settings or help view (the fixed sizes are fallbacks). `listExtraH` is the extra height of an expanded (focused) list row. `bubbleH` is the measured bubble height; `SIZES.bubbleH` is only the fallback before the first measurement. */
export interface LayoutInput { bots: Array<{ id: string; pending: boolean }>; mode: Mode; screenH: number; bubbleId?: string | null; bubbleH?: number; sessionH?: number; reading?: boolean; listExtraH?: number; detailH?: number; bubbleAnchor?: number }

/** `bubbleAnchor` is the y the bubble aligns to (its bot's center) when the handle is laid out apart; otherwise its slot. */
export function layout(input: LayoutInput): Layout {
  const { bots, mode, screenH } = input;
  const n = bots.length; const { big, small, gap } = slotSizes(n);
  const centerY = screenH / 2;
  const maxH = screenH - 2 * SIZES.margin;
  const handleH = n === 0 ? SIZES.stripH : 16 + bots.reduce((a, b) => a + (b.pending ? big : small), 0) + Math.max(0, n - 1) * gap;
  const handleTop = Math.round(centerY - handleH / 2);
  const slots: Slot[] = []; let y = handleTop + 8;
  for (const b of bots) { const size = b.pending ? big : small; slots.push({ id: b.id, size, center: y + size / 2 }); y += size + gap; }
  const hotZones = [{ top: SIZES.margin, h: Math.max(0, handleTop - 6 - SIZES.margin) }, { top: handleTop + handleH + 6, h: Math.max(0, screenH - SIZES.margin - (handleTop + handleH + 6)) }];
  const handle = { top: handleTop, h: handleH };
  if (mode === 'handle') return { top: handleTop, w: n === 0 ? SIZES.stripW : SIZES.handleW, h: handleH, slots, handle, hotZones };
  if (mode === 'bubble') {
    const slot = slots.find(s => s.id === input.bubbleId) ?? slots[0];
    const h = Math.min(maxH, input.bubbleH ?? SIZES.bubbleH);
    const top = clamp(Math.round((input.bubbleAnchor ?? slot?.center ?? centerY) - 38), SIZES.margin, screenH - SIZES.margin - h);
    return { top, w: SIZES.bubbleW, h, slots, handle, hotZones };
  }
  if (mode === 'settings' || mode === 'help') {
    const h = Math.min(maxH, input.detailH ?? (mode === 'settings' ? SIZES.settingsH : SIZES.helpH));
    return { top: clamp(Math.round(centerY - h / 2), SIZES.margin, screenH - SIZES.margin - h), w: SIZES.listW, h, slots, handle, hotZones };
  }
  const h = Math.min(maxH, mode === 'list' ? SIZES.headerH + 16 + n * SIZES.rowH + (input.listExtraH ?? 0) + SIZES.footerH + SURFACE_CHROME_Y : (input.sessionH ?? 480));
  const top = clamp(Math.round(centerY - h / 2), SIZES.margin, screenH - SIZES.margin - h);
  const w = mode === 'list' ? SIZES.listW : (input.reading ? SIZES.readingW : SIZES.sessionW);
  return { top, w, h, slots, handle, hotZones };
}

/**
 * The layout under the two UI scales, in real (logical) px. The handle (its slots, bands and the handle-mode surface)
 * is laid out in a screen of `screenH / handle` units and multiplied by `handle`; the opened views in a screen of
 * `screenH / panel` units multiplied by `panel`. Heights in the input (measured or not) are base content heights plus the surface's border (`SURFACE_CHROME_Y`).
 */
export function scaledLayout(input: LayoutInput, scales: { handle: number; panel: number }): Layout {
  const hs = scales.handle, ps = scales.panel;
  const hl = layout({ ...input, mode: 'handle', screenH: input.screenH / hs });
  const slots = hl.slots.map(s => ({ id: s.id, size: s.size * hs, center: s.center * hs }));
  const handle = { top: hl.handle.top * hs, h: hl.handle.h * hs };
  const hotZones = hl.hotZones.map(z => ({ top: z.top * hs, h: z.h * hs }));
  if (input.mode === 'handle') return { top: hl.top * hs, w: hl.w * hs, h: hl.h * hs, slots, handle, hotZones };
  const anchor = input.mode === 'bubble' ? (slots.find(s => s.id === input.bubbleId) ?? slots[0])?.center : undefined;
  const pl = layout({ ...input, screenH: input.screenH / ps, bubbleAnchor: anchor === undefined ? undefined : anchor / ps });
  // The surface's border is 1 real px whatever the scale: only the content inside it is zoomed.
  return { top: pl.top * ps, w: pl.w * ps, h: (pl.h - SURFACE_CHROME_Y) * ps + SURFACE_CHROME_Y, slots, handle, hotZones };
}
