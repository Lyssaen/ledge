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
  const send = (data: string) => { if (!readOnly) for (const fn of inputs) fn(data); };
  term.onData(send);

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
    setReadOnly: on => { readOnly = on; term.options.disableStdin = on; applyTheme(); },
    setTheme: t => { theme = t; applyTheme(); },
    dispose: () => term.dispose()
  };
}
