import { createContext, useContext, useEffect, useRef } from 'react';

/** Something open in a section that Escape closes (a form, a confirmation, a field being edited): true = taken. */
export type EscapeLayer = () => boolean;
export interface EscapeLayers { list: EscapeLayer[] }
export const EscapeLayersContext = createContext<EscapeLayers>({ list: [] });

/** Registers a section's layer while it is mounted (its latest version is always the one called). The Settings page offers
 *  Escape to the layers, the last registered first, before it lets Escape go back. */
export function useEscapeLayer(layer: EscapeLayer): void {
  const layers = useContext(EscapeLayersContext);
  const latest = useRef(layer);
  latest.current = layer;
  useEffect(() => {
    const mine: EscapeLayer = () => latest.current();
    layers.list.push(mine);
    return () => { const i = layers.list.indexOf(mine); if (i >= 0) layers.list.splice(i, 1); };
  }, [layers]);
}

/** Offers Escape to the layers, innermost (last registered) first: true when one took it. */
export const escapeLayers = (layers: EscapeLayers): boolean => [...layers.list].reverse().some(l => l());
