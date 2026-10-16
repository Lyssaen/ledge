import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';

/** The overview's footer: local and SSH sessions, then the Ctrl K, / and ? reminders. The island state comes with the island. */
export function Footer({ dispatch }: { dispatch: (a: NavAction) => void }) {
  const { t } = useI18n();
  return (
    <footer className="workspace-footer" role="contentinfo">
      <div className="footer-status">
        <span><i className="connection-dot" />{t.foot.sessions}</span>
      </div>
      <div className="keyboard-footer">
        <button onClick={() => dispatch({ type: 'modal', modal: 'search' })}><Kbd>Ctrl K</Kbd> {t.foot.search}</button>
        <button onClick={() => dispatch({ type: 'chat', open: true })}><Kbd>/</Kbd> {t.foot.chat}</button>
        <button onClick={() => dispatch({ type: 'modal', modal: 'shortcuts' })}><Kbd>?</Kbd> {t.foot.shortcuts}</button>
      </div>
    </footer>
  );
}
