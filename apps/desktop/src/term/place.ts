import type { TermSurface } from './surface';

/** Puts a terminal's element in `el`, alone, in whichever window `el` is: the xterm moves in, never re-made, unless `el` is
 *  in another window's document (a popout), where it is made again with the end of its output (`adopt`). */
export function placeSurface(surface: TermSurface, el: HTMLElement): void {
  for (const c of [...el.children]) if (c !== surface.host) c.remove();
  if (surface.host.parentElement !== el) el.appendChild(surface.host);
  surface.adopt?.(el.ownerDocument);
}
