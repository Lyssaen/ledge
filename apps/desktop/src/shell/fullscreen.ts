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
      // Edge-triggered: only a true -> false change actually observed counts, and only the latest answer is heard
      // (an early resize while entering full screen reports false, and answers may arrive out of order).
      let was = false;
      let latest = 0;
      const un = await win.onResized(() => {
        const mine = ++latest;
        void win.isFullscreen().then(on => {
          if (mine !== latest || stopped) return;
          const left = was && !on;
          was = on;
          if (left) cb();
        }, () => {});
      });
      if (stopped) un(); else unlisten = un;
    } catch { /* no window API */ }
  })();
  return () => { stopped = true; unlisten?.(); unlisten = null; };
}
