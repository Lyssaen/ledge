import { useEffect, useState } from 'react';
import { isTauri } from '../tauri/bridge';

/** A screen the island can sit on: the Screen setting's value for it (`primary`, else the monitor's id as the shell names it:
 *  the OS name, `#index` without one), its place in the OS order from 1, its size in physical px (as the hint says it) and
 *  its logical height (what Auto reads). */
export interface IslandScreen { id: string; n: number; primary: boolean; width: number; height: number; logicalHeight: number }

/** The mockup's two screens (settings.tsx, IslandPreview): what the browser shows, where no monitor can be read, and the app until it has read them. */
export const MOCKUP_SCREENS: readonly IslandScreen[] = [
  { id: 'primary', n: 1, primary: true, width: 2560, height: 1440, logicalHeight: 1440 },
  { id: '#1', n: 2, primary: false, width: 1920, height: 1080, logicalHeight: 1080 }
];

/** Reads the monitors through Tauri, the primary first, the others in the OS order; null when it cannot (the browser, a refusal). */
export async function readScreens(): Promise<IslandScreen[] | null> {
  if (!isTauri()) return null;
  try {
    const { availableMonitors, primaryMonitor } = await import('@tauri-apps/api/window');
    const [all, main] = await Promise.all([availableMonitors(), primaryMonitor()]);
    if (!all.length) return null;
    const at = main ? all.findIndex(m => m.position.x === main.position.x && m.position.y === main.position.y) : -1;
    const primary = at < 0 ? 0 : at;
    const screens = all.map((m, i): IslandScreen => ({
      id: i === primary ? 'primary' : m.name ?? `#${i}`, n: i + 1, primary: i === primary,
      width: m.size.width, height: m.size.height, logicalHeight: m.size.height / (m.scaleFactor || 1)
    }));
    return [screens[primary]!, ...screens.filter(s => !s.primary)];
  } catch { return null; }
}

/** The value of the Screen setting among `screens`: an older `second` is the first screen that is not the primary (none: the
 *  primary); any other value is kept, listed or not (a monitor that is unplugged). */
export function screenValue(screen: string, screens: readonly IslandScreen[]): string {
  return screen === 'second' ? screens.find(s => !s.primary)?.id ?? 'primary' : screen;
}

/** The screen the island sits on: the chosen one while it is listed, else the primary (as the shell falls back). */
export function screenHere(value: string, screens: readonly IslandScreen[]): IslandScreen {
  return screens.find(s => s.id === value) ?? screens.find(s => s.primary) ?? screens[0]!;
}

/** The screens, read once per mount: the mockup's until (or unless) Tauri answers. */
export function useIslandScreens(): readonly IslandScreen[] {
  const [screens, setScreens] = useState<readonly IslandScreen[]>(MOCKUP_SCREENS);
  useEffect(() => {
    let live = true;
    void readScreens().then(s => { if (live && s) setScreens(s); });
    return () => { live = false; };
  }, []);
  return screens;
}
