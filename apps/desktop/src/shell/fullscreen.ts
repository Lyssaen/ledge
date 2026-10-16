import { isTauri } from '../tauri/bridge';

/** True once an answer of the window said « full screen » and the way out has not been seen yet (shared by both functions). */
let armed = false;

/** Puts the window in or out of full screen: the native window in Tauri, the page (Fullscreen API) in a browser.
 *  Never throws: a refusal leaves the window as it was. */
export async function setWindowFullscreen(on: boolean): Promise<void> {
  try {
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.setFullscreen(on);
      // Some window managers send no resize after the flip: seed the edge of onFullscreenLeft from the window itself.
      if (on) armed ||= await win.isFullscreen(); else armed = false;
    } else if (on) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch { /* refused or unsupported */ }
}

/** Appelle `cb` quand la fenêtre quitte le plein écran d'elle-même : `fullscreenchange` sans élément dans un navigateur,
 *  `onResized` puis `isFullscreen() === false` dans Tauri. Renvoie la désinscription, sûre même avant la fin de l'inscription Tauri. */
export function onFullscreenLeft(cb: () => void): () => void {
  if (!isTauri()) {
    const onChange = () => { if (!document.fullscreenElement) cb(); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      // Edge-triggered: every answer arms the edge (a stale `true` included), only the latest answer can fire it,
      // and an early resize while entering full screen (false) fires nothing as long as nothing was armed.
      let latest = 0;
      const un = await win.onResized(() => {
        const mine = ++latest;
        void win.isFullscreen().then(on => {
          if (stopped) return;
          if (on) armed = true;
          else if (mine === latest && armed) { armed = false; cb(); }
        }, () => {});
      });
      if (stopped) un(); else unlisten = un;
    } catch { /* no window API */ }
  })();
  return () => { stopped = true; unlisten?.(); unlisten = null; };
}
