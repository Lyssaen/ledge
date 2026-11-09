import type { ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import '../styles/ide.css';

/** The IDE's status bar (mockup `statusbar()`): the existing footer's status on the left, then the waiting requests' button,
 *  a spacer, the harnesses' limits (their detail opens above them, right-aligned), and the disposition at the far right. */
export function IdeStatusBar({ footer, usage, waiting, onNextWaiting, prs, disposition }: { footer: ReactNode; usage?: ReactNode; waiting: readonly Session[]; onNextWaiting(): void; /** The MR and PR count (lot 8b), after the waiting requests. */ prs?: ReactNode; /** « Dispositions », after the limits. */ disposition?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="ide-status">
      {footer}
      {waiting.length > 0 && <button className="ide-status-wait" onClick={onNextWaiting}>{t.ide.waiting(waiting.length)}</button>}
      {prs}
      <span className="ide-status-sp" />
      {usage}
      {disposition}
    </div>
  );
}
