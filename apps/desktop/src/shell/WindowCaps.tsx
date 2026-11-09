import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/lang';
import { closeWindow, isWindowMaximized, minimizeWindow, onWindowResized, toggleMaximizeWindow } from '../tauri/bridge';

/** Whether the window is maximised, kept fresh by each resize (maximising and restoring resize it). */
function useMaximized(label?: string): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => { void isWindowMaximized(label).then(m => { if (live) setMaximized(m); }); };
    refresh();
    const off = onWindowResized(refresh, label);
    return () => { live = false; off(); };
  }, [label]);
  return maximized;
}

/** The window buttons of a Ledge window bar (the native bar is off): minimise, maximise or restore, close. They act on the
 *  current window, or the window `label` names (a detached IDE window, lot 9); `onClose` replaces the plain close, and
 *  `closeTitle` its tip. */
export function WindowCaps({ onClose = closeWindow, label, closeTitle }: { onClose?: () => void; label?: string; closeTitle?: string }) {
  const { t } = useI18n();
  const maximized = useMaximized(label);
  return (
    <div className="titlebar-caps">
      <button aria-label={t.titlebar.minimize} title={t.titlebar.minimize} onClick={() => minimizeWindow(label)}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
      </button>
      <button aria-label={maximized ? t.titlebar.restore : t.titlebar.maximize} title={maximized ? t.titlebar.restore : t.titlebar.maximize} onClick={() => toggleMaximizeWindow(label)}>
        {maximized
          ? <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
          : <svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" rx="1" /></svg>}
      </button>
      <button className="close" aria-label={t.titlebar.close} title={closeTitle ?? t.titlebar.close} onClick={() => onClose()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M.5.5l9 9M9.5.5l-9 9" /></svg>
      </button>
    </div>
  );
}
