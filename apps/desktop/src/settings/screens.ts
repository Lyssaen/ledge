import { useEffect, useState } from 'react';
import { isTauri } from '../tauri/bridge';

/** A screen the island can sit on: its size in physical px (as the hint says it) and its logical height (what Auto reads). */
export interface IslandScreen { width: number; height: number; logicalHeight: number }
/** The primary screen, and the first other one (the island's « second »), null when there is none. */
export interface IslandScreens { primary: IslandScreen; second: IslandScreen | null }

/** The mockup's two screens (settings.tsx, IslandPreview): what the browser shows, where no monitor can be read, and the app until it has read them. */
export const MOCKUP_SCREENS: IslandScreens = {
  primary: { width: 2560, height: 1440, logicalHeight: 1440 },
  second: { width: 1920, height: 1080, logicalHeight: 1080 }
};

/** Reads the monitors through Tauri; null when it cannot (the browser, a refusal). */
export async function readScreens(): Promise<IslandScreens | null> {
  if (!isTauri()) return null;
  try {
    const { availableMonitors, primaryMonitor } = await import('@tauri-apps/api/window');
    const [all, main] = await Promise.all([availableMonitors(), primaryMonitor()]);
    const first = main ?? all[0];
    if (!first) return null;
    const same = (m: typeof first) => m.position.x === first.position.x && m.position.y === first.position.y;
    const other = all.find(m => !same(m));
    const of = (m: typeof first): IslandScreen => ({ width: m.size.width, height: m.size.height, logicalHeight: m.size.height / (m.scaleFactor || 1) });
    return { primary: of(first), second: other ? of(other) : null };
  } catch { return null; }
}

/** The screens, read once per mount: the mockup's until (or unless) Tauri answers. */
export function useIslandScreens(): IslandScreens {
  const [screens, setScreens] = useState<IslandScreens>(MOCKUP_SCREENS);
  useEffect(() => {
    let live = true;
    void readScreens().then(s => { if (live && s) setScreens(s); });
    return () => { live = false; };
  }, []);
  return screens;
}
