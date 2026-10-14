/** True when the app runs from the home screen (iOS `navigator.standalone`, or the display-mode media query). */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches);
}
