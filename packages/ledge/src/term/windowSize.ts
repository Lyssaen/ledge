// What a sizing watch changes on a tmux window, and how it is given back (P1/P2 of the seat terminal's review).
// A watch that may type sets `window-size manual`. Before that, the window's own value is kept on the window itself, in
// `@ledge_window_size` (`-` when it had none), so the last watch to leave puts back exactly that value, and a daemon that
// died meanwhile has it put back at its next start. Only a window that carries the mark was changed by Ledge.

/** The window option that keeps a held window's own `window-size`. */
export const SIZE_MARK = '@ledge_window_size';
/** The mark of a window that had no `window-size` of its own. */
export const NO_SIZE = '-';
/** The values tmux takes for `window-size`: anything else read back is not written again. */
const SIZES = /^(?:largest|smallest|manual|latest)$/;

/** The value a `show-options -wq -t … <option>` printed (`window-size smallest`), or null when the window has none. */
export function optionValue(lines: readonly string[], option: string): string | null {
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(`${option} `)) return t.slice(option.length + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return null;
}

/** What a window's mark says to put back: a valid size, else none (the window then follows its session's or the server's). */
export const keptSize = (mark: string | null): string => (mark && SIZES.test(mark) ? mark : NO_SIZE);

/** The tmux commands that give a window back its own size and drop the mark. `target` is already quoted. */
export function restoreCommands(target: string, kept: string): string[] {
  return [
    kept === NO_SIZE ? `set-option -wu -t ${target} window-size` : `set-option -w -t ${target} window-size ${kept}`,
    `set-option -wu -t ${target} ${SIZE_MARK}`
  ];
}
