import { createContext, useContext, useEffect, useRef } from 'react';

/** Une touche pour l'écran affiché ; true = prise (l'écouteur appelle alors preventDefault). */
export type ScreenKeyHandler = (e: KeyboardEvent) => boolean;
export interface ScreenKeys { current: ScreenKeyHandler | null }
export const ScreenKeysContext = createContext<ScreenKeys>({ current: null });

/** Inscrit l'écran tant qu'il est monté ; la dernière version du gestionnaire est toujours appelée. */
export function useScreenKeys(handler: ScreenKeyHandler): void {
  const keys = useContext(ScreenKeysContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const mine: ScreenKeyHandler = e => latest.current(e);
    keys.current = mine;
    return () => { if (keys.current === mine) keys.current = null; };
  }, [keys]);
}
