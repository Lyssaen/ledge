export const SIZES = { handleW: 28, bubbleW: 336, bubbleH: 128, listW: 380, sessionW: 420, readingW: 560, rowH: 58, headerH: 56, footerH: 48, margin: 40, stripW: 6, stripH: 60 } as const;
export type Mode = 'handle' | 'bubble' | 'list' | 'session';
export interface Slot { id: string; size: number; center: number }
export interface Layout { top: number; w: number; h: number; slots: Slot[]; handle: { top: number; h: number }; hotZones: Array<{ top: number; h: number }> }

export function slotSizes(n: number): { big: number; small: number; gap: number } {
  return n > 5 ? { big: 18, small: 11, gap: 3 } : { big: 20, small: 12, gap: 5 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** `bubbleH` is the measured bubble height; `SIZES.bubbleH` is only the fallback before the first measurement. */
export function layout(input: { bots: Array<{ id: string; pending: boolean }>; mode: Mode; screenH: number; bubbleId?: string | null; bubbleH?: number; sessionH?: number; reading?: boolean }): Layout {
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
    const top = clamp(Math.round((slot?.center ?? centerY) - 38), SIZES.margin, screenH - SIZES.margin - h);
    return { top, w: SIZES.bubbleW, h, slots, handle, hotZones };
  }
  const h = Math.min(maxH, mode === 'list' ? SIZES.headerH + 16 + n * SIZES.rowH + SIZES.footerH : (input.sessionH ?? 480));
  const top = clamp(Math.round(centerY - h / 2), SIZES.margin, screenH - SIZES.margin - h);
  const w = mode === 'list' ? SIZES.listW : (input.reading ? SIZES.readingW : SIZES.sessionW);
  return { top, w, h, slots, handle, hotZones };
}
