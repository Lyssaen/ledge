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
  expect(t.options.disableStdin).toBe(true);
  expect(t.options.theme).toMatchObject({ background: '#101112', cursor: '#101112' });
  t.data.forEach(fn => fn('x'));
  t.keys(key({ ctrlKey: true, code: 'KeyV', key: 'v' }));
  await Promise.resolve(); await Promise.resolve();
  expect(input).not.toHaveBeenCalled();
  expect(clip.readText).not.toHaveBeenCalled();
  s.setTheme({ background: '#202122' });
  expect(t.options.theme).toMatchObject({ background: '#202122', cursor: '#202122' });
  s.setReadOnly(false);
  expect(t.options.disableStdin).toBe(false);
  expect(t.options.theme).toEqual({ background: '#202122' });
  t.data.forEach(fn => fn('x'));
  expect(input).toHaveBeenCalledWith('x');
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
