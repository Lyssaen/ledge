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
export type Mode = 'handle' | 'bubble' | 'list' | 'session' | 'helper' | 'settings' | 'help' | 'launch' | 'chat' | 'reader';
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

/** The island groups the companions by machine (this machine first, the others in list order) and shows each
 *  machine's asks first, then its other sessions in list order (stable). One machine: asks first, then the others. */
export function islandOrder<T extends { pending: boolean; machine?: string }>(bots: T[]): T[] {
  const machines = [...new Set(['local', ...bots.map(b => b.machine ?? 'local')])];
  return machines.flatMap(m => { const own = bots.filter(b => (b.machine ?? 'local') === m); return [...own.filter(b => b.pending), ...own.filter(b => !b.pending)]; });
}

/** Whether a pipe (a separator like the one after the mascot) stands before `b`: it starts another machine's group. */
export const pipeBefore = (prev: { id: string; machine?: string } | undefined, b: { id: string; machine?: string }): boolean => !!prev && (prev.machine ?? 'local') !== (b.machine ?? 'local');

/** The pipes between the shown companions' machines (`ordered` as given by `islandOrder`). */
export const islandPipes = (ordered: Array<{ id: string; machine?: string }>): number => ordered.slice(0, ISLAND.max).filter((b, i, a) => pipeBefore(a[i - 1], b)).length;

/** The compact island's width for `n` sessions: six companions at most, then the "+n" pill; the DND moon when on;
 *  `pipes` separators between machines (`islandPipes`). */
export function islandWidth(n: number, dnd = false, pipes = 0): number {
  const moon = dnd ? ISLAND.gap + ISLAND.moon : 0;
  if (n === 0) return ISLAND.padL + ISLAND.resident + moon + ISLAND.padR;
  const shown = Math.min(n, ISLAND.max);
  return ISLAND.padL + ISLAND.resident + ISLAND.sepGap + SIZES.separatorH + ISLAND.sepGap + shown * ISLAND.companion + (shown - 1) * ISLAND.gap + pipes * (ISLAND.sepGap + SIZES.separatorH) + (n > ISLAND.max ? ISLAND.gap + ISLAND.pill : 0) + moon + ISLAND.padR;
}

/** One machine's dashes: 5 px each, 2 px between them. */
export const filetGroupWidth = (n: number) => n <= 0 ? 0 : n * FILET.dash + (n - 1) * FILET.gap;

/** The resting notch's width. `groups` is the session count of each machine, in island order. `pip` adds the update dash. */
export function filetWidth(groups: number[], pip = false): number {
  return FILET.pad * 2 + FILET.ledge + groups.reduce((w, n) => w + FILET.sep + filetGroupWidth(n), 0) + (pip ? FILET.pip : 0);
}

/** The machines of an `islandOrder` list, each kept together. */
export function machineGroups<T extends { machine?: string }>(ordered: T[]): T[][] {
  const groups: T[][] = [];
  for (const b of ordered) {
    const machine = b.machine ?? 'local';
    const last = groups[groups.length - 1];
    if (!last || (last[0]!.machine ?? 'local') !== machine) groups.push([b]);
    else last.push(b);
  }
  return groups;
}

/** The discreet strip's width: one dot per session (six at most), never narrower than the bare island. */
export function stripWidth(n: number): number {
  const shown = Math.min(n, ISLAND.max);
  return Math.max(islandWidth(0), 2 * ISLAND.stripPad + shown * ISLAND.dotW + Math.max(0, shown - 1) * ISLAND.dotGap);
}

export const islandAxis = (screenW: number, position: IslandPosition = 'center'): number =>
  position === 'left' ? screenW / 4 : position === 'right' ? (3 * screenW) / 4 : screenW / 2;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** An enlarged view (reading mode, expanded reader) takes 60% of the screen width, never less than `min` nor more than `expandedMaxW`. */
export const expandedWidth = (screenW: number, min: number) => clamp(Math.round(screenW * 0.6), min, SIZES.expandedMaxW);

/** `detailH` is the measured height of the settings or help view (the fixed sizes are fallbacks). `listExtraH` is the extra height of the list: an expanded (focused) row, the notice, the update card. `bubbleH` is the measured bubble height; `SIZES.bubbleH` is only the fallback before the first measurement. `strip` draws the discreet strip instead of the compact island (handle mode only). */
export interface LayoutInput { bots: Array<{ id: string; pending: boolean; machine?: string }>; mode: Mode; screenH: number; screenW: number; position?: IslandPosition; strip?: boolean; /** The update dash on the resting notch. */ pip?: boolean; dnd?: boolean; readerExpanded?: boolean; bubbleH?: number; sessionH?: number; /** Measured height of the open helper view. */ helperH?: number; reading?: boolean; listExtraH?: number; groups?: number; detailH?: number; /** Extra height of the ask field above the list rows (`ASK_H`). */ askH?: number }

/** Everything hangs from the top edge of the work area, centred on the island's axis; `left` is clamped into the screen. */
export function layout(input: LayoutInput): Layout {
  const { bots, mode, screenH, screenW } = input;
  const n = bots.length;
  const maxH = screenH - SIZES.margin;
  const axis = islandAxis(screenW, input.position);
  const place = (w: number) => clamp(Math.round(axis - w / 2), 0, Math.max(0, screenW - w));
  const ordered = islandOrder(bots);
  const groups = machineGroups(ordered);
  const handleW = mode === 'handle' ? filetWidth(groups.map(g => g.length), !!input.pip) : islandWidth(n, input.dnd, islandPipes(ordered));
  const handle = { left: place(handleW), w: handleW, h: mode === 'handle' ? FILET.h : ISLAND.h };
  const slots: Slot[] = [];
  let cursor = FILET.pad + FILET.ledge;
  for (const group of groups) {
    cursor += FILET.sep;
    group.forEach((b, i) => {
      slots.push({ id: b.id, size: FILET.dash, center: handle.left + cursor + FILET.dash / 2 });
      cursor += FILET.dash + (i < group.length - 1 ? FILET.gap : 0);
    });
  }
  const view = (w: number, h: number): Layout => ({ left: place(w), top: 0, w, h: Math.min(maxH, h), slots, handle });
  if (mode === 'handle') return { left: handle.left, top: 0, w: handleW, h: handle.h, slots, handle };
  if (mode === 'bubble') return view(SIZES.bubbleW, input.bubbleH ?? SIZES.bubbleH);
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
