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
  /** Loads or frees the WebGL addon (the store's budget decides); without it xterm draws with the DOM renderer. A lost context
   *  frees it by itself and is reported through `onWebglLost`: the budget gives it back only at the next `setWebgl(true)`. */
  setWebgl(on: boolean): void;
  onWebglLost(fn: () => void): void;
  /** Its element now in `doc` (another window): the xterm is made again there. Absent on fakes. */
  adopt?(doc: Document): void;
  dispose(): void;
}

/** Ctrl V with nothing to paste: the raw byte, so Claude Code can read an image from the clipboard itself. */
const PASTE_BYTE = '\x16';
/** What xterm answers on its own: a cursor position report, its device attributes. ConPTY waits for the first before it draws. */
const REPORT = /^\x1b\[(?:\d+;\d+R|[?>][\d;]*c)$/;
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

/** The end of a terminal's output kept for a replay (lot 0, point 1): an xterm moved to another window is made again there. */
export const REPLAY_MAX = 256 * 1024;

export function createSurface(opts: { theme: TermTheme; onThread(): void; openUrl(url: string): void; /** The IDE is on: Ctrl+J, typed here, toggles the bottom panel (`onPanel`). */ panelKey?(): boolean; onPanel?(): void }): TermSurface {
  const host = document.createElement('div');
  host.setAttribute('data-terminal', '');
  let theme = opts.theme;
  let readOnly = false;
  const inputs: ((data: string) => void)[] = [];
  const resizes: ((cols: number, rows: number) => void)[] = [];
  const lost: (() => void)[] = [];
  // Read-only drops the keys, not the replies: disableStdin would drop both, and the screen would wait forever.
  const send = (data: string) => { if (!readOnly || REPORT.test(data)) for (const fn of inputs) fn(data); };
  // What was written, its last REPLAY_MAX bytes: what a new xterm is fed when the terminal changes window.
  const replay: (Uint8Array | string)[] = [];
  let replayBytes = 0;
  const keep = (b: Uint8Array | string) => {
    replay.push(b);
    replayBytes += typeof b === 'string' ? b.length : b.byteLength;
    while (replayBytes > REPLAY_MAX && replay.length > 1) { const x = replay.shift()!; replayBytes -= typeof x === 'string' ? x.length : x.byteLength; }
  };

  // Capped scrollback: an agent redrawing its screen emits megabytes, memory must not follow.
  // Every link the screen prints (plain URLs, OSC 8) goes to the system browser: `window.open` opens nothing useful in the webview.
  const make = () => {
    const t = new Terminal({
      scrollback: 5000, fontFamily: 'Geist Mono, monospace', theme: readOnly ? { ...theme, cursor: theme.background, cursorAccent: theme.foreground } : theme,
      linkHandler: { activate: (_, uri) => opts.openUrl(uri), allowNonHttpProtocols: false }
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(new WebLinksAddon((_, uri) => opts.openUrl(uri)));
    t.onData(send);
    t.onResize(({ cols, rows }) => { for (const fn of resizes) fn(cols, rows); });
    // A program's own copy (OSC 52: Claude Code's selection, tmux, vim) reaches the clipboard. Writing only: a read (`?`) is
    // refused, a program never sees what you copied elsewhere.
    t.parser.registerOscHandler(52, data => {
      const text = osc52Text(data);
      if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
      return true;
    });
    t.attachCustomKeyEventHandler(e => {
      const action = termKey(e, t.hasSelection(), opts.panelKey?.() ?? false);
      if (action === 'pass') return true;
      e.preventDefault();
      if (action === 'thread') {
        // Focus has left the terminal by the time the window sees the key, and `useKeys` would send it straight back.
        e.stopPropagation();
        opts.onThread();
      } else if (action === 'panel') {
        e.stopPropagation();
        opts.onPanel?.();
      } else if (action === 'copy') {
        const text = t.getSelection();
        if (text) void navigator.clipboard.writeText(text).catch(() => undefined);
        t.clearSelection();
      } else if (!readOnly) {
        void paste();
      }
      return false;
    });
    t.open(host);
    // A tab moved to another IDE group puts this scroll back (DockHost's keepScroll).
    host.querySelector('.xterm-viewport')?.setAttribute('data-keep-scroll', '');
    return { t, f };
  };

  let { t: term, f: fitter } = make();
  // The document the xterm was opened in. An xterm keeps it for good: its host adopted by another window's document (a
  // popout), it stays blank there (lot 0, point 1). `element.ownerDocument` follows the adoption, so it is kept here.
  let openedIn: Document = host.ownerDocument;

  // Born without WebGL: the store gives it to the terminals shown most recently (term/webgl.ts), the others stay on the DOM renderer.
  let webgl: WebglAddon | null = null;
  const setWebgl = (on: boolean) => {
    if (on === (webgl !== null)) return;
    if (!on) { webgl?.dispose(); webgl = null; return; }
    try {
      const addon = new WebglAddon();
      // Without the addon xterm draws with the DOM renderer: slower, but it draws.
      addon.onContextLoss(() => {
        if (webgl !== addon) return;
        addon.dispose();
        webgl = null;
        for (const fn of lost) fn();
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      // No WebGL here: the DOM renderer, and the store is told so, like a loss, to pass the slot on.
      webgl = null;
      for (const fn of lost) fn();
    }
  };

  // A read-only screen keeps the mouse for selecting: its clicks would reach no one. A plain press is handed to xterm as the
  // Shift + press it already takes as « select over the program's mouse »: the program's mouse modes stay exactly as it set them.
  const mac = /Mac/.test(navigator.platform);
  let forwarding = false;
  host.addEventListener('mousedown', e => {
    if (!readOnly || forwarding || e.button !== 0 || e.shiftKey || (mac && e.altKey) || term.modes.mouseTrackingMode === 'none') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    // Shift + press extends a selection: a plain press starts a new one.
    if (e.detail <= 1) term.clearSelection();
    forwarding = true;
    try {
      e.target?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, composed: true, view: e.view, detail: e.detail, screenX: e.screenX, screenY: e.screenY,
        clientX: e.clientX, clientY: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, button: e.button, buttons: e.buttons,
        ...(mac ? { altKey: true } : { shiftKey: true, altKey: e.altKey })
      }));
    } finally { forwarding = false; }
  }, true);

  // A read-only screen hides its cursor in the background's colour; the text under a block cursor keeps its own.
  const applyTheme = () => { term.options.theme = readOnly ? { ...theme, cursor: theme.background, cursorAccent: theme.foreground } : theme; };

  const paste = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    // One bracketed paste, so a multi-line answer to the agent does not submit line by line.
    if (text) term.paste(text);
    else send(PASTE_BYTE);
  };

  /** Shown in another window's document: a new xterm opened there, fed the end of the output. The PTY does not move, nor
   *  do the listeners; the WebGL slot is given up (its context belonged to the old canvas) and the store gives it back. */
  const adopt = (doc: Document) => {
    if (doc === openedIn) return;
    const gl = webgl !== null;
    setWebgl(false);
    term.dispose();
    host.replaceChildren();
    ({ t: term, f: fitter } = make());
    openedIn = doc;
    for (const b of replay) term.write(b);
    if (gl) setWebgl(true);
  };

  // The e2e build only: the screen is a canvas, so Playwright reads the buffer here instead of its pixels.
  if (import.meta.env.VITE_LEDGE_E2E) {
    Object.defineProperty(host, '__ledgeTermText', {
      get: () => {
        const buf = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i)?.translateToString(true);
          if (line) lines.push(line);
        }
        return lines.join('\n');
      },
    });
  }

  return {
    host,
    write: b => { keep(b); term.write(b); },
    onInput: fn => { inputs.push(fn); },
    onResize: fn => { resizes.push(fn); },
    size: () => ({ cols: term.cols, rows: term.rows }),
    fit: () => fitter.fit(),
    focus: () => term.focus(),
    setReadOnly: on => { readOnly = on; applyTheme(); },
    setTheme: t => { theme = t; applyTheme(); },
    setWebgl,
    onWebglLost: fn => { lost.push(fn); },
    adopt,
    dispose: () => term.dispose()
  };
}
