import type { JSX } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import type { Tab } from '../workspace/model';

/** A tab's right-click menu (mockup `tabctx`). A session or seat names itself and offers the view toggle (`onView` absent
 *  when it has no terminal to switch to); every tab offers « Fermer l'onglet », and « Fermer les autres » when others share its group. */
export function TabMenu(p: { at: { x: number; y: number }; tab: Tab; name: string; terminal: boolean; others: boolean; onView?: () => void; onClose(): void; onCloseOthers(): void; onDismiss(): void }): JSX.Element {
  const { t } = useI18n();
  const agent = p.tab.kind === 'session' || p.tab.kind === 'seat';
  return (
    <Menu open onOpenChange={o => { if (!o) p.onDismiss(); }} label={`${t.ide.tabMenu} · ${p.name}`} className="session-menu-wrap" menuClassName="session-menu" at={p.at} trigger={() => null}>
      {agent && <div className="session-menu-head"><strong>{p.name}</strong></div>}
      {agent && p.onView && (
        <MenuItem onSelect={p.onView}>
          <span><Icon d={SHELL_ICONS.terminal} size={14} />{p.terminal ? t.ide.toThread : t.ide.toTerminal}</span>
          <small aria-hidden="true"><Kbd>{t.ide.viewKey}</Kbd></small>
        </MenuItem>
      )}
      {agent && p.onView && <hr />}
      <MenuItem onSelect={p.onClose}><span>{t.ide.closeThisTab}</span></MenuItem>
      {p.others && <MenuItem onSelect={p.onCloseOthers}><span>{t.ide.closeOthers}</span></MenuItem>}
    </Menu>
  );
}
