import { useI18n } from '../i18n/lang';
import { LedgeMark } from '../shell/LedgeMark';
import { WindowCaps } from '../shell/WindowCaps';
import '../styles/ide.css';

/** A detached window's bar (v27, docs/ide-workspace.md « Fenêtres détachées »; mockup `win2()`): the main one's without the
 *  search nor the panel toggles. The Ledge mark, the active tab's name in the middle, the window buttons acting on this
 *  window (`label`, its Tauri label); its ✕ gives the tabs back to the main window (`onClose`). The bar is the drag region. */
export function PopoutTitleBar({ name, label, onClose }: { name: string; label: string | null; onClose(): void }) {
  const { t } = useI18n();
  const drag = { 'data-tauri-drag-region': '' } as const;
  return (
    <div className="ide-titlebar ide-popout-bar" role="group" aria-label={t.titlebar.label} {...drag}>
      <span className="ide-brand" data-brand {...drag}><LedgeMark size={16} />{t.ide.brand}</span>
      <span className="ide-wtitle" {...drag}>{name}</span>
      <WindowCaps label={label ?? undefined} onClose={onClose} closeTitle={t.ide.windows.closeTip} />
    </div>
  );
}
