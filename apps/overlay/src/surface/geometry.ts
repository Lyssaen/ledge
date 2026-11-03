/** The share of the work area's height an open view may take (the closed notch is not concerned). */
export const OPEN_MAX_SHARE = 0.5;
/** The tallest an open view may be on a work area `screenH` high (in the same units). */
export const openMaxH = (screenH: number) => Math.min(screenH - SIZES.margin, Math.floor(screenH * OPEN_MAX_SHARE));
export const SIZES = { bubbleW: 440, bubbleH: 128, listW: 380, sessionW: 480, readingW: 800, readerW: 560, readerExpandedW: 800, expandedMaxW: 1200, readerH: 760, rowH: 58, headerH: 72, footerH: 44, margin: 40, settingsH: 360, helpH: 420, launchH: 600, chatH: 560, emptyH: 200, groupH: 28, separatorH: 1 } as const;
/** The compact island, a row along the top edge (spec 2026-10-12 §3): margins, the Ledge mascot, the separator, the
 *  companions, the "+n" pill past six, the DND moon; and the discreet strip with one dot per session. */
export const ISLAND = { h: 38, padL: 12, padR: 14, resident: 22, sepGap: 8, companion: 22, gap: 8, max: 6, pill: 30, moon: 12, stripH: 10, stripPad: 10, dotW: 6, dotH: 4, dotGap: 4 } as const;
/** The resting notch (the validated filet): 10 px, Ledge's rectangle, a hairline before each machine, one dash per session. */
export const FILET = { h: 10, pad: 6, ledge: 9, sep: 7, dash: 5, gap: 2, pip: 5 } as const;
/** The surface's top + bottom border (border-box): added to a measured content height so nothing is clipped. None:
 *  the notch is borderless so it merges with the screen edge. */
export const SURFACE_BORDER = 0;
export const SURFACE_CHROME_Y = 2 * SURFACE_BORDER;
export type Mode = 'handle' | 'bubble' | 'peek' | 'list' | 'session' | 'helper' | 'settings' | 'help' | 'launch' | 'chat' | 'reader';
/** Where the island's axis sits on the top edge: the centre, or a quarter of the width from the left or the right. */
export type IslandPosition = 'center' | 'left' | 'right';
/** The resident's finished-chat notice: not a session id. */
export const LEDGE_ID = 'ledge';
/** The detail views that share the list's width and the DetailHeader: settings, help and the launch form. */
export const DETAIL_VIEWS: readonly Mode[] = ['settings', 'help', 'launch'];
const DETAIL_FALLBACK_H: Record<'settings' | 'help' | 'launch', number> = { settings: SIZES.settingsH, help: SIZES.helpH, launch: SIZES.launchH };
/** A companion's place in the island: `center` is its x on screen (real px). */
export interface Slot { id: string; size: number; center: number }
export interface Layout { left: number; top: number; w: number; h: number; slots: Slot[]; handle: { left: number; w: number; h: number } }

/** The closed notch's pieces (mockup docs/mockups/ledge-notch-activity.html): Ledge alone, the activity line, the music. */
export const NOTCH = { lineGap: 10, lineMax: 420, lineMaxOpen: 220, moonGap: 6, sepL: 12, sepR: 10, cover: 24, titles: 168, titlesGap: 8, ctl: 28, ctlGap: 2, max: 640, eq: 5, filetGap: 4 } as const;

/** What the closed notch draws, for its width before (or without) a measurement. `line` is the line's estimated width. */
export interface NotchContent { pip?: boolean; playing?: boolean; music?: boolean; musicOpen?: boolean; dnd?: boolean; line?: number }

/** The resting filet: Ledge's mark, then the update dash and the music bars, 4 px apart. */
export function filetWidth(c: NotchContent = {}): number {
  return FILET.pad * 2 + FILET.ledge + (c.pip ? NOTCH.filetGap + FILET.pip : 0) + (c.playing ? NOTCH.filetGap + NOTCH.eq : 0);
}

/** The awake notch: Ledge, the DND moon, the line (420 px at most, 220 while the music controls are open), the music. */
export function awakeWidth(c: NotchContent = {}): number {
  const line = c.line ? NOTCH.lineGap + Math.min(c.line, c.musicOpen ? NOTCH.lineMaxOpen : NOTCH.lineMax) : 0;
  const music = c.music ? NOTCH.sepL + SIZES.separatorH + NOTCH.sepR + NOTCH.cover + (c.musicOpen ? 2 * NOTCH.titlesGap + NOTCH.titles + 3 * NOTCH.ctl + 2 * NOTCH.ctlGap : 0) : 0;
  return Math.min(NOTCH.max, ISLAND.padL + ISLAND.resident + (c.dnd ? NOTCH.moonGap + ISLAND.moon : 0) + line + music + ISLAND.padL);
}

export const islandAxis = (screenW: number, position: IslandPosition = 'center'): number =>
  position === 'left' ? screenW / 4 : position === 'right' ? (3 * screenW) / 4 : screenW / 2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** An enlarged view (reading mode, expanded reader) takes 60% of the screen width, never less than `min` nor more than `expandedMaxW`. */
export const expandedWidth = (screenW: number, min: number) => clamp(Math.round(screenW * 0.6), min, SIZES.expandedMaxW);

/** `detailH` is the measured height of the settings or help view (the fixed sizes are fallbacks). `listExtraH` is the extra height of the list: an expanded (focused) row, the notice, the update card. `bubbleH` is the measured bubble height; `SIZES.bubbleH` is only the fallback before the first measurement. `strip` draws the discreet strip instead of the compact island (handle mode only). */
export interface LayoutInput { bots: Array<{ id: string; pending: boolean; machine?: string }>; /** The closed notch's measured width (base px); absent or 0: estimated from `notch`. */ handleW?: number; notch?: NotchContent; mode: Mode; screenH: number; screenW: number; position?: IslandPosition; strip?: boolean; /** The update dash on the resting notch. */ pip?: boolean; /** The pointer is over the notch: the compact island instead of the filet (handle mode). */ awake?: boolean; dnd?: boolean; readerExpanded?: boolean; bubbleH?: number; sessionH?: number; /** Measured height of the open helper view. */ helperH?: number; reading?: boolean; listExtraH?: number; groups?: number; detailH?: number; /** Extra height of the ask field above the list rows (`ASK_H`). */ askH?: number }

/** Everything hangs from the top edge of the work area, centred on the island's axis; `left` is clamped into the screen. */
export function layout(input: LayoutInput): Layout {
  const { bots, mode, screenH, screenW } = input;
  const n = bots.length;
  // An open view never takes more than half the work area's height (user's rule, 2026-11-02): past it, its content scrolls.
  const maxH = openMaxH(screenH);
  const axis = islandAxis(screenW, input.position);
  const place = (w: number) => clamp(Math.round(axis - w / 2), 0, Math.max(0, screenW - w));
  // At rest the notch is the filet; awake it is Ledge, the line and the music, as wide as they are (measured).
  const filet = mode === 'handle' && !input.awake;
  const handleW = input.handleW || (filet ? filetWidth({ ...input.notch, pip: input.pip }) : awakeWidth({ ...input.notch, dnd: input.dnd }));
  const handle = { left: place(handleW), w: handleW, h: filet ? FILET.h : ISLAND.h };
  const slots: Slot[] = [];
  const view = (w: number, h: number): Layout => ({ left: place(w), top: 0, w, h: Math.min(maxH, h), slots, handle });
  if (mode === 'handle') return { left: handle.left, top: 0, w: handleW, h: handle.h, slots, handle };
  if (mode === 'bubble') return view(SIZES.bubbleW, input.bubbleH ?? SIZES.bubbleH);
  if (mode === 'peek') return view(360, input.bubbleH ?? 160);
  // The native frame adds a small shadow outside this width.
  if (mode === 'reader') return view(Math.min(input.readerExpanded ? expandedWidth(screenW, SIZES.readerExpandedW) : SIZES.readerW, Math.max(0, screenW - 24)), SIZES.readerH);
  if (mode === 'chat') return view(SIZES.sessionW, input.detailH ?? SIZES.chatH);
  if (mode === 'settings' || mode === 'help' || mode === 'launch') return view(SIZES.listW, input.detailH ?? DETAIL_FALLBACK_H[mode]);
  // An empty list shows the empty state (a bot, two lines, a button) instead of rows; the extras (the update card,
  // the notice) still grow it.
  const rowsH = (n === 0 ? SIZES.emptyH : 16 + n * SIZES.rowH + (input.groups ?? 0) * SIZES.groupH) + (input.listExtraH ?? 0);
  if (mode === 'list') return view(SIZES.listW, SIZES.headerH + rowsH + (input.askH ?? 0) + SIZES.footerH + SURFACE_CHROME_Y);
  if (mode === 'helper') return view(SIZES.sessionW, input.helperH ?? 480);
  return view(input.reading ? Math.min(expandedWidth(screenW, SIZES.readingW), Math.max(SIZES.sessionW, screenW - 24)) : SIZES.sessionW, input.sessionH ?? 480);
}

/**
 * The layout under the two UI scales, in real (logical) px. The island (its slots and the handle-mode surface) is
 * laid out in a screen of `screenW / handle` x `screenH / handle` units and multiplied by `handle`; the opened views
 * in a screen divided by `panel`, multiplied by `panel`. Heights in the input are base content heights plus `SURFACE_CHROME_Y`.
 */
export function scaledLayout(input: LayoutInput, scales: { handle: number; panel: number }): Layout {
  const hs = scales.handle, ps = scales.panel;
  const hl = layout({ ...input, mode: 'handle', screenH: input.screenH / hs, screenW: input.screenW / hs });
  const slots = hl.slots.map(s => ({ id: s.id, size: s.size * hs, center: s.center * hs }));
  const handle = { left: hl.handle.left * hs, w: hl.handle.w * hs, h: hl.handle.h * hs };
  if (input.mode === 'handle') return { left: hl.left * hs, top: 0, w: hl.w * hs, h: hl.h * hs, slots, handle };
  const pl = layout({ ...input, screenH: input.screenH / ps, screenW: input.screenW / ps });
  // The surface's border is 1 real px whatever the scale: only the content inside it is zoomed.
  return { left: pl.left * ps, top: 0, w: pl.w * ps, h: (pl.h - SURFACE_CHROME_Y) * ps + SURFACE_CHROME_Y, slots, handle };
}
