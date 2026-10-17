import { loadScale, resolveScale, saveScale, type UiScale } from '@ledge/ui/scale';
import { isTauri } from '../tauri/bridge';

/** The two native calls a scale needs; injected by the tests. */
export interface ZoomDeps { setZoom(factor: number): Promise<void>; screenHeight(): Promise<number | null> }

const tauriZoom: ZoomDeps = {
  async setZoom(factor) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    await getCurrentWebview().setZoom(factor);
  },
  async screenHeight() {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const m = await currentMonitor();
    return m ? m.size.height / m.scaleFactor : null;
  }
};
const nativeZoom = (): ZoomDeps | null => (isTauri() ? tauriZoom : null);

/** One scale for the whole window (`desktop.panelScale`, spec §7): Desktop has no handle, `desktop.handleScale` stays unused. */
export const loadUiScale = (): UiScale => loadScale('panel', 'desktop');

/** Zooms the WebView (spec §9.4). Auto follows the screen's logical height as the island's windows do (2160 px base).
 *  Returns the factor applied, or null outside the app or when the WebView refuses; never throws. */
export async function applyUiScale(setting: UiScale, deps: ZoomDeps | null = nativeZoom()): Promise<number | null> {
  if (!deps) return null;
  try {
    const h = setting === 'auto' ? await deps.screenHeight() : null;
    const factor = resolveScale(setting, h ?? 0, 'panel');
    await deps.setZoom(factor);
    applied = factor;
    return factor;
  } catch { return null; }
}

let applied: number | null = null;
/** The last factor applyUiScale applied (the start-up's, then each change's), null before any: Settings shows « Auto (125 %) » with it. */
export const appliedUiScale = (): number | null => applied;

export function saveUiScale(setting: UiScale, deps: ZoomDeps | null = nativeZoom()): Promise<number | null> {
  saveScale('panel', setting, 'desktop');
  return applyUiScale(setting, deps);
}
