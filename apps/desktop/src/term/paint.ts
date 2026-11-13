import type { TermModes } from '@ledge/protocol';

const set = (mode: string, on: boolean) => `\x1b[${mode}${on ? 'h' : 'l'}`;

/**
 * What paints a first screen: the program's modes (it set them before the watch, xterm never saw them), home, clear,
 * the lines, then the cursor where the pane has it. Without `modes` (an older daemon) xterm keeps its own.
 * Outside the alternate screen the lines start with the pane's history (#298): the scrollback is cleared first, so a fresh
 * screen replaces the history instead of piling a copy on it; the lines past the grid scroll into it, and the cursor, placed
 * from the top of the grid, lands on the visible screen (its last `rows` lines).
 */
export function paintScreen(screen: string, cursor: { x: number; y: number }, modes?: TermModes): string {
  // The alternate screen first: what follows is painted on the buffer the program draws on.
  const before = modes ? set('?1049', modes.alt) : '';
  const clear = modes && !modes.alt ? '\x1b[3J' : '';
  const body = `\x1b[H\x1b[2J${clear}${screen.replace(/\n/g, '\r\n')}\x1b[${cursor.y + 1};${cursor.x + 1}H`;
  if (!modes) return before + body;
  const after = [
    set('?25', modes.cursor), set('?1', modes.appCursor), modes.appKeypad ? '\x1b=' : '\x1b>',
    set('?7', modes.wrap), set('4', modes.insert), set('?2004', modes.paste === true),
    // One mouse mode at most, its encoding after it.
    set('?1000', false), set('?1002', false), set('?1003', false),
    modes.mouse === 'standard' ? set('?1000', true) : modes.mouse === 'button' ? set('?1002', true) : modes.mouse === 'any' ? set('?1003', true) : '',
    set('?1006', modes.sgr)
  ].join('');
  return before + body + after;
}
