import type { ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import '../styles/ide.css';

/** The IDE's status bar (mockup `statusbar()`): the existing footer's status on the left, then the waiting requests' button,
 *  a spacer, and the harnesses' limits at the far right (their detail opens above them, right-aligned). */
export function IdeStatusBar({ footer, usage, waiting, onNextWaiting, prs }: { footer: ReactNode; usage?: ReactNode; waiting: readonly Session[]; onNextWaiting(): void; /** The MR and PR count (lot 8b), after the waiting requests. */ prs?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="ide-status">
      {footer}
      {waiting.length > 0 && <button className="ide-status-wait" onClick={onNextWaiting}>{t.ide.waiting(waiting.length)}</button>}
      {prs}
      <span className="ide-status-sp" />
      {usage}
    </div>
  );
}
