// What a sizing watch changes on a tmux window, and how it is given back (review of the seat terminal).
// A watch that may type sets `window-size manual` and resizes the window. Before that, the window's own value and its
// dimensions are kept on the window itself, in `@ledge_window_size` (`smallest:115x30`; `-` for no value of its own), so the
// last watch to leave puts back exactly that window, and a daemon that died meanwhile has it put back at its next start.
// The dimensions matter whenever the window ends up in `manual` (its own value, or the server's): nothing resizes it then.
// Only a window that carries the mark was changed by Ledge.

/** The window option that keeps a held window's own `window-size` and dimensions. */
export const SIZE_MARK = '@ledge_window_size';
/** No `window-size` of the window's own. */
export const NO_SIZE = '-';
/** The values tmux takes for `window-size`: anything else read back is not written again. */
const SIZES = /^(?:largest|smallest|manual|latest)$/;
const DIMS = /^(\d{1,5})x(\d{1,5})$/;

/** What a held window had before Ledge: its own `window-size` (`NO_SIZE` for none) and, when known, its dimensions. */
export interface KeptWindow { size: string; cols?: number; rows?: number }

/** The value a `show-options -wq -t … <option>` printed (`window-size smallest`), or null when the window has none. */
export function optionValue(lines: readonly string[], option: string): string | null {
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(`${option} `)) return t.slice(option.length + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return null;
}

/** `115x30` from `#{window_width}x#{window_height}`, null for anything else. */
export function dimsOf(text: string | null | undefined): { cols: number; rows: number } | null {
  const m = DIMS.exec((text ?? '').trim());
  if (!m) return null;
  const cols = Number(m[1]), rows = Number(m[2]);
  return cols > 0 && rows > 0 && cols <= 10_000 && rows <= 10_000 ? { cols, rows } : null;
}

/** The mark's text: `smallest:115x30`, `-:115x30`, or the size alone when the dimensions could not be read. */
export function markOf(k: KeptWindow): string {
  return k.cols && k.rows ? `${k.size}:${k.cols}x${k.rows}` : k.size;
}

/** What a mark says to put back. A size that is not one tmux takes reads as none; dimensions that do not read are left out. */
export function keptOf(mark: string | null): KeptWindow {
  const [size = '', dims] = (mark ?? '').split(':');
  const d = dimsOf(dims);
  return { size: SIZES.test(size) ? size : NO_SIZE, ...(d ?? {}) };
}

/** The tmux commands that give a window back its dimensions, then its own size, then drop the mark. `target` is already quoted.
 *  `resize-window` sets the window to `manual` itself: the option comes after it, so the window ends with its own value. */
export function restoreCommands(target: string, k: KeptWindow): string[] {
  return [
    ...(k.cols && k.rows ? [`resize-window -x ${k.cols} -y ${k.rows} -t ${target}`] : []),
    k.size === NO_SIZE ? `set-option -wu -t ${target} window-size` : `set-option -w -t ${target} window-size ${k.size}`,
    `set-option -wu -t ${target} ${SIZE_MARK}`
  ];
}
