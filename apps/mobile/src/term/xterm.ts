// The phone's xterm: the pane's own size, never fitted to the phone; the font size zooms instead (spec §3.5).
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import '@xterm/xterm/css/xterm.css';
import { termTheme, type TermTheme } from '@ledge/ui/termTheme';
import type { TermScreen } from './controller';

import { MAX_PX, MIN_PX, READABLE_PX } from './keys';
/** A monospace cell is about this wide for its font size (Geist Mono): the fit's first guess, before xterm measures. */
const CELL_RATIO = 0.6;

export interface XtermScreen extends TermScreen {
  onData(fn: (data: string) => void): void;
  setFont(px: number): void;
  font(): number;
  /** The font size at which `cols` columns fill `width` pixels, never below `MIN_PX`. */
  fitFont(width: number): number;
  /** The cursor's column, and a cell's width in pixels: « Lisible » follows the cursor. */
  cursor(): { x: number; cellWidth: number };
  setInput(on: boolean): void;
  /** Types `text` as a paste: bracketed when the pane asked for it. */
  paste(text: string): void;
  /** The pane switched its arrows to application mode (`ESC O A`). */
  appCursor(): boolean;
  /** After each write is drawn. */
  onDrawn(fn: () => void): void;
  /** The rows on screen, as text: the context keys read a numbered choice there. */
  rows(): string[];
  focus(): void;
  setTheme(t: TermTheme): void;
  dispose(): void;
}

export function createXterm(host: HTMLElement): XtermScreen {
  const theme = termTheme(getComputedStyle(document.documentElement));
  const term = new Terminal({
    cols: 80, rows: 24, fontSize: READABLE_PX, fontFamily: '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace',
    // The first screen carries the pane's history (#298, PHONE_HISTORY_LINES), and what the pane writes after it scrolls on: a
    // short scrollback, a phone's memory.
    scrollback: 1_000, theme, cursorBlink: false, allowProposedApi: false,
    // The screen reader mode reads the rows as text (the mockup's accessibility notes).
    screenReaderMode: true
  });
  // The canvas renderer, never the DOM one: the relay serves the app with `style-src 'self'`, and the DOM renderer draws
  // through <style> elements the policy blocks (no font, no colours, no cell widths). Loaded before `open`, so the DOM
  // renderer is never made. WebGL is fragile on iOS Safari.
  term.loadAddon(new CanvasAddon());
  term.open(host);
  let input = false;
  const datas: Array<(d: string) => void> = [];
  const emit = (d: string) => { if (input) for (const fn of datas) fn(d); };
  term.onData(emit);
  // In screen reader mode xterm drops text the phone's keyboard puts in without a key. Samsung's keyboard does just that on
  // a symbol: it takes the word back (Backspaces, which xterm sends) then types the word and the symbol again as text alone,
  // so the line was erased and the symbol lost. That text is typed here, as xterm itself does outside that mode.
  let keyDown = false;
  const ta = term.textarea;
  ta?.addEventListener('keydown', () => { keyDown = true; }, true);
  ta?.addEventListener('keyup', () => { keyDown = false; }, true);
  ta?.addEventListener('input', e => {
    const ev = e as InputEvent;
    if (ev.inputType === 'insertText' && ev.data && (!ev.composed || !keyDown)) emit(ev.data);
  });
  const cellWidth = () => {
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width?: number } } } } } })._core;
    return core?._renderService?.dimensions?.css?.cell?.width || term.options.fontSize! * CELL_RATIO;
  };
  return {
    reset(cols, rows) { term.reset(); term.resize(cols, rows); },
    write: data => term.write(data),
    resize: (cols, rows) => term.resize(cols, rows),
    onData: fn => { datas.push(fn); },
    setFont: px => { term.options.fontSize = Math.max(MIN_PX, Math.min(MAX_PX, px)); },
    font: () => term.options.fontSize ?? READABLE_PX,
    fitFont: width => Math.max(MIN_PX, Math.min(MAX_PX, Math.floor((width / (term.cols * CELL_RATIO)) * 10) / 10)),
    cursor: () => ({ x: term.buffer.active.cursorX, cellWidth: cellWidth() }),
    setInput: on => { input = on; term.options.disableStdin = !on; },
    paste: text => { if (input) term.paste(text); },
    appCursor: () => term.modes.applicationCursorKeysMode,
    onDrawn: fn => { term.onWriteParsed(fn); },
    rows: () => {
      const b = term.buffer.active;
      return Array.from({ length: term.rows }, (_, y) => b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
    },
    focus: () => term.focus(),
    setTheme: t => { term.options.theme = t; },
    dispose: () => term.dispose()
  };
}
