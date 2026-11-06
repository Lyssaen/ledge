import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { SHELL_ICONS } from '../shell/icons';
import { WindowCaps } from '../shell/WindowCaps';
import type { IdeLayout, LayoutAction } from '../workspace/layout';
import '../styles/ide.css';

/** The IDE's window bar (mockup `titlebar()`): the word mark, the palette's field, the three panel toggles, the window buttons.
 *  The bar and its gaps are the drag region, as `TitleBar`'s. */
export function IdeTitleBar({ layout, onLayout, onSearch, blocked }: { layout: IdeLayout; onLayout(a: LayoutAction): void; onSearch(): void; blocked: boolean }) {
  const { t } = useI18n();
  const drag = { 'data-tauri-drag-region': '' } as const;
  const toggle = (panel: 'side' | 'bottom' | 'right', on: boolean, label: string, d: readonly string[]) => (
    <button aria-label={label} title={label} aria-pressed={on} disabled={blocked} onClick={() => onLayout({ type: 'toggle', panel })}><Icon d={d} size={14} /></button>
  );
  return (
    <div className="ide-titlebar" role="group" aria-label={t.titlebar.label} {...drag}>
      <span className="ide-brand" data-brand {...drag}>{t.ide.brand}<span className="brand-dot">.</span></span>
      <button className="ide-search" disabled={blocked} onClick={onSearch}>
        <Icon d={SHELL_ICONS.search} size={13} />
        <span className="ide-search-text">{t.ide.searchPlaceholder}</span>
        <span className="ide-kbd">{t.ide.searchKey}</span>
      </button>
      <div className="ide-toggles">
        {toggle('side', layout.sideOpen, t.ide.sideToggle, SHELL_ICONS.panelLeft)}
        {toggle('bottom', layout.bottom, t.ide.bottomToggle, SHELL_ICONS.panelBottom)}
        {toggle('right', layout.right, t.ide.rightToggle, SHELL_ICONS.panelRight)}
      </div>
      <WindowCaps />
    </div>
  );
}
