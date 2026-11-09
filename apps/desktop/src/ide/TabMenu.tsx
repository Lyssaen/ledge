import type { JSX } from 'react';
import type { Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { cls } from '../shell/cls';
import type { Tab } from '../workspace/model';
import { tagLabel, type SynapseTags } from '../session/markers';
import { reliefDone, reliefText } from '../session/relief';
import { useBackquote } from '../term/keys';

export interface TabMenuProps {
  at: { x: number; y: number }; tab: Tab; name: string; terminal: boolean; others: boolean;
  /** The tab's session, for a session or seat tab: its relief, under way or failed (a line) or done (an entry), and the one it relieves. */
  session?: Session;
  /** The Story / Objectif its shown thread leaves (the page's, published to the menu): lines under the header. */
  tags?: SynapseTags | null;
  onView?: () => void;
  /** « Ouvrir dans un terminal externe », present when the external terminal applies (the page's condition). */
  onExternal?: () => void;
  /** Opens another session: the relief, or the one relieved. */
  onOpenSession?(id: string): void;
  /** « Diviser à droite »; absent in a detached window (v27: one group there). */
  onSplit?(): void; onClose(): void; onCloseOthers(): void; onDismiss(): void;
}

/** A tab's right-click menu (mockup `tabctx`). A session or seat names itself and offers the view toggle (`onView` absent
 *  when it has no terminal to switch to); every tab offers « Diviser à droite » (Ctrl \), « Fermer l'onglet », and « Fermer les autres » when others share its group.
 *  An IDE session tab has no heading row (lot 3, option A): what it said that the bar does not is here, a relief under way
 *  and the Story / Objectif as lines under the name, the external terminal and the relief's sessions as entries. */
export function TabMenu(p: TabMenuProps): JSX.Element {
  const { t } = useI18n();
  // The focus key as the layout prints it (² on AZERTY), as the agent screen's footer and the shortcuts help say it.
  const backquote = useBackquote();
  const agent = p.tab.kind === 'session' || p.tab.kind === 'seat';
  const th = t.session.thread;
  const h = agent ? p.session?.handover : undefined;
  const relieves = agent ? p.session?.relieves : undefined;
  const tags = agent ? p.tags ?? null : null;
  const open = (id: string) => () => p.onOpenSession?.(id);
  const entries = agent && (!!p.onExternal || (h && reliefDone(h)) || !!relieves);
  return (
    <Menu open onOpenChange={o => { if (!o) p.onDismiss(); }} label={`${t.ide.tabMenu} · ${p.name}`} className="session-menu-wrap" menuClassName="session-menu" at={p.at} trigger={() => null}>
      {agent && (
        <div className="session-menu-head">
          <strong>{p.name}</strong>
          {h && !reliefDone(h) && <small className={cls(h.state === 'failed' && 'failed')}>{reliefText(h, t.handover)}</small>}
          {tags?.story !== undefined && <small>{t.ide.tagLine(th.tags.story, tagLabel(tags.story, th.tagValues))}</small>}
          {tags?.objectif !== undefined && <small>{t.ide.tagLine(th.tags.objectif, tagLabel(tags.objectif, th.tagValues))}</small>}
        </div>
      )}
      {agent && p.onView && (
        <MenuItem onSelect={p.onView}>
          <span><Icon d={SHELL_ICONS.terminal} size={14} />{p.terminal ? t.ide.toThread : t.ide.toTerminal}</span>
          <small aria-hidden="true"><Kbd>{t.ide.viewKey(backquote)}</Kbd></small>
        </MenuItem>
      )}
      {agent && p.onExternal && <MenuItem onSelect={p.onExternal}><span><Icon d={ICONS.external.d} size={14} />{t.session.terminal.external}</span></MenuItem>}
      {agent && h && reliefDone(h) && <MenuItem onSelect={open(h.to)}><span>{t.ide.relievedByEntry(h.toName ?? '')}</span></MenuItem>}
      {agent && relieves && <MenuItem onSelect={open(relieves.id)}><span>{t.ide.relievesEntry(relieves.name)}</span></MenuItem>}
      {agent && (p.onView || entries) && <hr />}
      {p.onSplit && (
        <MenuItem onSelect={p.onSplit}>
          <span><Icon d={SHELL_ICONS.split} size={14} />{t.ide.split}</span>
          <small aria-hidden="true"><Kbd>{t.ide.splitKey}</Kbd></small>
        </MenuItem>
      )}
      <MenuItem onSelect={p.onClose}><span>{t.ide.closeThisTab}</span></MenuItem>
      {p.others && <MenuItem onSelect={p.onCloseOthers}><span>{t.ide.closeOthers}</span></MenuItem>}
    </Menu>
  );
}
