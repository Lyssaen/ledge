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
    osc = new Map<number, (d: string) => boolean>();
    csi = new Map<string, (p: (number | number[])[]) => boolean>();
    parser = {
      registerOscHandler: (n: number, fn: (d: string) => boolean) => { this.osc.set(n, fn); return { dispose() {} }; },
      registerCsiHandler: (id: { prefix?: string; final: string }, fn: (p: (number | number[])[]) => boolean) => { this.csi.set(`${id.prefix ?? ''}${id.final}`, fn); return { dispose() {} }; }
    };
    constructor(o: Record<string, unknown>) { this.options = { ...o }; terms.push(this); }
    attachCustomKeyEventHandler(fn: (e: KeyboardEvent) => boolean) { this.keys = fn; }
    onData(fn: (d: string) => void) { this.data.push(fn); return { dispose() {} }; }
    onResize() { return { dispose() {} }; }
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

import { createSurface } from '../src/term/surface';

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

it('WebGL falls back to the DOM renderer when it throws or loses its context', () => {
  xt.webglThrows = true;
  expect(() => surface()).not.toThrow();
  xt.webglThrows = false;
  surface();
  expect(xt.webgl).toHaveLength(1);
  xt.contextLost[0]!();
  expect(xt.webgl[0]!.dispose).toHaveBeenCalled();
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

it('read-only: the program\'s mouse is held back so a plain drag selects, and given back when keys come back', () => {
  const { s, t } = surface();
  const h = t.csi.get('?h')!, l = t.csi.get('?l')!;
  // Live: the program's mouse goes through untouched.
  expect(h([1003, 1006])).toBe(false);
  s.setReadOnly(true);
  expect(t.write).toHaveBeenLastCalledWith('\x1b[?9;1000;1001;1002;1003l');
  // Our own « off » is not the program's: its 1003 stays remembered.
  expect(l([9, 1000, 1001, 1002, 1003])).toBe(false);
  // Read-only, a repaint asking for the mouse: swallowed, the rest (SGR encoding) still applied.
  t.write.mockClear();
  expect(h([1002, 1006])).toBe(true);
  expect(t.write).toHaveBeenCalledWith('\x1b[?1006h');
  expect(h([25])).toBe(false);
  // The program drops 1002 while read-only; keys back: only what it still wants comes back.
  l([1002]);
  t.write.mockClear();
  s.setReadOnly(false);
  expect(t.write).toHaveBeenCalledWith('\x1b[?1003h');
  // Setting the same mode twice changes nothing.
  t.write.mockClear();
  s.setReadOnly(false);
  expect(t.write).not.toHaveBeenCalled();
});
