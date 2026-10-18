import { Button } from '@ledge/ui/ui/Button';
import { useId } from 'react';
import { useI18n } from '../i18n/lang';
import { Modal } from '../shell/Modal';
import type { Confirm } from './useSessionActions';

/** Ending and deleting are irreversible, and archiving a session that still works ends it: each asks first, in an alertdialog (Escape and the backdrop cancel; Annuler has the focus). */
export function ConfirmDialog({ c, onConfirm, onCancel }: { c: Confirm; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const m = t.manage.confirm;
  const body = useId();
  const text = c.kind === 'end' ? m.body.end(c.names) : c.kind === 'archive' ? m.body.archive(c.names, c.live) : m.body.delete(c.names, c.live, c.archived);
  return (
    <Modal title={m.title[c.kind](c.names)} role="alertdialog" describedBy={body} className="confirm-modal" onClose={onCancel}>
      <div className="confirm-content" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
        <p id={body}>{text}</p>
        {c.kids > 0 && <p className="confirm-extra">{m.kids(c.kind, c.kids, c.names)}</p>}
        {c.offline.length > 0 && <p className="confirm-extra">{m.offline(c.kind, c.offline)}</p>}
        <div className="confirm-actions">
          <Button autoFocus onClick={onCancel}>{m.cancel}</Button>
          <Button variant="primary" className={c.kind === 'delete' ? 'danger-btn' : ''} onClick={onConfirm}>{m.ok[c.kind]}</Button>
        </div>
      </div>
    </Modal>
  );
}
