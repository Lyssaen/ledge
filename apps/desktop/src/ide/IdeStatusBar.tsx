import type { ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import '../styles/ide.css';

/** The IDE's status bar (mockup `statusbar()`): the existing footer on the left, the waiting requests' button on the right. */
export function IdeStatusBar({ footer, waiting, onNextWaiting }: { footer: ReactNode; waiting: readonly Session[]; onNextWaiting(): void }) {
  const { t } = useI18n();
  return (
    <div className="ide-status">
      {footer}
      <span className="ide-status-sp" />
      {waiting.length > 0 && <button className="ide-status-wait" onClick={onNextWaiting}>{t.ide.waiting(waiting.length)}</button>}
    </div>
  );
}
