/**
 * The terminals live outside React, as in Ledge's term store: an xterm is opened once, then its element is moved
 * wherever its panel is shown, including into a popout window's document.
 *
 * WebGL budget: at most `budget` terminals render with WebGL at once; the others use xterm's DOM renderer. A terminal
 * whose element changes document (a popout) gets a fresh WebGL addon: a context belongs to its canvas's document.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { openPty, type Kind, type Pty } from './pty';

export interface Term {
  id: string; kind: Kind; term: Terminal; fit: FitAddon; pty: Pty | null; host: HTMLDivElement;
  webgl: WebglAddon | null; doc: Document | null;
  /** The document the current xterm was opened in: an element moved to a popout is adopted, the xterm is not. */
  openedIn: Document | null; bytes: number; renders: number;
  /** The end of the output (raw bytes), replayed into a new xterm when the terminal changes window. */
  ring: Uint8Array[]; ringBytes: number;
  /** Resolvers waiting for a character's echo (latency measure). */
  echo: Array<{ ch: string; resolve: () => void }>;
}

export const stats = { webglCreated: 0, webglLost: 0, webglActive: 0, webglRefused: 0, moves: 0, recreated: 0, replayedBytes: 0, errors: [] as string[] };
export let budget = 12;
export const setBudget = (n: number) => { budget = n; };
const RING_MAX = 256 * 1024;

const terms = new Map<string, Term>();
export const allTerms = () => [...terms.values()];

/** An xterm keeps the document and window it was opened in: one per document. */
function makeXterm(t: Pick<Term, 'renders'> & Partial<Term>): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({ fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 12, scrollback: 5000, theme: { background: '#0c0c0d' }, allowProposedApi: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

function wire(t: Term): void {
  t.term.onRender(() => { t.renders++; });
  t.term.onData(d => t.pty?.write(d));
}

export function getTerm(id: string, kind: Kind): Term {
  let t = terms.get(id);
  if (t) return t;
  const host = document.createElement('div');
  host.className = 'term-host';
  const { term, fit } = makeXterm({ renders: 0 });
  t = { id, kind, term, fit, pty: null, host, webgl: null, doc: null, openedIn: null, bytes: 0, renders: 0, ring: [], ringBytes: 0, echo: [] };
  wire(t);
  terms.set(id, t);
  return t;
}

/** Shows the terminal inside `container` (a panel's body, in whichever document). */
export function mount(t: Term, container: HTMLElement): void {
  if (t.host.parentElement !== container) container.appendChild(t.host);
  const doc = container.ownerDocument;
  if (t.term.element && t.openedIn && t.openedIn !== doc) {
    // Another window: a new xterm opened in that document, fed the end of the output. The PTY does not move.
    stats.moves++; dropWebgl(t);
    try { t.term.dispose(); } catch (e) { note(e); }
    t.host.replaceChildren();
    const { term, fit } = makeXterm(t);
    t.term = term; t.fit = fit; wire(t);
    term.open(t.host); t.openedIn = doc;
    for (const chunk of t.ring) term.write(chunk);
    stats.recreated++; stats.replayedBytes += t.ringBytes;
  }
  if (!t.term.element) { t.term.open(t.host); t.openedIn = doc; }
  t.doc = doc;
  ensureWebgl(t);
  requestAnimationFrame(() => { try { t.fit.fit(); t.pty?.resize(t.term.cols, t.term.rows); } catch (e) { note(e); } });
  if (!t.pty && (t.kind !== 'flood' || floods)) void start(t);
}

/** The flood terminals start only for the « charge max » profile: the « réaliste » one runs without them. */
let floods = false;
export function startFloods(): void {
  floods = true;
  for (const t of terms.values()) if (t.kind === 'flood' && !t.pty && t.term.element) void start(t);
}

/** The panel is hidden (another tab in front, or closed): its terminal gives its WebGL context back. */
export function hidden(t: Term): void { dropWebgl(t); }

async function start(t: Term): Promise<void> {
  const dec = new TextDecoder();
  t.pty = await openPty(t.kind, t.term.cols || 80, t.term.rows || 24, data => {
    t.bytes += data.length;
    t.ring.push(data); t.ringBytes += data.length;
    while (t.ringBytes > RING_MAX && t.ring.length > 1) t.ringBytes -= t.ring.shift()!.length;
    const text = t.echo.length ? dec.decode(data) : '';
    t.term.write(data, () => {
      if (!t.echo.length) return;
      const hit = t.echo.findIndex(e => text.includes(e.ch));
      if (hit >= 0) { const [e] = t.echo.splice(hit, 1); const win = t.host.ownerDocument.defaultView ?? window; win.requestAnimationFrame(() => e.resolve()); }
    });
  });
}

function ensureWebgl(t: Term): void {
  if (t.webgl) return;
  if (stats.webglActive >= budget) { stats.webglRefused++; return; }
  try {
    const w = new WebglAddon();
    w.onContextLoss(() => { stats.webglLost++; dropWebgl(t); });
    t.term.loadAddon(w);
    t.webgl = w; stats.webglCreated++; stats.webglActive++;
  } catch (e) { note(e); }
}

function dropWebgl(t: Term): void {
  if (!t.webgl) return;
  try { t.webgl.dispose(); } catch (e) { note(e); }
  t.webgl = null; stats.webglActive--;
}

function note(e: unknown): void { stats.errors.push(String(e instanceof Error ? e.message : e)); }

/** Types `ch` and resolves once its echo is drawn: the time from a key to its echo on screen. */
export function echoLatency(t: Term, ch: string): Promise<number> {
  return new Promise(resolve => {
    const t0 = performance.now();
    t.echo.push({ ch, resolve: () => resolve(performance.now() - t0) });
    t.pty?.write(ch);
    setTimeout(() => { const i = t.echo.findIndex(e => e.ch === ch); if (i >= 0) { t.echo.splice(i, 1); resolve(Number.NaN); } }, 3000);
  });
}
