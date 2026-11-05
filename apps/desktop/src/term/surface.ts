import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { termKey } from './keys';
import type { TermTheme } from './theme';

/** One xterm and the element it lives in; the element is moved between containers, never re-created. */
export interface TermSurface {
  host: HTMLElement;
  write(b: Uint8Array | string): void;
  onInput(fn: (data: string) => void): void;
  onResize(fn: (cols: number, rows: number) => void): void;
  size(): { cols: number; rows: number };
  fit(): void;
  focus(): void;
  setReadOnly(on: boolean): void;
  setTheme(t: TermTheme): void;
  dispose(): void;
}

/** Ctrl V with nothing to paste: the raw byte, so Claude Code can read an image from the clipboard itself. */
const PASTE_BYTE = '\x16';
/** What xterm answers on its own: a cursor position report, its device attributes. ConPTY waits for the first before it draws. */
const REPORT = /^\x1b\[(?:\d+;\d+R|[?>][\d;]*c)$/;
/** The modes by which a program takes the mouse (X10, normal, highlight, button, any). */
const MOUSE_MODES = [9, 1000, 1001, 1002, 1003];
/** The most an OSC 52 may put in the clipboard: a program cannot fill memory through it. */
const CLIP_MAX = 1 << 20;

/** What an OSC 52 asks to copy (`c;<base64>`), as text; null for a read (`?`), a malformed or an oversized one. */
export function osc52Text(data: string): string | null {
  const at = data.indexOf(';');
  if (at < 0) return null;
  const b64 = data.slice(at + 1);
  if (b64 === '?' || b64.length > (CLIP_MAX * 4) / 3 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function createSurface(opts: { theme: TermTheme; onThread(): void; openUrl(url: string): void }): TermSurface {
  const host = document.createElement('div');
  host.setAttribute('data-terminal', '');
  // Capped scrollback: an agent redrawing its screen emits megabytes, memory must not follow.
  // Every link the screen prints (plain URLs, OSC 8) goes to the system browser: `window.open` opens nothing useful in the webview.
  const term = new Terminal({
    scrollback: 5000, fontFamily: 'Geist Mono, monospace', theme: opts.theme,
    linkHandler: { activate: (_, uri) => opts.openUrl(uri), allowNonHttpProtocols: false }
  });
  const fitter = new FitAddon();
  term.loadAddon(fitter);
  term.loadAddon(new WebLinksAddon((_, uri) => opts.openUrl(uri)));
  term.open(host);
  try {
    const webgl = new WebglAddon();
    // Without the addon xterm draws with the DOM renderer: slower, but it draws.
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch { /* no WebGL here: the DOM renderer */ }

  let theme = opts.theme;
  let readOnly = false;
  const inputs: ((data: string) => void)[] = [];
  // Read-only drops the keys, not the replies: disableStdin would drop both, and the screen would wait forever.
  const send = (data: string) => { if (!readOnly || REPORT.test(data)) for (const fn of inputs) fn(data); };
  term.onData(send);

  // A program's own copy (OSC 52: Claude Code's selection, tmux, vim) reaches the clipboard. Writing only: a read (`?`) is
  // refused, a program never sees what you copied elsewhere.
  term.parser.registerOscHandler(52, data => {
    const text = osc52Text(data);
    if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  });

  // A read-only screen keeps the mouse for selecting: its clicks would reach no one. The modes the program asks for are kept,
  // and given back when the screen takes keys again.
  const mouse = new Set<number>();
  /** Our own « mouse off » on going read-only: not the program's, so the modes it asked for stay remembered. */
  let ours = 0;
  const flat = (params: (number | number[])[]): number[] => params.map(p => (Array.isArray(p) ? p[0] ?? 0 : p));
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
    const ps = flat(params);
    const asked = ps.filter(p => MOUSE_MODES.includes(p));
    for (const p of asked) mouse.add(p);
    if (!readOnly || !asked.length) return false;
    const rest = ps.filter(p => !MOUSE_MODES.includes(p));
    if (rest.length) term.write(`\x1b[?${rest.join(';')}h`);
    return true;
  });
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
    const ps = flat(params);
    if (ours > 0 && ps.join(';') === MOUSE_MODES.join(';')) { ours--; return false; }
    for (const p of ps) mouse.delete(p);
    return false;
  });
  const setMouseFor = (on: boolean) => {
    if (on) { ours++; term.write(`\x1b[?${MOUSE_MODES.join(';')}l`); }
    else if (mouse.size) term.write([...mouse].map(m => `\x1b[?${m}h`).join(''));
  };

  // A read-only screen hides its cursor in the background's colour; the text under a block cursor keeps its own.
  const applyTheme = () => { term.options.theme = readOnly ? { ...theme, cursor: theme.background, cursorAccent: theme.foreground } : theme; };

  const paste = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    // One bracketed paste, so a multi-line answer to the agent does not submit line by line.
    if (text) term.paste(text);
    else send(PASTE_BYTE);
  };

  term.attachCustomKeyEventHandler(e => {
    const action = termKey(e, term.hasSelection());
    if (action === 'pass') return true;
    e.preventDefault();
    if (action === 'thread') {
      // Focus has left the terminal by the time the window sees the key, and `useKeys` would send it straight back.
      e.stopPropagation();
      opts.onThread();
    } else if (action === 'copy') {
      const text = term.getSelection();
      if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
      term.clearSelection();
    } else if (!readOnly) {
      void paste();
    }
    return false;
  });

  return {
    host,
    write: b => term.write(b),
    onInput: fn => { inputs.push(fn); },
    onResize: fn => { term.onResize(({ cols, rows }) => fn(cols, rows)); },
    size: () => ({ cols: term.cols, rows: term.rows }),
    fit: () => fitter.fit(),
    focus: () => term.focus(),
    setReadOnly: on => {
      const was = readOnly;
      readOnly = on;
      applyTheme();
      if (on !== was) setMouseFor(on);
    },
    setTheme: t => { theme = t; applyTheme(); },
    dispose: () => term.dispose()
  };
}
