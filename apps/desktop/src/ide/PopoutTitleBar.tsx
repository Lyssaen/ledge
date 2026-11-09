import type { MouseEvent } from 'react';
import { useI18n } from '../i18n/lang';
import { startDraggingWindow, toggleMaximizeWindow } from '../tauri/bridge';
import { LedgeMark } from '../shell/LedgeMark';
import { WindowCaps } from '../shell/WindowCaps';
import '../styles/ide.css';

/** A detached window's bar (v27, docs/ide-workspace.md « Fenêtres détachées »; mockup `win2()`): the main one's without the
 *  search nor the panel toggles. The Ledge mark, the active tab's name in the middle, the window buttons acting on this
 *  window (`label`, its Tauri label); its ✕ gives the tabs back to the main window (`onClose`). A left press on the bar outside its
 *  buttons moves this window, a double press maximises or restores it. No `data-tauri-drag-region`: Tauri's drag.js never runs in
 *  a popout's page (only in its initial about:blank), and were it to run one day, a double press would act twice. */
export function PopoutTitleBar({ name, label, onClose }: { name: string; label: string | null; onClose(): void }) {
  const { t } = useI18n();
  const press = (e: MouseEvent) => {
    if (e.button !== 0 || !label || (e.target as Element).closest('button, a, input, [role="button"]')) return;
    if (e.detail === 2) toggleMaximizeWindow(label);
    else if (e.detail === 1) startDraggingWindow(label);
  };
  return (
    <div className="ide-titlebar ide-popout-bar" role="group" aria-label={t.titlebar.label} onMouseDown={press}>
      <span className="ide-brand" data-brand><LedgeMark size={16} />{t.ide.brand}</span>
      <span className="ide-wtitle">{name}</span>
      <WindowCaps label={label ?? undefined} onClose={onClose} closeTitle={t.ide.windows.closeTip} />
    </div>
  );
}
