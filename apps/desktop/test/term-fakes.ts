import type { PtyBackend, PtyEvents } from '../src/term/backend';
import type { TermSurface } from '../src/term/surface';

/** The pty backend and the xterm surfaces of the terminal views' tests (agent-view, right-panel). */
export type Open = { argv: string[]; on: PtyEvents; resolve(ok: boolean): void };
export type FakeSurface = TermSurface & { written: (Uint8Array | string)[]; fits: number; focuses: number; disposed: boolean };

export function fakeBackend() {
  const opens: Open[] = [];
  let hold = false;
  const backend: PtyBackend & { opens: Open[]; hold(on: boolean): void } = {
    opens,
    hold: on => { hold = on; },
    open: (argv, _size, on) => new Promise(res => {
      const o: Open = { argv, on, resolve: ok => res(ok ? { write: () => {}, resize: () => {}, close: () => {} } : null) };
      opens.push(o);
      if (!hold) o.resolve(true);
    })
  };
  return backend;
}

export function fakeSurface(): FakeSurface {
  const host = document.createElement('div');
  host.setAttribute('data-terminal', '');
  const s: FakeSurface = {
    host, written: [], fits: 0, focuses: 0, disposed: false,
    write: b => { s.written.push(b); }, onInput: () => {}, onResize: () => {},
    size: () => ({ cols: 80, rows: 24 }), fit: () => { s.fits += 1; }, focus: () => { s.focuses += 1; },
    setReadOnly: () => {}, setTheme: () => {}, setWebgl: () => {}, onWebglLost: () => {}, dispose: () => { s.disposed = true; }
  };
  return s;
}
