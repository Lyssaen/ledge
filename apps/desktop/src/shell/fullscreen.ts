import { isTauri } from '../tauri/bridge';

/** Puts the window in or out of full screen: the native window in Tauri, the page (Fullscreen API) in a browser.
 *  Never throws: a refusal leaves the window as it was. */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(on);
    } else if (on) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* refused or unsupported */ }
}
