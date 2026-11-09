import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const xt = vi.hoisted(() => {
  const terms: FakeTerminal[] = [];
  class FakeTerminal {
    options: Record<string, unknown>;
    cols = 80; rows = 24;
    keys: (e: KeyboardEvent) => boolean = () => true;
    data: ((d: string) => void)[] = [];
    selection = '';
    paste = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    open = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    clearSelection = vi.fn(() => { this.selection = ''; });
    modes = { mouseTrackingMode: 'none' };
    osc = new Map<number, (d: string) => boolean>();
    csi = new Map<string, (p: (number | number[])[]) => boolean>();
    parser = {
      registerOscHandler: (n: number, fn: (d: string) => boolean) => { this.osc.set(n, fn); return { dispose() {} }; },
      registerCsiHandler: (id: { prefix?: string; final: string }, fn: (p: (number | number[])[]) => boolean) => { this.csi.set(`${id.prefix ?? ''}${id.final}`, fn); return { dispose() {} }; }
    };
    constructor(o: Record<string, unknown>) { this.options = { ...o }; terms.push(this); }
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { this.keys = fn; }
    onData(fn: (d: string) => void) { this.data.push(fn); return { dispose() {} }; }
    resized: ((e: { cols: number; rows: number }) => void)[] = [];
    onResize(fn: (e: { cols: number; rows: number }) => void) { this.resized.push(fn); return { dispose() {} }; }
    hasSelection() { return this.selection !== ''; }
    getSelection() { return this.selection; }
  }
  return { terms, links: [] as unknown[], FakeTerminal, webglThrows: false, contextLost: [] as (() => void)[], webgl: [] as { dispose: ReturnType<typeof vi.fn> }[] };
});
vi.mock('@xterm/xterm', () => ({ Terminal: xt.FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { constructor(public handler?: (e: MouseEvent, uri: string) => void) { xt.links.push(this); } } }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose = vi.fn();
    constructor() { if (xt.webglThrows) throw new Error('no WebGL'); xt.webgl.push(this); }
    onContextLoss(fn: () => void) { xt.contextLost.push(fn); return { dispose() {} }; }
  }
}));

import { createSurface, REPLAY_MAX } from '../src/term/surface';
import { placeSurface } from '../src/term/place';

const clip = { text: '', readText: vi.fn(async () => clip.text), writeText: vi.fn(async (t: string) => { clip.text = t; }) };
const key = (o: Partial<KeyboardEvent>) => {
  const e = { type: 'keydown', code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...o };
  return e as unknown as KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
};
const surface = (onThread = vi.fn(), openUrl = vi.fn()) => { const s = createSurface({ theme: { background: '#101112' }, onThread, openUrl }); return { s, t: xt.terms.at(-1)!, onThread }; };

beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true }); });
afterEach(() => { xt.terms.length = 0; xt.links.length = 0; xt.webgl.length = 0; xt.contextLost.length = 0; xt.webglThrows = false; clip.text = ''; vi.clearAllMocks(); });

it('one xterm with a capped scrollback, in a host marked as the terminal', () => {
  const { s, t } = surface();
  expect(t.options).toMatchObject({ scrollback: 5000, fontFamily: 'Geist Mono, monospace', theme: { background: '#101112' } });
  expect(s.host.hasAttribute('data-terminal')).toBe(true);
  expect(t.open).toHaveBeenCalledWith(s.host);
});

it('Ctrl V pastes the clipboard as one paste; an empty clipboard sends the raw byte', async () => {
  const { s, t } = surface();
  const input = vi.fn();
  s.onInput(input);
  clip.text = 'a\nb';
  const e = key({ ctrlKey: true, code: 'KeyV', key: 'v' });
  expect(t.keys(e)).toBe(false);
  expect(e.preventDefault).toHaveBeenCalled();
  await vi.waitFor(() => expect(t.paste).toHaveBeenCalledWith('a\nb'));
  expect(input).not.toHaveBeenCalledWith('a\nb');
  clip.text = '';
  t.keys(key({ ctrlKey: true, code: 'KeyV', key: 'v' }));
  await vi.waitFor(() => expect(input).toHaveBeenCalledWith('\x16'));
  expect(t.paste).toHaveBeenCalledTimes(1);
});

it('Ctrl C copies the selection and clears it, and interrupts without one', async () => {
  const { t } = surface();
  t.selection = 'hello';
  const e = key({ ctrlKey: true, code: 'KeyC', key: 'c' });
  expect(t.keys(e)).toBe(false);
  expect(e.preventDefault).toHaveBeenCalled();
  expect(clip.writeText).toHaveBeenCalledWith('hello');
  expect(t.clearSelection).toHaveBeenCalled();
  expect(t.keys(key({ ctrlKey: true, code: 'KeyC', key: 'c' }))).toBe(true);
});

it('the focus key leaves the terminal without reaching the window', () => {
  const { t, onThread } = surface();
  const e = key({ ctrlKey: true, code: 'Backquote', key: '²' });
  expect(t.keys(e)).toBe(false);
  expect(onThread).toHaveBeenCalled();
  expect(e.stopPropagation).toHaveBeenCalled();
  expect(e.preventDefault).toHaveBeenCalled();
});

it('Ctrl J reaches the app only when the IDE is on', () => {
  const onPanel = vi.fn();
  for (const [on, taken] of [[true, true], [false, false]] as const) {
    onPanel.mockClear();
    createSurface({ theme: { background: '#101112' }, onThread: vi.fn(), openUrl: vi.fn(), panelKey: () => on, onPanel });
    const t = xt.terms.at(-1)!;
    const e = key({ ctrlKey: true, code: 'KeyJ', key: 'j' });
    expect(t.keys(e)).toBe(!taken);
    expect(onPanel).toHaveBeenCalledTimes(taken ? 1 : 0);
    expect(e.stopPropagation).toHaveBeenCalledTimes(taken ? 1 : 0);
  }
});

it('read-only drops input, pasted or typed, and hides the cursor', async () => {
  const { s, t } = surface();
  const input = vi.fn();
  s.onInput(input);
  s.setReadOnly(true);
  expect(t.options.theme).toMatchObject({ background: '#101112', cursor: '#101112' });
  t.data.forEach(fn => fn('x'));
  t.keys(key({ ctrlKey: true, code: 'KeyV', key: 'v' }));
  await Promise.resolve(); await Promise.resolve();
  expect(input).not.toHaveBeenCalled();
  expect(clip.readText).not.toHaveBeenCalled();
  s.setTheme({ background: '#202122' });
  expect(t.options.theme).toMatchObject({ background: '#202122', cursor: '#202122' });
  s.setReadOnly(false);
  expect(t.options.theme).toEqual({ background: '#202122' });
  t.data.forEach(fn => fn('x'));
  expect(input).toHaveBeenCalledWith('x');
});

it('read-only still answers the terminal\'s own queries: ConPTY waits for the cursor report before it draws anything', () => {
  const { s, t } = surface();
  const input = vi.fn();
  s.onInput(input);
  s.setReadOnly(true);
  // xterm sends its replies through onData too: disableStdin would drop them with the keys.
  expect(t.options.disableStdin).toBeFalsy();
  for (const d of ['\x1b[12;1R', '\x1b[?1;2c', '\x1b[>0;276;0c', 'x', '\r', '\x1b[A', '\x1b[<0;3;4M']) t.data.forEach(fn => fn(d));
  expect(input.mock.calls).toEqual([['\x1b[12;1R'], ['\x1b[?1;2c'], ['\x1b[>0;276;0c']]);
});

it('is born on the DOM renderer; WebGL loads on demand, falls back when it throws, and a lost context is reported', () => {
  expect(() => surface()).not.toThrow();
  expect(xt.webgl).toHaveLength(0);
  xt.webglThrows = true;
  expect(() => surface().s.setWebgl(true)).not.toThrow();
  xt.webglThrows = false;
  const { s } = surface();
  const lost = vi.fn();
  s.onWebglLost(lost);
  s.setWebgl(true);
  s.setWebgl(true);
  expect(xt.webgl).toHaveLength(1);
  xt.contextLost[0]!();
  expect(xt.webgl[0]!.dispose).toHaveBeenCalled();
  expect(lost).toHaveBeenCalledTimes(1);
  // Freed by the loss: it can ask for WebGL again, and freeing is idempotent.
  s.setWebgl(true);
  expect(xt.webgl).toHaveLength(2);
  s.setWebgl(false);
  s.setWebgl(false);
  expect(xt.webgl[1]!.dispose).toHaveBeenCalledTimes(1);
});

it('links the terminal prints open in the system browser, not in the webview', () => {
  const openUrl = vi.fn();
  const { t } = surface(vi.fn(), openUrl);
  const click = {} as MouseEvent;
  (xt.links[0] as { handler: (e: MouseEvent, uri: string) => void }).handler(click, 'https://example.com/pr/1');
  (t.options.linkHandler as { activate(e: MouseEvent, uri: string): void; allowNonHttpProtocols: boolean }).activate(click, 'https://example.com/docs');
  expect(openUrl.mock.calls).toEqual([['https://example.com/pr/1'], ['https://example.com/docs']]);
  expect((t.options.linkHandler as { allowNonHttpProtocols: boolean }).allowNonHttpProtocols).toBe(false);
});

const b64 = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));

it('a program\'s OSC 52 copy reaches the clipboard, UTF-8 kept; a read or a malformed one does nothing', async () => {
  const { t } = surface();
  const osc = t.osc.get(52)!;
  expect(osc(`c;${b64('héllo — ✻')}`)).toBe(true);
  await vi.waitFor(() => expect(clip.writeText).toHaveBeenCalledWith('héllo — ✻'));
  clip.writeText.mockClear();
  expect(osc('c;?')).toBe(true);
  expect(osc('c;!!pas du base64')).toBe(true);
  expect(osc('sans point-virgule')).toBe(true);
  expect(osc(`c;${btoa('\xff\xfe')}`)).toBe(true);
  expect(clip.writeText).not.toHaveBeenCalled();
  // A read is never answered: nothing goes back to the program.
  const sent: string[] = [];
  const s2 = surface(); s2.s.onInput(d => sent.push(d)); s2.t.osc.get(52)!('c;?');
  expect(sent).toEqual([]);
});

it('osc52Text refuses an oversized copy', async () => {
  const { osc52Text } = await import('../src/term/surface');
  expect(osc52Text(`c;${'A'.repeat(1_500_000)}`)).toBeNull();
  expect(osc52Text(`;${b64('ok')}`)).toBe('ok');
});

it('read-only over a program that holds the mouse: a plain press reaches xterm as Shift + press (select); nothing is rewritten', () => {
  const { s, t } = surface();
  const cell = document.createElement('div');
  s.host.appendChild(cell);
  const seen: { shift: boolean; trusted: boolean }[] = [];
  cell.addEventListener('mousedown', e => seen.push({ shift: e.shiftKey, trusted: e.isTrusted }));
  const press = (o: MouseEventInit = {}) => cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1, ...o }));
  // Live, or a program without the mouse: the press goes as it is.
  t.modes.mouseTrackingMode = 'any';
  press();
  s.setReadOnly(true);
  t.modes.mouseTrackingMode = 'none';
  press();
  expect(seen.map(x => x.shift)).toEqual([false, false]);
  // Read-only and the program holds the mouse: one press, with Shift, a new selection.
  t.modes.mouseTrackingMode = 'any';
  seen.length = 0;
  press();
  expect(seen.map(x => x.shift)).toEqual([true]);
  expect(t.clearSelection).toHaveBeenCalledTimes(1);
  // A right button, or Shift already held: untouched.
  seen.length = 0;
  press({ button: 2 }); press({ shiftKey: true });
  expect(seen.map(x => x.shift)).toEqual([false, true]);
  expect(t.clearSelection).toHaveBeenCalledTimes(1);
  // Nothing is written to the screen by going read-only and back.
  s.setReadOnly(false);
  expect(t.write).not.toHaveBeenCalled();
});

// Lot 9 (docs/ide-workspace-l0.md, point 1): an xterm keeps the document it was opened in; shown in a popout, it is made again.
it('adopt: another document makes a new xterm there, fed the output, with the same listeners and the WebGL slot kept', () => {
  const { s, t } = surface();
  const input = vi.fn(); const resize = vi.fn();
  s.onInput(input); s.onResize(resize);
  s.write('hello'); s.write(new Uint8Array([33]));
  s.setWebgl(true);
  s.setReadOnly(true);
  s.adopt!(document);
  expect(xt.terms).toHaveLength(1);
  const other = document.implementation.createHTMLDocument('popout');
  s.adopt!(other);
  expect(t.dispose).toHaveBeenCalled();
  expect(xt.webgl[0]!.dispose).toHaveBeenCalled();
  const n = xt.terms.at(-1)!;
  expect(n).not.toBe(t);
  expect(n.open).toHaveBeenCalledWith(s.host);
  expect(n.write.mock.calls).toEqual([['hello'], [new Uint8Array([33])]]);
  expect(xt.webgl).toHaveLength(2);
  // Read-only survives: its cursor stays hidden.
  expect(n.options.theme).toMatchObject({ cursor: '#101112' });
  n.data[0]!('x');
  expect(input).not.toHaveBeenCalled();
  n.data[0]!('\x1b[2;3R');
  expect(input).toHaveBeenCalledWith('\x1b[2;3R');
  n.resized[0]!({ cols: 100, rows: 30 });
  expect(resize).toHaveBeenCalledWith(100, 30);
  // Written after: straight to the new one. Back in the same document: nothing re-made.
  s.write('more');
  expect(n.write).toHaveBeenLastCalledWith('more');
  s.adopt!(other);
  expect(xt.terms.at(-1)).toBe(n);
});

it('adopt replays only the last REPLAY_MAX bytes of the output', () => {
  const { s } = surface();
  const chunk = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 6; i++) s.write(chunk);
  s.adopt!(document.implementation.createHTMLDocument('popout'));
  const replayed = xt.terms.at(-1)!.write.mock.calls.reduce((n, [b]) => n + (b as string).length, 0);
  expect(replayed).toBe(REPLAY_MAX);
});

it('placeSurface puts the element alone in its place and lets it adopt that document', () => {
  const { s } = surface();
  const adopt = vi.spyOn(s, 'adopt');
  const el = document.createElement('div');
  el.append(document.createElement('span'));
  placeSurface(s, el);
  expect([...el.children]).toEqual([s.host]);
  expect(adopt).toHaveBeenCalledWith(document);
});
