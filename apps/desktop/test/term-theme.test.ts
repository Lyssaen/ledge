import { afterEach, expect, it, vi } from 'vitest';
import { termTheme } from '../src/term/theme';

const style = (tokens: Record<string, string>) => ({ getPropertyValue: (n: string) => tokens[n] ?? '' });
afterEach(() => { vi.restoreAllMocks(); });

it('the theme comes from the tokens', () => {
  const s = { getPropertyValue: (n: string) => ({ '--term-bg': '#101112', '--term-fg': '#eee', '--term-ansi-1': '#c33' } as Record<string, string>)[n] ?? '' };
  expect(termTheme(s)).toMatchObject({ background: '#101112', foreground: '#eee', red: '#c33' });
});

it('every slot reads its own token; a missing one leaves xterm its default', () => {
  const t = termTheme(style({ '--term-fg': ' #fafafa', '--term-ansi-15': '#ffffff', '--term-cursor': '#abcdef', '--term-selection': 'rgba(1, 2, 3, 0.4)' }));
  expect(t).toMatchObject({ foreground: '#fafafa', brightWhite: '#ffffff', cursor: '#abcdef', selectionBackground: 'rgba(1, 2, 3, 0.4)' });
  expect(t.black).toBeUndefined();
  expect(t.background).toBeUndefined();
});

it('a colour xterm cannot parse, such as oklch, is resolved by the browser to hex', () => {
  const ctx = { fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([247, 247, 247, 255]) })) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  expect(termTheme(style({ '--term-bg': 'oklch(0.97 0 0)' })).background).toBe('#f7f7f7');
  ctx.getImageData.mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 51]) });
  expect(termTheme(style({ '--term-selection': 'oklch(0 0 0 / 0.2)' })).selectionBackground).toBe('#00000033');
});
