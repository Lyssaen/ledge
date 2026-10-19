import { useEffect, useRef } from 'react';
import { onFullscreenLeft, setWindowFullscreen } from './fullscreen';

/** The current window follows `on` (not at mount: nothing was asked yet), and `left` runs when it leaves full screen by
 *  itself (Escape in a browser, the OS), for the layout to follow. Each window has its own: the main one, the detached Atelier. */
export function useWindowFullscreen(on: boolean, left: () => void): void {
  const leftRef = useRef(left);
  leftRef.current = left;
  useEffect(() => onFullscreenLeft(() => leftRef.current()), []);
  const seen = useRef(on);
  useEffect(() => {
    if (seen.current === on) return;
    seen.current = on;
    void setWindowFullscreen(on);
  }, [on]);
}
