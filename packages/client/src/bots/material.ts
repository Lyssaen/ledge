export type Material = 'signal' | 'pebble';

/** Material follows the theme: Signal for dark, Galet (pebble) for light. There is no independent picker. */
export function materialFor(theme: 'dark' | 'light'): Material {
  return theme === 'dark' ? 'signal' : 'pebble';
}
