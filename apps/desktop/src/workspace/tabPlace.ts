import { createContext, useContext } from 'react';

/** What a tab's content knows of its place. `active` = visible in the focused group: the only tab that may take a window-unique resource. */
export interface TabPlace { key: string; group: string; visible: boolean; active: boolean }
/** null outside the IDE. */
export const TabPlaceContext = createContext<TabPlace | null>(null);
export function useTabPlace(): TabPlace | null { return useContext(TabPlaceContext); }
