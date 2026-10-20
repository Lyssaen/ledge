import { afterEach, expect, it } from 'vitest';
import { backquoteLabel, termKey } from '../src/term/keys';

const k = (o: Partial<KeyboardEvent>) => ({ type: 'keydown', code: '', key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
afterEach(() => { delete (navigator as unknown as Record<string, unknown>).keyboard; });

it('Ctrl + the key left of 1 gives the keyboard back, on any layout', () => {
  expect(termKey(k({ ctrlKey: true, code: 'Backquote', key: '²' }), false)).toBe('thread');
});
it('Ctrl C copies a selection, else interrupts; Ctrl Shift C always copies', () => {
  expect(termKey(k({ ctrlKey: true, code: 'KeyC', key: 'c' }), true)).toBe('copy');
  expect(termKey(k({ ctrlKey: true, code: 'KeyC', key: 'c' }), false)).toBe('pass');
  expect(termKey(k({ ctrlKey: true, shiftKey: true, code: 'KeyC', key: 'C' }), false)).toBe('copy');
});
it('Ctrl V and Ctrl Shift V paste; Ctrl K, Escape and the rest go to the terminal', () => {
  expect(termKey(k({ ctrlKey: true, code: 'KeyV', key: 'v' }), false)).toBe('paste');
  expect(termKey(k({ ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' }), false)).toBe('paste');
  for (const e of [k({ ctrlKey: true, code: 'KeyK', key: 'k' }), k({ code: 'Escape', key: 'Escape' }), k({ ctrlKey: true, code: 'KeyR', key: 'r' })]) expect(termKey(e, false)).toBe('pass');
});
it('AltGr (Ctrl Alt on Windows) and key releases go to the terminal', () => {
  expect(termKey(k({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' }), false)).toBe('pass');
  expect(termKey(k({ ctrlKey: true, altKey: true, code: 'Backquote', key: '`' }), false)).toBe('pass');
  expect(termKey(k({ type: 'keyup', ctrlKey: true, code: 'KeyV', key: 'v' }), false)).toBe('pass');
});
it('the focus key is labelled by the keyboard layout, else a backquote', async () => {
  expect(await backquoteLabel()).toBe('`');
  (navigator as unknown as Record<string, unknown>).keyboard = { getLayoutMap: async () => new Map([['Backquote', '²']]) };
  expect(await backquoteLabel()).toBe('²');
  (navigator as unknown as Record<string, unknown>).keyboard = { getLayoutMap: async () => { throw new Error('denied'); } };
  expect(await backquoteLabel()).toBe('`');
});
