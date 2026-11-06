import { createContext, useContext, useEffect, useRef } from 'react';
import { useTabPlace } from '../workspace/tabPlace';

/** Une touche pour l'écran affiché ; true = prise (l'écouteur appelle alors preventDefault). */
export type ScreenKeyHandler = (e: KeyboardEvent) => boolean;
export interface ScreenKeys { current: ScreenKeyHandler | null }
export const ScreenKeysContext = createContext<ScreenKeys>({ current: null });

/** Inscrit l'écran tant qu'il est monté ; la dernière version du gestionnaire est toujours appelée.
 *  Dans un onglet de l'IDE, les onglets cachés restent montés : seul l'onglet actif (visible, groupe focalisé) s'inscrit,
 *  et il se réinscrit chaque fois qu'il le redevient. */
export function useScreenKeys(handler: ScreenKeyHandler): void {
  const keys = useContext(ScreenKeysContext);
  const place = useTabPlace();
  const on = place ? place.active : true;
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!on) return;
    const mine: ScreenKeyHandler = e => latest.current(e);
    keys.current = mine;
    return () => { if (keys.current === mine) keys.current = null; };
  }, [keys, on]);
}
