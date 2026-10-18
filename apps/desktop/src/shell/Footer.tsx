import type { IslandPrefs } from '@ledge/protocol';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';

/** The overview's footer: local and SSH sessions and the island's state (« Island active » / « Island hidden », which opens
 *  Settings › Island; shown once the local daemon has spoken of it, null being its defaults: shown), then the Ctrl K, / and ? reminders. */
export function Footer({ dispatch, localDown, island }: { dispatch: (a: NavAction) => void; localDown: boolean; island: IslandPrefs | null | undefined }) {
  const { t } = useI18n();
  const visible = island?.visible ?? true;
  return (
    <footer className="workspace-footer" role="contentinfo">
      <div className="footer-status">
        <span><i className={localDown ? 'connection-dot off' : 'connection-dot'} />{t.foot.sessions}</span>
        {island !== undefined && (
          <button className={visible ? 'overlay-state' : 'overlay-state off'} title={t.foot.islandTitle} onClick={() => dispatch({ type: 'settings', section: 'island' })}>
            <i />{visible ? t.foot.islandOn : t.foot.islandOff}
          </button>
        )}
      </div>
      <div className="keyboard-footer">
        <button onClick={() => dispatch({ type: 'modal', modal: { kind: 'search' } })}><Kbd>Ctrl K</Kbd> {t.foot.search}</button>
        <button onClick={() => dispatch({ type: 'chat', open: true })}><Kbd>/</Kbd> {t.foot.chat}</button>
        <button onClick={() => dispatch({ type: 'modal', modal: { kind: 'shortcuts' } })}><Kbd>?</Kbd> {t.foot.shortcuts}</button>
      </div>
    </footer>
  );
}
