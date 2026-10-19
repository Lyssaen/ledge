import type { JSX } from 'react';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import { Button } from '@ledge/ui/ui/Button';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import { openUrl } from '../tauri/bridge';
import { releaseUrl, RELEASES_URL } from './notes';
import { updater } from './store';
import { closeWhatsNew, useWhatsNew } from './whatsNewView';

/** The « What's new » panel (#26): the release notes, in French as the tags carry them, read as Markdown (HTML never parsed);
 *  the GitHub release; the releases passed over when the update skipped some (the manifest carries only the last one's notes).
 *  A release on offer adds Update and Later. */
export function WhatsNew(): JSX.Element | null {
  const { t } = useI18n();
  const c = t.whatsNew;
  const v = useWhatsNew();
  if (!v) return null;
  const title = v.mode === 'updated' ? c.updated(v.version) : c.title(v.version);
  return (
    <Modal title={title} className="confirm-modal whats-new" onClose={closeWhatsNew}>
      <div className="confirm-content">
        {v.notes ? <div className="whats-new-notes"><ThreadMarkdown text={v.notes} /></div> : <p>{c.none}</p>}
        {v.skipped && v.from && <p className="confirm-extra">{c.skipped(v.from)}</p>}
        <div className="whats-new-links">
          <Button variant="ghost" size="sm" onClick={() => openUrl(releaseUrl(v.version))}>{c.release}</Button>
          {(v.skipped || v.mode === 'available') && <Button variant="ghost" size="sm" onClick={() => openUrl(RELEASES_URL)}>{c.all}</Button>}
        </div>
        {/* Otherwise the title's « Close » is the way out. */}
        {v.mode === 'available' && (
          <div className="confirm-actions">
            <Button autoFocus onClick={closeWhatsNew}>{c.later}</Button>
            <Button variant="primary" onClick={() => { closeWhatsNew(); void updater.install(); }}>{c.update}</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
